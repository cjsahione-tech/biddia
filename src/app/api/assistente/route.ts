import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCompany } from "@/lib/api-utils";
import { conversarComFerramentas } from "@/lib/anthropic";
import { systemPromptAssistente, FERRAMENTAS_ASSISTENTE, criarExecutorAssistente } from "@/lib/assistente";

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

  try {
    const { texto, arquivos } = await conversarComFerramentas(
      systemPromptAssistente(company!.razaoSocial),
      parsed.data.mensagens,
      FERRAMENTAS_ASSISTENTE,
      criarExecutorAssistente(company!.id)
    );
    return NextResponse.json({ resposta: texto, arquivos });
  } catch (err) {
    console.error("Falha no assistente Bidd.IA:", err);
    return NextResponse.json(
      { error: "Não consegui responder agora — pode ser instabilidade do modelo. Tente de novo em instantes." },
      { status: 500 }
    );
  }
}
