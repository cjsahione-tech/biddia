import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";
import {
  isEtapaPipeline,
  executarEtapa,
  etapasSeguintes,
  dispararEtapa,
  secretarioJaIniciado,
} from "@/lib/agents/pipeline";

// Uma etapa da esteira por invocação (Analista → Financeiro ∥ Advogado → Secretário →
// Auditor, ver pipeline.ts): cada agente ganha o teto de 60s só pra ele, em vez de dividir
// o mesmo orçamento com os demais. Ao terminar (ou falhar — falha num agente não trava a
// esteira, fica registrada na aba Auditoria), dispara a(s) etapa(s) seguinte(s).
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: Promise<{ id: string; etapa: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id, etapa } = await params;

  if (!isEtapaPipeline(etapa)) return NextResponse.json({ error: "Etapa inválida" }, { status: 400 });

  const edital = await prisma.edital.findFirst({ where: { id, companyId: company!.id } });
  if (!edital) return NextResponse.json({ error: "Edital não encontrado" }, { status: 404 });

  const cookie = req.headers.get("cookie") ?? "";
  const origin = new URL(req.url).origin;

  // Financeiro e Advogado terminam quase juntos e ambos tentam disparar o Secretário —
  // só o primeiro a chegar o executa.
  if (etapa === "secretario" && (await secretarioJaIniciado(id))) {
    return NextResponse.json({ ok: true, etapa, ignorada: "já iniciada nesta rodada" });
  }

  after(async () => {
    await executarEtapa(id, etapa);
    const proximas = await etapasSeguintes(id, etapa);
    await Promise.all(proximas.map((p) => dispararEtapa(origin, cookie, id, p)));
  });

  return NextResponse.json({ ok: true, etapa });
}
