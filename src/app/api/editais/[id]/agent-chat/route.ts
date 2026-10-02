import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";
import { AGENTES_CHAT, isAgentChatKey, processarMensagemChat } from "@/lib/agents/agent-chat";
import { extrairTrechoDeAnexoParaCorrecao, base64ParaBytes } from "@/lib/agents/pdf-extract";
import { tocarEdital, logAudit } from "@/lib/agents/run-tracker";
import { comRetry, descreverErro, ehErroTransiente } from "@/lib/ia-erros";

// Mesmo teto prático usado nos outros uploads da plataforma (corpo em base64, ~33%
// maior que o arquivo, contra o limite fixo de ~4,5MB da Vercel).
const TAMANHO_MAXIMO_ANEXO = 3.5 * 1024 * 1024;
// Não injeta o anexo inteiro no prompt de correção — só o bastante pra dar contexto.
const MAX_CHARS_ANEXO_NO_PROMPT = 20_000;

export const maxDuration = 60;

async function carregarEdital(id: string, companyId: string) {
  return prisma.edital.findFirst({ where: { id, companyId } });
}

/** Histórico da conversa com um agente específico sobre este edital. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id } = await params;

  const url = new URL(req.url);
  const agentKey = url.searchParams.get("agente") ?? "";
  if (!isAgentChatKey(agentKey)) {
    return NextResponse.json({ error: "Agente inválido" }, { status: 400 });
  }

  const edital = await carregarEdital(id, company!.id);
  if (!edital) return NextResponse.json({ error: "Edital não encontrado" }, { status: 404 });

  const messages = await prisma.agentMessage.findMany({
    where: { editalId: id, agentKey },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ messages });
}

const schema = z.object({
  agentKey: z.string(),
  mensagem: z.string().trim().min(1).max(4000),
  anexoNome: z.string().trim().min(1).max(200).optional(),
  anexoBase64: z.string().min(1).optional(),
});

/**
 * Envia uma mensagem para o chat da aba (com anexo opcional). A mensagem é
 * classificada primeiro: se for só uma conversa (dúvida, pedido de opinião/sugestão,
 * comentário), o agente responde sem mexer em nada; se for uma correção de verdade, o
 * agente refaz (ou ajusta) o próprio resultado a partir do texto-fonte e da observação
 * do usuário. Ver src/lib/agents/agent-chat.ts.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id } = await params;

  const edital = await carregarEdital(id, company!.id);
  if (!edital) return NextResponse.json({ error: "Edital não encontrado" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  const { agentKey, mensagem, anexoNome, anexoBase64 } = parsed.data;

  if (!isAgentChatKey(agentKey)) {
    return NextResponse.json({ error: "Agente inválido" }, { status: 400 });
  }

  let anexoDocId: string | undefined;
  let anexoTexto: string | null = null;

  if (anexoBase64 && anexoNome) {
    const tamanhoBase64 = anexoBase64.length * 0.75;
    if (tamanhoBase64 > TAMANHO_MAXIMO_ANEXO) {
      return NextResponse.json(
        { error: `Anexo muito grande. O limite é de ${(TAMANHO_MAXIMO_ANEXO / 1024 / 1024).toFixed(1)}MB.` },
        { status: 400 }
      );
    }

    const doc = await prisma.document.create({
      data: {
        editalId: id,
        nome: anexoNome,
        tipo: "DOCUMENTO_USUARIO",
        categoria: "CORRECAO_AGENTE",
        status: "DISPONIVEL",
        conteudoBase64: anexoBase64,
      },
      select: { id: true },
    });
    anexoDocId = doc.id;

    if (anexoBase64.startsWith("data:application/pdf")) {
      // Prioriza o trecho que o usuário pediu (ex: "página 99 a 109") em vez de cortar
      // cegamente pelo início do anexo — que em documentos longos descarta justamente o
      // trecho pedido e faz o agente "não achar" a tabela (ver extrairTrechoDeAnexoParaCorrecao).
      anexoTexto = await extrairTrechoDeAnexoParaCorrecao(base64ParaBytes(anexoBase64), mensagem, {
        tamanhoMax: MAX_CHARS_ANEXO_NO_PROMPT,
      }).catch(() => null);
    }
  }

  const userMessage = await prisma.agentMessage.create({
    data: { editalId: id, agentKey, role: "user", conteudo: mensagem, anexoNome, anexoDocId },
  });

  const notaOuMensagem =
    mensagem +
    (anexoNome
      ? anexoTexto
        ? `\n\n[Anexo enviado pelo usuário: "${anexoNome}"]\n${anexoTexto}`
        : `\n\n[O usuário anexou o arquivo "${anexoNome}", mas não foi possível extrair o texto automaticamente — considere isso ao responder.]`
      : "");

  let respostaTexto: string;
  let tentativasFeitas = 0;
  try {
    // Repete sozinho enquanto o erro for passageiro (sobrecarga/limite de taxa/resposta
    // da IA cortada) — erro determinístico (ex: bug de encoding) sobe na hora, repetir
    // não resolveria. Só depois de esgotar as tentativas o usuário vê um motivo.
    respostaTexto = await comRetry(
      () => {
        tentativasFeitas++;
        return processarMensagemChat(id, agentKey, notaOuMensagem);
      },
      {
        tentativas: 3,
        esperaMs: 2500,
        aoFalhar: (e, t) => console.error(`Chat ${agentKey} (edital ${id}) — tentativa ${t} falhou, repetindo:`, e),
      }
    );
  } catch (err) {
    console.error(`Falha ao processar mensagem do chat (${agentKey}, edital ${id}):`, err);
    const motivo = descreverErro(err);
    await logAudit(
      id,
      AGENTES_CHAT[agentKey].label,
      "Chat — falha ao atender pedido",
      "ALERTA",
      `Não foi possível atender o pedido do usuário no chat após ${tentativasFeitas} tentativa(s): ${motivo}.`
    ).catch(() => {});
    respostaTexto =
      `Não consegui concluir esse pedido, e já tentei ${tentativasFeitas} vez(es). Motivo: ${motivo}. ` +
      "Nada do que já estava salvo foi alterado por essa tentativa. " +
      (ehErroTransiente(err)
        ? "Como é uma instabilidade do serviço, tente de novo em alguns minutos — ou me peça de outro jeito (por exemplo, dividindo o pedido em partes menores)."
        : "Isso não é uma instabilidade passageira, então repetir o mesmo pedido não vai resolver — avise o suporte com essa mensagem que a causa é corrigida no sistema.");
  }

  const agentMessage = await prisma.agentMessage.create({
    data: { editalId: id, agentKey, role: "agent", conteudo: respostaTexto },
  });

  await tocarEdital(id);
  return NextResponse.json({ userMessage, agentMessage, agentLabel: AGENTES_CHAT[agentKey].label });
}
