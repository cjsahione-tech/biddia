import { prisma } from "@/lib/prisma";
import { dispararAuditoriaHabilitacao } from "@/lib/agents/auditoria-dispatch";
import { dadosAuditoriaNova, haVaga } from "@/lib/agents/auditoria-fila";
import { etapaAudita, fingerprintDocumentos, fingerprintEdital } from "@/lib/habilitacao";

// O "porteiro" da auditoria de habilitação: o ÚNICO lugar que decide se uma auditoria começa.
//
// Regra: audita-se só quando o edital entra em Qualificação (ou em etapa posterior), porque só
// ~2,5% dos editais captados chegam lá — auditar na captação gastava IA com editais que talvez
// nunca fossem disputados. Quem chama: a rota do Kanban (arrastar o card, seletor da tela do
// edital — qualquer entrada em Qualificação passa por ela) e o botão "Auditar agora".
//
// Idempotente: se o edital sai e volta para Qualificação, e nem o edital nem a documentação da
// empresa mudaram, o resultado já salvo é reaproveitado — sem nova chamada de IA, sem novo custo.

export type ResultadoSolicitacao =
  | "iniciada" // marcada e disparada (roda em segundo plano)
  | "reconferencia" // edital igual, documentação da empresa mudou: só refaz a conferência
  | "reaproveitada" // nada mudou: resultado salvo continua valendo (custo zero)
  | "ja_em_andamento"
  | "aguardando_ia" // IA sem saldo: auditoria guardada, retoma sozinha
  | "fora_de_etapa" // Oportunidade, Rascunho ou etapa negativa: não audita
  | "nao_encontrado";

export type Solicitacao = {
  resultado: ResultadoSolicitacao;
  /** Só quando há trabalho a disparar. Deve rodar em segundo plano (after) — responde rápido. */
  disparar?: () => Promise<boolean>;
};

const EM_ANDAMENTO_MS = 10 * 60_000;
const TIPOS_DOCUMENTO_LIDOS = ["DOCUMENTO_PNCP", "DOCUMENTO_LICITANET", "DOCUMENTO_USUARIO"] as const;
const RESULTADOS_FINAIS = ["HABILITADA", "HABILITADA_RESSALVAS", "NAO_HABILITADA"];

export async function solicitarAuditoriaHabilitacao(
  editalId: string,
  opts: { companyId?: string; origem?: string; forcar?: boolean } = {}
): Promise<Solicitacao> {
  const edital = await prisma.edital.findFirst({
    where: { id: editalId, ...(opts.companyId ? { companyId: opts.companyId } : {}) },
    select: {
      id: true,
      companyId: true,
      etapaKanban: true,
      habilitacaoStatus: true,
      dataAberturaProposta: true,
      dataEncerramentoProposta: true,
      documents: { where: { tipo: { in: [...TIPOS_DOCUMENTO_LIDOS] } }, select: { id: true, nome: true, origemUrl: true } },
      auditoriaHabilitacao: true,
    },
  });
  if (!edital) return { resultado: "nao_encontrado" };

  // Entrar em Qualificação (ou depois) audita; o botão "Auditar agora" (forcar) vale em qualquer etapa.
  if (!opts.forcar && !etapaAudita(edital.etapaKanban)) return { resultado: "fora_de_etapa" };

  const aud = edital.auditoriaHabilitacao;
  const agora = Date.now();

  if (aud && (aud.estado === "RODANDO" || aud.estado === "NA_FILA") && agora - aud.updatedAt.getTime() < EM_ANDAMENTO_MS) {
    return { resultado: "ja_em_andamento" };
  }
  // Sem saldo: a auditoria já está guardada e a retomada automática cuida dela (sem repetir gasto).
  if (aud?.estado === "AGUARDANDO_SALDO" && !opts.forcar) return { resultado: "aguardando_ia" };

  let modo: "completo" | "reconferir" = "completo";

  if (!opts.forcar && aud?.estado === "CONCLUIDA" && RESULTADOS_FINAIS.includes(edital.habilitacaoStatus)) {
    const fpEdital = fingerprintEdital(edital.documents, edital);
    // Auditorias antigas (antes da impressão digital do edital) não têm o campo: contam como
    // válidas e o campo é preenchido agora — "nunca refazer o que já foi concluído".
    const editalIgual = !aud.editalFingerprint || aud.editalFingerprint === fpEdital;
    if (editalIgual) {
      if (!aud.editalFingerprint) {
        await prisma.auditoriaHabilitacao.update({ where: { editalId }, data: { editalFingerprint: fpEdital } });
      }
      const docsEmpresa = await prisma.companyDocument.findMany({ where: { companyId: edital.companyId }, select: { id: true, updatedAt: true } });
      if (!aud.docsFingerprint || aud.docsFingerprint === fingerprintDocumentos(docsEmpresa)) {
        return { resultado: "reaproveitada" };
      }
      // Documentação da empresa mudou: só refaz a conferência (sem reler o edital — bem mais barato).
      modo = "reconferir";
    }
  }

  if (modo === "completo") {
    // Auditoria nova: zera o que sobrou de uma anterior (progresso, consumo, tentativas). Com vaga
    // livre mostra "Auditando…" na hora; sem vaga, "Na fila". O worker assume (RODANDO) em seguida;
    // se o disparo se perder, o vigia retoma o que ficou na fila.
    const comVaga = await haVaga(editalId);
    const anterior = await prisma.auditoriaHabilitacao.findUnique({ where: { editalId }, select: { progresso: true } });
    const novo = dadosAuditoriaNova(new Date(agora), anterior?.progresso ?? null);
    await prisma.auditoriaHabilitacao.upsert({ where: { editalId }, create: { editalId, ...novo }, update: novo });
    await prisma.edital.update({ where: { id: editalId }, data: { habilitacaoStatus: comVaga ? "AUDITANDO" : "NA_FILA" } });
  }

  return {
    resultado: modo === "reconferir" ? "reconferencia" : "iniciada",
    disparar: () => dispararAuditoriaHabilitacao(editalId, { origem: opts.origem, modo }),
  };
}

/** Frase curta para o histórico do edital. */
export function descricaoSolicitacao(r: ResultadoSolicitacao): string | null {
  switch (r) {
    case "iniciada":
      return "Auditoria de habilitação iniciada automaticamente.";
    case "reconferencia":
      return "Resultado da habilitação reaproveitado; só a conferência com a documentação da empresa será refeita.";
    case "reaproveitada":
      return "Habilitação já auditada e nada mudou desde então: resultado reaproveitado, sem novo custo.";
    case "aguardando_ia":
      return "Auditoria de habilitação guardada: será retomada quando a IA voltar.";
    default:
      return null;
  }
}
