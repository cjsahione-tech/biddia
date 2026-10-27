// Interruptor das fontes de captação automática de editais.
//
// Hoje a captação automática usa SÓ o PNCP. O código do LicitaNet (agents/licitanet.ts) e do Compras.gov.br
// (agents/comprasgov.ts) continua no projeto e os editais já captados deles seguem normais (análise, documentos,
// etiqueta de origem) — o que fica desligado é buscar editais NOVOS lá.
//
// Para religar um portal: acrescente "LICITANET" e/ou "COMPRASGOV" na lista abaixo. As telas (campo de segmento,
// linhas da tela Captação) e o agendamento leem esta mesma lista, então voltam juntos. O Compras.gov.br, além
// disso, continua dependendo do recurso CAPTACAO_COMPRASGOV do plano da empresa.
export type FonteCaptacao = "PNCP" | "LICITANET" | "COMPRASGOV";

export const FONTES_ATIVAS: readonly FonteCaptacao[] = ["PNCP"];

export function fonteAtiva(fonte: FonteCaptacao): boolean {
  return FONTES_ATIVAS.includes(fonte);
}
