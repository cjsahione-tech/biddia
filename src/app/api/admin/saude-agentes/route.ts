import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { custoPorModeloUsd, LISTA_ETAPAS_QUE_AUDITAM } from "@/lib/habilitacao";
import { META_TAXA_ERRO, resumirAuditorias, resumirExecucoes } from "@/lib/saude-agentes";

// Painel de saúde dos agentes (só administrador): taxa de erro e consumo de IA por agente nos últimos dias.
// A auditoria só conta editais que estão (ou passaram) em Qualificação — os resíduos de quando ela rodava em
// todo edital capturado (e ficaram parados em Oportunidade/Rascunho) não representam o funcionamento atual.
export async function GET(req: Request) {
  const { error } = await requireAdmin();
  if (error) return error;

  const dias = Math.min(60, Math.max(1, Number(new URL(req.url).searchParams.get("dias")) || 7));
  const desde = new Date(Date.now() - dias * 24 * 3_600_000);

  const [execucoes, auditorias, consumo] = await Promise.all([
    prisma.agentRun.findMany({ where: { startedAt: { gte: desde } }, select: { agentKey: true, status: true, startedAt: true } }),
    prisma.auditoriaHabilitacao.groupBy({ by: ["estado"], where: { iniciadaEm: { gte: desde }, edital: { etapaKanban: { in: [...LISTA_ETAPAS_QUE_AUDITAM] } } }, _count: { _all: true } }),
    prisma.consumoIA.groupBy({
      by: ["agente", "modelo"],
      where: { createdAt: { gte: desde } },
      _sum: { entrada: true, saida: true },
      _count: { _all: true },
    }),
  ]);

  const { porAgente, geral } = resumirExecucoes(execucoes.map((e) => ({ agentKey: e.agentKey, status: e.status, iniciadaEm: e.startedAt })));
  const auditoria = resumirAuditorias(auditorias.map((a) => ({ estado: a.estado, n: a._count._all })));

  const consumoPorAgente = new Map<string, { chamadas: number; entrada: number; saida: number; custoUsd: number }>();
  for (const c of consumo) {
    const atual = consumoPorAgente.get(c.agente) ?? { chamadas: 0, entrada: 0, saida: 0, custoUsd: 0 };
    const entrada = c._sum.entrada ?? 0;
    const saida = c._sum.saida ?? 0;
    atual.chamadas += c._count._all;
    atual.entrada += entrada;
    atual.saida += saida;
    atual.custoUsd += custoPorModeloUsd(c.modelo, entrada, saida);
    consumoPorAgente.set(c.agente, atual);
  }

  return NextResponse.json({
    dias,
    meta: META_TAXA_ERRO,
    geral,
    agentes: [...porAgente, auditoria],
    consumo: [...consumoPorAgente.entries()]
      .map(([agente, v]) => ({ agente, ...v, custoUsd: Math.round(v.custoUsd * 10_000) / 10_000 }))
      .sort((a, b) => b.custoUsd - a.custoUsd),
  });
}
