import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id } = await params;

  const edital = await prisma.edital.findFirst({
    where: { id, companyId: company!.id },
    include: {
      analysis: true,
      proposal: true,
      documents: { orderBy: { createdAt: "asc" } },
      checklistItems: { orderBy: { createdAt: "asc" } },
      auditLogs: { orderBy: { createdAt: "desc" } },
      agentRuns: { orderBy: { startedAt: "desc" } },
    },
  });

  if (!edital) return NextResponse.json({ error: "Edital não encontrado" }, { status: 404 });
  return NextResponse.json({ edital });
}
