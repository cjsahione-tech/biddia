import { prisma } from "@/lib/prisma";

// Catálogo inteiro de Feature (ver prisma/seed.mjs) fica configurável no admin — mas nesta
// entrega só estes pontos realmente CHAMAM verificarAcessoPlano em runtime:
// - captação via Compras.gov.br (CAPTACAO_COMPRASGOV, ver agente1-comercial.ts)
// - teto da carteira do Analista (CARTEIRA_MULTI_EMPRESA, ver /api/analista/carteira)
// O resto das features existe no admin pronto pra ligar depois, sem precisar de migração.

type CacheEntry = { expiraEm: number; chaves: Set<string> };
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

async function featuresDaCompany(companyId: string): Promise<Set<string>> {
  const cacheado = cache.get(companyId);
  if (cacheado && cacheado.expiraEm > Date.now()) return cacheado.chaves;

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { plan: { select: { features: { select: { feature: { select: { chave: true } } } } } } },
  });
  const chaves = new Set((company?.plan?.features ?? []).map((f) => f.feature.chave));
  cache.set(companyId, { expiraEm: Date.now() + CACHE_TTL_MS, chaves });
  return chaves;
}

export async function verificarAcessoPlano(companyId: string, featureChave: string): Promise<boolean> {
  const chaves = await featuresDaCompany(companyId);
  return chaves.has(featureChave);
}

// Só invalidado quando o admin muda o plano de uma empresa ou os limites/features de um
// plano — evita servir uma feature já removida por até 60s sem necessidade.
export function invalidarCachePlano(companyId: string) {
  cache.delete(companyId);
}

export type StatusLimite = { atual: number; limite: number | null; excedido: boolean };

// Nunca usado para bloquear — só pra UI avisar e oferecer upgrade (ver DashboardClient.tsx).
// "Editais ativos" = tudo fora de Rascunho (soft-delete); "análises no mês" = qualquer
// execução de agente (AgentRun) iniciada desde o dia 1 do mês corrente.
export async function verificarLimiteUso(
  companyId: string
): Promise<{ editaisAtivos: StatusLimite; analisesNoMes: StatusLimite }> {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { plan: true } });

  const inicioMes = new Date();
  inicioMes.setDate(1);
  inicioMes.setHours(0, 0, 0, 0);

  const [editaisAtivos, analisesNoMes] = await Promise.all([
    prisma.edital.count({ where: { companyId, etapaKanban: { not: "RASCUNHO" } } }),
    prisma.agentRun.count({ where: { edital: { companyId }, startedAt: { gte: inicioMes } } }),
  ]);

  const limiteEditais = company?.plan?.maxEditaisAtivos ?? null;
  const limiteAnalises = company?.plan?.maxAnalisesPorMes ?? null;

  return {
    editaisAtivos: {
      atual: editaisAtivos,
      limite: limiteEditais,
      excedido: limiteEditais != null && editaisAtivos > limiteEditais,
    },
    analisesNoMes: {
      atual: analisesNoMes,
      limite: limiteAnalises,
      excedido: limiteAnalises != null && analisesNoMes > limiteAnalises,
    },
  };
}
