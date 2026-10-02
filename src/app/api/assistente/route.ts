import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCompany } from "@/lib/api-utils";
import { conversarComFerramentas } from "@/lib/anthropic";
import { systemPromptAssistente, FERRAMENTAS_ASSISTENTE, criarExecutorAssistente } from "@/lib/assistente";
import { comRetry, descreverErro, ehErroTransiente } from "@/lib/ia-erros";

export const maxDuration = 60;

const schema = z.object({
  mensagens: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(8000) }))
    .min(1)
    .max(40),
});

/**
 * Chat geral "Bidd.IA" — diferente do chat por agente/edital (agent-chat), aqui a
 * conversa é avulsa (não persiste no banco): o cliente manda o histórico inteiro a cada
 * mensagem (ver AssistenteClient.tsx) e esta rota só orquestra o loop de ferramentas.
 */
export async function POST(req: Request) {
  const { company, error } = await requireCompany();
  if (error) return error;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

  let tentativas = 0;
  try {
    // O assistente só LÊ dados e gera arquivos (nunca altera nada), então repetir o pedido
    // inteiro numa falha passageira é seguro.
    const { texto, arquivos } = await comRetry(
      () => {
        tentativas++;
        return conversarComFerramentas(
          systemPromptAssistente(company!.razaoSocial),
          parsed.data.mensagens,
          FERRAMENTAS_ASSISTENTE,
          criarExecutorAssistente(company!.id)
        );
      },
      {
        tentativas: 2,
        esperaMs: 2000,
        aoFalhar: (e, t) => console.error(`Assistente Bidd.IA — tentativa ${t} falhou, repetindo:`, e),
      }
    );
    return NextResponse.json({ resposta: texto, arquivos });
  } catch (err) {
    console.error("Falha no assistente Bidd.IA:", err);
    const motivo = descreverErro(err);
    return NextResponse.json(
      {
        error: ehErroTransiente(err)
          ? `Não consegui responder (tentei ${tentativas} vez(es)): ${motivo}. Tente de novo em alguns minutos ou divida o pedido em partes menores.`
          : `Não consegui responder: ${motivo}.`,
      },
      { status: 500 }
    );
  }
}
