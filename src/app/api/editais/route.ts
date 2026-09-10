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
    // Mesma ordem do site do PNCP: última atualização primeiro. Editais sem essa data
    // (captação manual) caem para o critério de data de publicação e, por fim, de criação.
    orderBy: [
      { dataAtualizacaoPncp: { sort: "desc", nulls: "last" } },
      { dataPublicacao: { sort: "desc", nulls: "last" } },
      { createdAt: "desc" },
    ],
    include: {
      analysis: true,
      proposal: true,
      documents: {
        where: { tipo: { in: ["DOCUMENTO_PNCP", "DOCUMENTO_USUARIO"] } },
        select: { id: true, nome: true, categoria: true },
      },
      _count: { select: { documents: true, checklistItems: true } },
    },
  });

  return NextResponse.json({ editais });
}
