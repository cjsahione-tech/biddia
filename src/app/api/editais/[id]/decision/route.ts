import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";
import { dispararPipeline } from "@/lib/agents/pipeline";

const schema = z.object({ decision: z.enum(["APROVADO", "REPROVADO"]) });

// Analista, Financeiro e Advogado rodam em paralelo aqui, lendo o PDF real do edital —
// isso ainda pode chegar perto de 60s (teto do plano Hobby da Vercel). O Secretário e o
// Auditor rodam numa segunda chamada (continuar-pipeline), com orçamento próprio.
export const maxDuration = 60;

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
    dispararPipeline(id, req);
  }

  return NextResponse.json({ edital: updated });
}
