import { NextResponse, after } from "next/server";
import { requireCompany } from "@/lib/api-utils";
import { logAudit } from "@/lib/agents/run-tracker";
import { solicitarAuditoriaHabilitacao } from "@/lib/agents/auditoria-gatilho";

// "Auditar agora" / "Tentar novamente" da aba Habilitação. Passa pelo mesmo porteiro da entrada
// em Qualificação, mas com `forcar`: vale em qualquer etapa e refaz mesmo que já exista resultado.
// Como gasta IA, a tela pede confirmação (com o custo estimado) antes de chamar esta rota.
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id } = await params;

  const s = await solicitarAuditoriaHabilitacao(id, { companyId: company!.id, origem: new URL(req.url).origin, forcar: true });
  if (s.resultado === "nao_encontrado") return NextResponse.json({ error: "Edital não encontrado" }, { status: 404 });

  if (s.disparar) {
    after(s.disparar);
    await logAudit(id, "Usuário", "Auditoria de habilitação", "OK", "Auditoria de habilitação pedida manualmente (Auditar agora).").catch(() => null);
  }
  return NextResponse.json({ resultado: s.resultado }, { status: 202 });
}
