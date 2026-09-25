import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";
import { LIMITE_INATIVIDADE_MS } from "@/lib/kanban-atividade";

export async function GET(req: Request) {
  const { company, error } = await requireCompany();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");

  // Checagem "preguiçosa" de expiração por inatividade — sem cron: cards parados em
  // "Oportunidade" há mais de 48h de qualquer ação do usuário viram Rascunho aqui mesmo,
  // toda vez que o quadro é carregado (ver LIMITE_INATIVIDADE_MS).
  await prisma.edital.updateMany({
    where: {
      companyId: company!.id,
      etapaKanban: "OPORTUNIDADE",
      ultimaMovimentacao: { lt: new Date(Date.now() - LIMITE_INATIVIDADE_MS) },
    },
    data: { etapaKanban: "RASCUNHO", motivoMovimentacao: "INATIVIDADE", movidoEm: new Date() },
  });

  const editais = await prisma.edital.findMany({
    where: {
      companyId: company!.id,
      ...(status ? { status: status as "NOVO" | "APROVADO" | "REPROVADO" } : {}),
    },
    // Ordem padrão fixa do quadro: data-limite de proposta mais próxima primeiro, em
    // todas as colunas — não é mais o usuário quem controla a ordem arrastando (ver
    // KanbanBoard.tsx). Sem data informada vai pro final, não pro topo.
    orderBy: { dataEncerramentoProposta: { sort: "asc", nulls: "last" } },
    include: {
      analysis: true,
      proposal: true,
      documents: {
        where: { tipo: { in: ["DOCUMENTO_PNCP", "DOCUMENTO_LICITANET", "DOCUMENTO_USUARIO"] } },
        select: { id: true, nome: true, categoria: true },
      },
      _count: { select: { documents: true, checklistItems: true } },
    },
  });

  return NextResponse.json({ editais });
}
