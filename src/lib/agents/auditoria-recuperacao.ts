import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/agents/run-tracker";
import { dadosAuditoriaNova, iniciarProximasDaFila } from "@/lib/agents/auditoria-fila";
import { BATIMENTO_VIVO_MS } from "@/lib/auditoria-politica";
import { CUSTO_MEDIO_AUDITORIA_USD, COTACAO_USD_BRL_ESTIMADA, LISTA_ETAPAS_QUE_AUDITAM } from "@/lib/habilitacao";

// Limpeza e recuperação do passado, SEMPRE em duas fases: simular (só lê, mostra números e custo)
// e executar (só depois de o administrador autorizar). Nunca refaz auditoria já concluída.

const TIPOS_DOCUMENTO = ["DOCUMENTO_PNCP", "DOCUMENTO_LICITANET", "DOCUMENTO_USUARIO"] as const;

// Selos que, ANTES de Qualificação, só poluem o cartão (erro, "auditando" travado...).
const SELOS_A_LIMPAR = ["ERRO", "AUDITANDO", "NA_FILA", "AGUARDANDO_IA", "ARQUIVO_ILEGIVEL", "EDITAL_GRANDE", "TEMPO_ESGOTADO"] as const;

/** Faixa de custo por edital medida em editais reais (US$ 0,10 a 0,30); o valor central é o médio. */
const CUSTO_MIN_USD = 0.1;
const CUSTO_MAX_USD = 0.3;

export type ItemRecuperacao = { id: string; titulo: string; etapa: string; situacao: string };

export type SimulacaoRecuperacao = {
  /** Fase A — editais ANTES de Qualificação com selo de erro/travado: só limpa o selo (sem IA, histórico mantido). */
  limpar: { total: number; porSelo: Record<string, number>; auditoriasTravadas: number };
  /** Fase B — editais de Qualificação em diante sem auditoria válida: seriam auditados (gasta IA). */
  auditar: {
    total: number;
    porEtapa: Record<string, number>;
    custoUsd: { minimo: number; medio: number; maximo: number };
    custoBrl: { minimo: number; medio: number; maximo: number };
    itens: ItemRecuperacao[];
  };
  /** Já concluídos (não serão refeitos) e os sem documento algum (não há o que ler). */
  jaConcluidas: number;
  semDocumentos: number;
  cotacaoUsdBrl: number;
};

const arred = (n: number) => Math.round(n * 100) / 100;

/** `companyId` restringe a uma empresa (usado nos testes); sem ele vale para a plataforma inteira. */
export async function simularRecuperacao(escopo: { companyId?: string } = {}): Promise<SimulacaoRecuperacao> {
  const empresa = escopo.companyId ? { companyId: escopo.companyId } : {};
  const naoAuditam = { ...empresa, etapaKanban: { notIn: LISTA_ETAPAS_QUE_AUDITAM } };
  const auditam = { ...empresa, etapaKanban: { in: LISTA_ETAPAS_QUE_AUDITAM } };

  const aLimpar = await prisma.edital.findMany({
    where: { ...naoAuditam, habilitacaoStatus: { in: [...SELOS_A_LIMPAR] } },
    select: { habilitacaoStatus: true, auditoriaHabilitacao: { select: { estado: true } } },
  });
  const porSelo: Record<string, number> = {};
  for (const e of aLimpar) porSelo[e.habilitacaoStatus] = (porSelo[e.habilitacaoStatus] ?? 0) + 1;

  const vivoDesde = new Date(Date.now() - BATIMENTO_VIVO_MS);
  const candidatos = await prisma.edital.findMany({
    where: {
      ...auditam,
      documents: { some: { tipo: { in: [...TIPOS_DOCUMENTO] } } },
      OR: [{ auditoriaHabilitacao: null }, { auditoriaHabilitacao: { is: { estado: { not: "CONCLUIDA" } } } }],
    },
    select: { id: true, titulo: true, etapaKanban: true, habilitacaoStatus: true, auditoriaHabilitacao: { select: { estado: true, updatedAt: true } } },
    orderBy: { createdAt: "asc" },
  });
  // Já em andamento (rodando de verdade, na fila ou guardada por falta de saldo): o sistema cuida sozinho.
  const itens: ItemRecuperacao[] = candidatos
    .filter((e) => {
      const a = e.auditoriaHabilitacao;
      if (!a) return true;
      if (a.estado === "NA_FILA" || a.estado === "AGUARDANDO_SALDO") return false;
      if (a.estado === "RODANDO" && a.updatedAt >= vivoDesde) return false;
      return true;
    })
    .map((e) => ({
      id: e.id,
      titulo: e.titulo,
      etapa: e.etapaKanban,
      situacao: e.auditoriaHabilitacao ? `auditoria ${e.auditoriaHabilitacao.estado.toLowerCase()}` : "nunca auditado",
    }));
  const porEtapa: Record<string, number> = {};
  for (const i of itens) porEtapa[i.etapa] = (porEtapa[i.etapa] ?? 0) + 1;

  const [jaConcluidas, semDocumentos] = await Promise.all([
    prisma.edital.count({ where: { ...auditam, auditoriaHabilitacao: { is: { estado: "CONCLUIDA" } } } }),
    prisma.edital.count({
      where: { ...auditam, documents: { none: { tipo: { in: [...TIPOS_DOCUMENTO] } } }, OR: [{ auditoriaHabilitacao: null }, { auditoriaHabilitacao: { is: { estado: { not: "CONCLUIDA" } } } }] },
    }),
  ]);

  const n = itens.length;
  const usd = { minimo: arred(n * CUSTO_MIN_USD), medio: arred(n * CUSTO_MEDIO_AUDITORIA_USD), maximo: arred(n * CUSTO_MAX_USD) };
  return {
    limpar: { total: aLimpar.length, porSelo, auditoriasTravadas: aLimpar.filter((e) => e.auditoriaHabilitacao?.estado === "RODANDO").length },
    auditar: {
      total: n,
      porEtapa,
      custoUsd: usd,
      custoBrl: { minimo: arred(usd.minimo * COTACAO_USD_BRL_ESTIMADA), medio: arred(usd.medio * COTACAO_USD_BRL_ESTIMADA), maximo: arred(usd.maximo * COTACAO_USD_BRL_ESTIMADA) },
      itens,
    },
    jaConcluidas,
    semDocumentos,
    cotacaoUsdBrl: COTACAO_USD_BRL_ESTIMADA,
  };
}

/**
 * Fase A: tira o selo de erro/"auditando" dos editais que ainda não chegaram a Qualificação — voltam
 * a "sem auditoria; será feita ao qualificar". Não chama IA e não apaga nada: o histórico da
 * auditoria é mantido (as que estavam "rodando" parado ficam marcadas como interrompidas).
 */
export async function limparSelosAntigos(escopo: { companyId?: string } = {}): Promise<{ selosLimpos: number; auditoriasInterrompidas: number }> {
  const editais = await prisma.edital.findMany({
    where: { ...(escopo.companyId ? { companyId: escopo.companyId } : {}), etapaKanban: { notIn: LISTA_ETAPAS_QUE_AUDITAM }, habilitacaoStatus: { in: [...SELOS_A_LIMPAR] } },
    select: { id: true },
  });
  const ids = editais.map((e) => e.id);
  if (ids.length === 0) return { selosLimpos: 0, auditoriasInterrompidas: 0 };
  const interrompidas = await prisma.auditoriaHabilitacao.updateMany({ where: { editalId: { in: ids }, estado: "RODANDO" }, data: { estado: "INTERROMPIDA" } });
  const limpos = await prisma.edital.updateMany({ where: { id: { in: ids } }, data: { habilitacaoStatus: "AGUARDANDO" } });
  return { selosLimpos: limpos.count, auditoriasInterrompidas: interrompidas.count };
}

/**
 * Fase B: coloca na fila as auditorias da simulação. `confirmarQuantidade` precisa ser igual ao
 * total simulado agora — se a lista mudou desde que o administrador viu os números, nada roda.
 * Só os primeiros começam (limite de simultâneas); o resto anda sozinho pela fila.
 */
export async function recuperarAuditorias(opts: { confirmarQuantidade: number; origem?: string; companyId?: string }): Promise<{ enfileiradas: number; iniciadas: number }> {
  const sim = await simularRecuperacao({ companyId: opts.companyId });
  if (sim.auditar.total !== opts.confirmarQuantidade) {
    throw new Error(`A lista mudou desde a simulação (agora são ${sim.auditar.total}, você autorizou ${opts.confirmarQuantidade}). Simule de novo.`);
  }
  const agora = new Date();
  for (const item of sim.auditar.itens) {
    const novo = dadosAuditoriaNova(agora);
    await prisma.auditoriaHabilitacao.upsert({ where: { editalId: item.id }, create: { editalId: item.id, ...novo }, update: novo });
    await prisma.edital.update({ where: { id: item.id }, data: { habilitacaoStatus: "NA_FILA" } });
    await logAudit(item.id, "Administrador", "Auditoria de habilitação", "OK", "Auditoria de habilitação recuperada: entrou na fila por pedido do administrador.").catch(() => null);
  }
  const iniciadas = await iniciarProximasDaFila({ origem: opts.origem, companyId: opts.companyId });
  return { enfileiradas: sim.auditar.itens.length, iniciadas };
}
