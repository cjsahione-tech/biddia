import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";

export async function GET(req: Request) {
  const { company, error } = await requireCompany();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");

  const editais = await prisma.edital.findMany({
    where: {
      companyId: company!.id,
      ...(status ? { status: status as "NOVO" | "APROVADO" | "REPROVADO" } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      analysis: true,
      proposal: true,
      documents: {
        where: { tipo: "DOCUMENTO_PNCP" },
        select: { id: true, nome: true, categoria: true },
      },
      _count: { select: { documents: true, checklistItems: true } },
    },
  });

  return NextResponse.json({ editais });
}
