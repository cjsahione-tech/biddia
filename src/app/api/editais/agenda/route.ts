import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";

// Fonte de dados da aba Agenda — escopada à coluna "Qualificação" (sai da lista assim
// que o card avança ou volta pra Rascunho). Rota dedicada em vez de reaproveitar
// GET /api/editais: aquela também roda a expiração por inatividade de 48h, que só se
// aplica a "Oportunidade" e é irrelevante aqui.
export async function GET() {
  const { company, error } = await requireCompany();
  if (error) return error;

  const editais = await prisma.edital.findMany({
    where: { companyId: company!.id, etapaKanban: "QUALIFICACAO" },
    select: {
      id: true,
      titulo: true,
      orgaoNome: true,
      dataAberturaProposta: true,
      dataPrazoHabilitacao: true,
      dataVisitaTecnica: true,
      dataPrazoImpugnacao: true,
    },
  });

  return NextResponse.json({ editais });
}
