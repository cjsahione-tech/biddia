import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin";
import { limparSelosAntigos, recuperarAuditorias, simularRecuperacao } from "@/lib/agents/auditoria-recuperacao";

// Limpeza e recuperação das auditorias de habilitação do passado. GET = só simula (lê, não muda
// nada). POST executa uma das duas fases, só para administrador. A recuperação exige repetir a
// quantidade simulada (confirmação explícita) — nada gasta IA sem esse passo.
export const maxDuration = 60;

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;
  return NextResponse.json({ simulacao: await simularRecuperacao() });
}

const schema = z.discriminatedUnion("acao", [
  z.object({ acao: z.literal("limpar_selos") }),
  z.object({ acao: z.literal("recuperar"), confirmarQuantidade: z.number().int().min(0) }),
]);

export async function POST(req: Request) {
  const { error } = await requireAdmin();
  if (error) return error;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pedido inválido" }, { status: 400 });

  try {
    if (parsed.data.acao === "limpar_selos") return NextResponse.json({ resultado: await limparSelosAntigos() });
    const resultado = await recuperarAuditorias({ confirmarQuantidade: parsed.data.confirmarQuantidade, origem: new URL(req.url).origin });
    return NextResponse.json({ resultado });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Não foi possível executar" }, { status: 409 });
  }
}
