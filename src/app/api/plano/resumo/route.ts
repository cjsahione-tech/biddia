import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";
import { verificarLimiteUso } from "@/lib/plano";

// Só leitura, para a tela "Plano e consumo" do celular: plano da empresa, limites, o que cada agente fez no mês
// e as funções liberadas. Nada de custo em dólar aqui: isso é do painel de administração.
const NOME_AGENTE: Record<string, string> = {
  "agente2-analista": "Analista",
  "agente3-financeiro": "Financeiro",
  "agente4-advogado": "Advogado",
  "agente5-secretario": "Secretário",
  "agente6-auditor": "Auditor",
};

export async function GET() {
  const { user, company, error } = await requireCompany();
  if (error) return error;

  const inicioMes = new Date();
  inicioMes.setDate(1);
  inicioMes.setHours(0, 0, 0, 0);

  const [plano, limites, execucoes, empresas] = await Promise.all([
    company!.planId
      ? prisma.plan.findUnique({
          where: { id: company!.planId },
          select: {
            nome: true,
            precoMensal: true,
            features: { select: { feature: { select: { label: true, categoria: true, ordemExibicao: true } } } },
          },
        })
      : null,
    verificarLimiteUso(company!.id),
    prisma.agentRun.groupBy({
      by: ["agentKey"],
      where: { edital: { companyId: company!.id }, startedAt: { gte: inicioMes } },
      _count: { _all: true },
    }),
    prisma.analistaCliente.count({ where: { analista: { id: user!.id } } }),
  ]);

  const porAgente = new Map(execucoes.map((e) => [e.agentKey, e._count._all]));
  return NextResponse.json({
    plano: plano ? { nome: plano.nome, precoMensal: plano.precoMensal } : null,
    status: user!.statusAssinatura,
    emTesteAte: user!.emTesteAte?.toISOString() ?? null,
    limites,
    carteira: empresas,
    agentes: Object.entries(NOME_AGENTE).map(([chave, nome]) => ({ chave, nome, execucoes: porAgente.get(chave) ?? 0 })),
    funcoes: (plano?.features ?? [])
      .map((f) => f.feature)
      .sort((a, b) => a.ordemExibicao - b.ordemExibicao)
      .map((f) => ({ label: f.label, categoria: f.categoria })),
  });
}
