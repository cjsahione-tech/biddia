import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";
import { executarPipelineCompleto } from "@/lib/agents/pipeline";

const schema = z.object({ decision: z.enum(["APROVADO", "REPROVADO"]) });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Decisão inválida" }, { status: 400 });

  const edital = await prisma.edital.findFirst({ where: { id, companyId: company!.id } });
  if (!edital) return NextResponse.json({ error: "Edital não encontrado" }, { status: 404 });

  const updated = await prisma.edital.update({
    where: { id },
    data: { status: parsed.data.decision, decidedAt: new Date() },
  });

  if (parsed.data.decision === "APROVADO") {
    // Roda a esteira dos agentes 2 a 6 em segundo plano; o front acompanha via polling.
    executarPipelineCompleto(id).catch((err) => {
      console.error(`Falha no pipeline do edital ${id}:`, err);
    });
  }

  return NextResponse.json({ edital: updated });
}
