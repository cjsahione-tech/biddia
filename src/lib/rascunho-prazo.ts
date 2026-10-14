// Regras de prazo do Rascunho — só cálculo, sem banco: usado também pela tela (KanbanCard).
// Editais em "Rascunho" são dado morto (parados por inatividade ou excluídos pelo usuário) e
// pesavam na base: cada um guarda os PDFs inteiros. Ficam 7 dias — tempo de arrastar de volta —
// e depois são apagados de verdade (ver rascunho-expiracao.ts).
export const DIAS_RASCUNHO = 7;
export const LIMITE_RASCUNHO_MS = DIAS_RASCUNHO * 24 * 3_600_000;

type DatasRascunho = {
  movidoEm: Date | string | null;
  ultimaMovimentacao: Date | string;
};

/** Quando o card entrou no Rascunho. Cards antigos sem essa data usam a última movimentação. */
export function entradaNoRascunho(e: DatasRascunho): Date {
  return new Date(e.movidoEm ?? e.ultimaMovimentacao);
}

/** Dias inteiros que faltam para a exclusão (0 = vence hoje, nunca negativo). */
export function diasRestantesRascunho(e: DatasRascunho, agora: Date = new Date()): number {
  const restanteMs = entradaNoRascunho(e).getTime() + LIMITE_RASCUNHO_MS - agora.getTime();
  return Math.max(0, Math.ceil(restanteMs / (24 * 3_600_000)));
}

/** Filtro Prisma dos rascunhos que já passaram do prazo (mesma regra de entradaNoRascunho). */
export function filtroRascunhoVencido(agora: Date = new Date()) {
  const corte = new Date(agora.getTime() - LIMITE_RASCUNHO_MS);
  return {
    etapaKanban: "RASCUNHO" as const,
    OR: [{ movidoEm: { lt: corte } }, { movidoEm: null, ultimaMovimentacao: { lt: corte } }],
  };
}
