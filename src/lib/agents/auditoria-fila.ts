import { prisma } from "@/lib/prisma";
import { verificarIADisponivel } from "@/lib/anthropic";
import { dispararAuditoriaHabilitacao } from "@/lib/agents/auditoria-dispatch";
import { LISTA_ETAPAS_QUE_AUDITAM } from "@/lib/habilitacao";
import { mensagemAmigavelDoTipo, mensagemDefinitivaDoTipo } from "@/lib/ia-erros";
import { verificarArmazenamento } from "@/lib/storage";
import { reaproveitarProgresso } from "@/lib/agents/auditoria-pedacos";
import { registrarTentativa } from "@/lib/agents/auditoria-tentativas";
import { corrigirSeloPreso } from "@/lib/auditoria-selos";
import {
  BATIMENTO_VIVO_MS,
  decidirAposFalha,
  ESPERA_ARMAZENAMENTO_MS,
  LIMITE_AUDITORIAS_SIMULTANEAS,
  MAX_TENTATIVAS_AUTOMATICAS,
  TEMPO_PARADA_MS,
} from "@/lib/auditoria-politica";
import { statusHabilitacaoDefinitivaDoErro, statusHabilitacaoDoErro } from "@/lib/habilitacao";

// Fila e vigia das auditorias de habilitação.
//
// Fila: no máximo LIMITE_AUDITORIAS_SIMULTANEAS rodando ao mesmo tempo (a chave da IA é uma só;
// dezenas juntas estouravam o limite de uso e o saldo numa rajada). As demais ficam "Na fila" e
// começam quando uma vaga abre.
//
// Vigia: toda auditoria precisa terminar num estado final. Ele corrige o que escapou — uma
// auditoria "rodando" sem sinal de vida (a Vercel cortou a função) é interrompida e
// re-enfileirada; retentativas com espera vencida voltam para a fila; auditorias guardadas por
// falta de saldo retomam quando a IA volta. Só mexe em editais de etapas que auditam.

const FILTRO_ETAPA = { etapaKanban: { in: LISTA_ETAPAS_QUE_AUDITAM } };

function vivoDesde(): Date {
  return new Date(Date.now() - BATIMENTO_VIVO_MS);
}

/** Auditorias rodando agora (com sinal de vida recente), sem contar `excetoEditalId`. */
export async function contarAuditoriasVivas(excetoEditalId?: string): Promise<number> {
  return prisma.auditoriaHabilitacao.count({
    where: {
      estado: "RODANDO",
      updatedAt: { gte: vivoDesde() },
      ...(excetoEditalId ? { editalId: { not: excetoEditalId } } : {}),
    },
  });
}

export async function haVaga(excetoEditalId?: string): Promise<boolean> {
  return (await contarAuditoriasVivas(excetoEditalId)) < LIMITE_AUDITORIAS_SIMULTANEAS;
}

/**
 * Campos de uma auditoria NOVA na fila: zera consumo e tentativas. O progresso anterior só mantém o que já foi LIDO do
 * edital (pedaços, leitura por imagem) — isso não depende da situação do momento e custa dinheiro refazer; o resto recomeça.
 */
export function dadosAuditoriaNova(agora: Date, progressoAnterior: string | null = null) {
  return {
    estado: "NA_FILA" as const,
    solicitadaEm: agora,
    mensagem: null,
    erroTipo: null,
    detalheTecnico: null,
    proximaTentativaEm: null,
    progresso: reaproveitarProgresso(progressoAnterior),
    tentativasAutomaticas: 0,
    haikuEntrada: 0,
    haikuSaida: 0,
    sonnetEntrada: 0,
    sonnetSaida: 0,
    iniciadaEm: agora,
  };
}

/** Põe a auditoria na fila (o edital passa a mostrar "Na fila"). Não mexe em quem já tem resultado. */
export async function colocarNaFila(editalId: string): Promise<void> {
  await prisma.auditoriaHabilitacao.upsert({
    where: { editalId },
    create: { editalId, estado: "NA_FILA", solicitadaEm: new Date() },
    update: { estado: "NA_FILA", proximaTentativaEm: null },
  });
  await prisma.edital.update({ where: { id: editalId }, data: { habilitacaoStatus: "NA_FILA" } });
}

/**
 * Dispara as próximas auditorias da fila, uma por vaga livre (a mais antiga primeiro). Cada
 * disparo ainda confere a vaga ao começar, então uma corrida entre duas chamadas é segura.
 */
export async function iniciarProximasDaFila(opts: { origem?: string; companyId?: string } = {}): Promise<number> {
  const vivas = await contarAuditoriasVivas();
  const vagas = LIMITE_AUDITORIAS_SIMULTANEAS - vivas;
  if (vagas <= 0) return 0;

  const naFila = await prisma.auditoriaHabilitacao.findMany({
    where: {
      estado: "NA_FILA",
      edital: { ...FILTRO_ETAPA, ...(opts.companyId ? { companyId: opts.companyId } : {}) },
    },
    select: { editalId: true },
    orderBy: [{ solicitadaEm: "asc" }, { updatedAt: "asc" }],
    take: vagas,
  });
  for (const a of naFila) await dispararAuditoriaHabilitacao(a.editalId, { origem: opts.origem });
  return naFila.length;
}

export type ResumoVigia = { interrompidas: number; retentativas: number; retomadas: number; iniciadas: number; selosCorrigidos: number };

/** Edital com selo de andamento há mais que isto sem ninguém mexer = candidato a selo preso. */
const TEMPO_SELO_PRESO_MS = 15 * 60_000;

// Evita rodar o vigia a cada requisição: no máximo uma vez a cada 20s por instância.
let ultimaVarredura = 0;
const INTERVALO_MINIMO_MS = 20_000;

/**
 * Passada do vigia. Chamado ao abrir o painel, ao acompanhar uma auditoria, ao fim de cada
 * auditoria e por um agendador externo. É barato quando não há nada a fazer.
 */
export async function vigiarAuditorias(opts: { origem?: string; companyId?: string; forcar?: boolean } = {}): Promise<ResumoVigia> {
  const vazio: ResumoVigia = { interrompidas: 0, retentativas: 0, retomadas: 0, iniciadas: 0, selosCorrigidos: 0 };
  if (!opts.forcar && Date.now() - ultimaVarredura < INTERVALO_MINIMO_MS) return vazio;
  ultimaVarredura = Date.now();

  const agora = new Date();
  const empresa = opts.companyId ? { companyId: opts.companyId } : {};
  const resumo = { ...vazio };

  // 1. "Rodando" sem sinal de vida há muito tempo: a função foi cortada. Interrompe e re-enfileira
  //    (limitado: depois das tentativas automáticas, vira erro final com "Tentar novamente").
  const paradas = await prisma.auditoriaHabilitacao.findMany({
    where: { estado: "RODANDO", updatedAt: { lt: new Date(agora.getTime() - TEMPO_PARADA_MS) }, edital: { ...FILTRO_ETAPA, ...empresa } },
    select: { editalId: true, tentativasAutomaticas: true },
    take: 20,
  });
  for (const a of paradas) {
    const d = decidirAposFalha("TEMPO_ESGOTADO", a.tentativasAutomaticas);
    if (d.acao === "tentar_de_novo") {
      await prisma.auditoriaHabilitacao.update({
        where: { editalId: a.editalId },
        data: { estado: "NA_FILA", erroTipo: "TEMPO_ESGOTADO", mensagem: mensagemAmigavelDoTipo("TEMPO_ESGOTADO"), tentativasAutomaticas: { increment: 1 }, proximaTentativaEm: null },
      });
      await prisma.edital.update({ where: { id: a.editalId }, data: { habilitacaoStatus: statusHabilitacaoDoErro("TEMPO_ESGOTADO") } });
    } else {
      await prisma.auditoriaHabilitacao.update({
        where: { editalId: a.editalId },
        data: { estado: "ERRO", erroTipo: "TEMPO_ESGOTADO", mensagem: mensagemDefinitivaDoTipo("TEMPO_ESGOTADO"), proximaTentativaEm: null },
      });
      await prisma.edital.update({ where: { id: a.editalId }, data: { habilitacaoStatus: statusHabilitacaoDefinitivaDoErro("TEMPO_ESGOTADO") } });
    }
    await registrarTentativa({ editalId: a.editalId, resultado: "interrompida", tipoErro: "TEMPO_ESGOTADO", detalhe: "Execução parada sem sinal de vida; o vigia retomou de onde parou." });
    resumo.interrompidas++;
  }

  // 2. Retentativas com a espera vencida voltam para a fila (cada uma consome 1 das tentativas automáticas).
  const devidas = await prisma.auditoriaHabilitacao.findMany({
    where: {
      estado: "ERRO",
      proximaTentativaEm: { lte: agora },
      tentativasAutomaticas: { lt: MAX_TENTATIVAS_AUTOMATICAS },
      edital: { ...FILTRO_ETAPA, ...empresa },
    },
    select: { editalId: true },
    take: 20,
  });
  for (const a of devidas) {
    await prisma.auditoriaHabilitacao.update({
      where: { editalId: a.editalId },
      data: { estado: "NA_FILA", proximaTentativaEm: null, tentativasAutomaticas: { increment: 1 } },
    });
    await prisma.edital.update({ where: { id: a.editalId }, data: { habilitacaoStatus: "NA_FILA" } });
    resumo.retentativas++;
  }

  // 3. Guardadas por falta de saldo/chave: se a IA voltou (o disjuntor testa com 1 token), voltam para a fila.
  const guardadas = await prisma.auditoriaHabilitacao.findMany({
    where: { estado: "AGUARDANDO_SALDO", edital: { ...FILTRO_ETAPA, ...empresa } },
    select: { editalId: true, erroTipo: true, proximaTentativaEm: true },
    take: 20,
  });
  // As que esperam o ARMAZENAMENTO de arquivos só são testadas quando o prazo de espera vence (a sonda é barata, mas não precisa ser frequente).
  const porArmazenamento = guardadas.filter((a) => a.erroTipo === "ARMAZENAMENTO_INDISPONIVEL");
  const porIA = guardadas.filter((a) => a.erroTipo !== "ARMAZENAMENTO_INDISPONIVEL");
  if (porIA.length > 0) {
    const iaVoltou = await verificarIADisponivel().then(
      () => true,
      () => false
    );
    if (iaVoltou) {
      for (const a of porIA) {
        await colocarNaFila(a.editalId);
        resumo.retomadas++;
      }
    }
  }
  const armazenamentoParaTestar = porArmazenamento.filter((a) => !a.proximaTentativaEm || a.proximaTentativaEm <= agora);
  if (armazenamentoParaTestar.length > 0) {
    if (await verificarArmazenamento()) {
      for (const a of armazenamentoParaTestar) {
        await colocarNaFila(a.editalId);
        resumo.retomadas++;
      }
    } else {
      // Continua bloqueado: adia a próxima checagem (não gasta tentativa nem vira erro).
      await prisma.auditoriaHabilitacao.updateMany({
        where: { editalId: { in: armazenamentoParaTestar.map((a) => a.editalId) } },
        data: { proximaTentativaEm: new Date(agora.getTime() + ESPERA_ARMAZENAMENTO_MS) },
      });
    }
  }

  // 4. Selos "em andamento" sem nada andando por trás (auditoria apagada, terminou em erro...): corrige. Nada fica "processando" para sempre.
  const presos = await prisma.edital.findMany({
    where: {
      ...FILTRO_ETAPA,
      ...empresa,
      habilitacaoStatus: { in: ["AUDITANDO", "NA_FILA", "AGUARDANDO_IA", "TEMPO_ESGOTADO"] },
      updatedAt: { lt: new Date(agora.getTime() - TEMPO_SELO_PRESO_MS) },
    },
    select: { id: true, habilitacaoStatus: true, auditoriaHabilitacao: { select: { estado: true, erroTipo: true, proximaTentativaEm: true } } },
    take: 30,
  });
  for (const e of presos) {
    const correcao = corrigirSeloPreso({ statusEdital: e.habilitacaoStatus, auditoria: e.auditoriaHabilitacao });
    if (!correcao) continue;
    if (correcao.acao === "enfileirar") await colocarNaFila(e.id);
    else await prisma.edital.update({ where: { id: e.id }, data: { habilitacaoStatus: correcao.status } });
    resumo.selosCorrigidos++;
  }

  // 5. Preenche as vagas livres com o que está na fila.
  resumo.iniciadas = await iniciarProximasDaFila({ origem: opts.origem, companyId: opts.companyId });
  return resumo;
}
