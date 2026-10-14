import { notaOrigemDoValor, type OrigemValor } from "@/lib/valor-edital";

export function formatBRL(value: number | null | undefined) {
  if (value == null) return "Não informado";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

/** Mostra o valor do edital, ou "Sigiloso" quando o órgão não publica o orçamento estimado. */
export function formatValorEdital(value: number | null | undefined, sigiloso: boolean | undefined) {
  if (sigiloso) return "Sigiloso";
  return formatBRL(value);
}

export type DadosValorEdital = {
  valorGlobal: number | null | undefined;
  orcamentoSigiloso: boolean | undefined;
  valorOrigem?: string | null;
  valorTentadoEm?: string | null;
  createdAt?: string | null;
  fonte?: string | null;
};

// Depois deste tempo sem achar o valor nas fontes gratuitas, para de dizer "buscando" e diz que não foi divulgado.
const ESPERA_BUSCA_VALOR_MS = 2 * 24 * 3_600_000;

/**
 * Como mostrar o valor de um edital: o texto, uma dica de onde ele veio (ou por que não há) e se deve aparecer
 * esmaecido. Nunca "Não informado" solto — sempre diz o motivo.
 */
export function descreverValorEdital(e: DadosValorEdital): { texto: string; nota: string | null; apagado: boolean } {
  if (e.orcamentoSigiloso) {
    return { texto: "Sigiloso", nota: "O órgão não divulga o orçamento estimado desta contratação.", apagado: true };
  }
  if (e.valorGlobal != null) {
    const brl = formatBRL(e.valorGlobal);
    if (e.valorOrigem === "ITENS_PARCIAL") return { texto: `A partir de ${brl}`, nota: notaOrigemDoValor("ITENS_PARCIAL"), apagado: false };
    return { texto: brl, nota: notaOrigemDoValor(e.valorOrigem as OrigemValor), apagado: false };
  }
  const buscando =
    !e.valorTentadoEm && e.createdAt != null && Date.now() - new Date(e.createdAt).getTime() < ESPERA_BUSCA_VALOR_MS && e.fonte !== "MANUAL";
  if (buscando) return { texto: "Buscando valor…", nota: "Estamos procurando o valor estimado nas fontes públicas.", apagado: true };
  if (e.fonte === "MANUAL") return { texto: "Não consta no PDF enviado", nota: "O PDF enviado não traz um valor estimado.", apagado: true };
  if (e.fonte === "LICITANET") {
    return { texto: "Não consta no edital", nota: "O LicitaNet não informa o valor e o texto do edital não traz um valor total estimado. Confira nos anexos.", apagado: true };
  }
  return {
    texto: "Não divulgado pelo órgão",
    nota: "O órgão não publicou valor estimado nem valores por item no PNCP. Confira no edital.",
    apagado: true,
  };
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "Não informado";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(value));
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "Não informado";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}
