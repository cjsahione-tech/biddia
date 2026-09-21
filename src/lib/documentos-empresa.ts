import type { FormaDocumento } from "@prisma/client";

export const FORMA_LABEL: Record<FormaDocumento, string> = {
  COPIA_SIMPLES: "Cópia simples",
  AUTENTICADO: "Autenticado em cartório",
  ASSINATURA_DIGITAL: "Assinatura digital (ICP-Brasil)",
};

// Avança em dias ÚTEIS usando o calendário UTC (não o fuso local do processo) — datas de
// validade/vencimento no banco são meia-noite UTC; usar `date-fns`'s addBusinessDays
// aqui misturaria isso com o fuso do servidor (varia entre dev local e produção na
// Vercel), deslocando o resultado em 1 dia perto da virada de meia-noite.
function adicionarDiasUteisUtc(data: Date, diasUteis: number): Date {
  const resultado = new Date(Date.UTC(data.getUTCFullYear(), data.getUTCMonth(), data.getUTCDate()));
  let restantes = diasUteis;
  while (restantes > 0) {
    resultado.setUTCDate(resultado.getUTCDate() + 1);
    const diaSemana = resultado.getUTCDay(); // 0 = domingo, 6 = sábado
    if (diaSemana !== 0 && diaSemana !== 6) restantes--;
  }
  return resultado;
}

/**
 * Um documento do dossiê está "válido pra uso" numa licitação quando não vence (ex:
 * Contrato Social) ou quando ainda estará dentro do prazo em `dataReferencia` (data de
 * abertura das propostas) MAIS uma margem de segurança de dias úteis — sem essa margem,
 * um documento que vence no dia seguinte à abertura passaria como "válido" hoje e viraria
 * pendência crítica de última hora.
 */
export function dentroDaValidadeComMargem(
  validade: Date | null,
  dataReferencia: Date,
  margemDiasUteis = 5
): boolean {
  if (!validade) return true;
  return validade.getTime() >= adicionarDiasUteisUtc(dataReferencia, margemDiasUteis).getTime();
}
