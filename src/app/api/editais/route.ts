import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";
import { LIMITE_INATIVIDADE_MS } from "@/lib/kanban-atividade";
import { vigiarAuditorias } from "@/lib/agents/auditoria-fila";
import { excluirRascunhosVencidos } from "@/lib/rascunho-expiracao";
import { repararEditais } from "@/lib/agents/edital-disponivel";

// No máximo uma passada de reparo por empresa a cada 45s por instância (abrir/atualizar o quadro não pode
// disparar downloads em cascata).
const ultimoReparo = new Map<string, number>();
import { filtroRascunhoVencido } from "@/lib/rascunho-prazo";

export async function GET(req: Request) {
  const { company, error } = await requireCompany();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");

  // Vigia das auditorias de habilitação (travadas, com nova tentativa vencida, na fila): roda em
  // segundo plano toda vez que o quadro é aberto — barato quando não há nada a fazer.
  const origem = new URL(req.url).origin;
  after(() => vigiarAuditorias({ origem, companyId: company!.id }).then(() => undefined, () => undefined));

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

  // Deixa os editais completos em segundo plano: arquivos que faltaram na captura, edital principal no
  // Storage e valor estimado (sem IA). Só mexe no que ainda falta.
  const agoraMs = Date.now();
  if (agoraMs - (ultimoReparo.get(company!.id) ?? 0) > 45_000) {
    ultimoReparo.set(company!.id, agoraMs);
    after(() => repararEditais({ companyId: company!.id, limite: 10, ateMs: 25_000 }).then(() => undefined, () => undefined));
  }

  // Rascunho que passou de 7 dias é apagado de verdade (em segundo plano, aos poucos); enquanto isso
  // já não aparece no quadro.
  after(() => excluirRascunhosVencidos({ companyId: company!.id, ateMs: 25_000 }).then(() => undefined, () => undefined));

  const editais = await prisma.edital.findMany({
    where: {
      companyId: company!.id,
      NOT: filtroRascunhoVencido(),
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
