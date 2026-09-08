export function formatBRL(value: number | null | undefined) {
  if (value == null) return "Não informado";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

/** Mostra o valor do edital, ou "Sigiloso" quando o órgão não publica o orçamento estimado. */
export function formatValorEdital(value: number | null | undefined, sigiloso: boolean | undefined) {
  if (sigiloso) return "Sigiloso";
  return formatBRL(value);
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "Não informado";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(value));
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "Não informado";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}
