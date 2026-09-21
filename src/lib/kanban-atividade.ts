// Ciclo de vida por inatividade da coluna "Oportunidade" — usado tanto pela checagem
// preguiçosa do servidor (src/app/api/editais/route.ts, que efetivamente move o card
// depois de LIMITE_INATIVIDADE_MS) quanto pelo destaque visual do card no front (que
// avisa a partir de LIMITE_ALERTA_MS, antes do card sumir da coluna).
export const LIMITE_INATIVIDADE_MS = 48 * 3_600_000;
export const LIMITE_ALERTA_MS = 36 * 3_600_000;

export type EstadoInatividade = "normal" | "quase_expirando";

/**
 * Só se aplica à coluna "Oportunidade" — cards já avançados pro funil seguem o fluxo
 * manual normal, sem nenhum destaque/expiração por inatividade.
 */
export function calcularEstadoInatividade(
  etapaKanban: string,
  ultimaMovimentacao: Date | string,
  agora: Date = new Date()
): EstadoInatividade | null {
  if (etapaKanban !== "OPORTUNIDADE") return null;
  const decorrido = agora.getTime() - new Date(ultimaMovimentacao).getTime();
  return decorrido >= LIMITE_ALERTA_MS ? "quase_expirando" : "normal";
}
