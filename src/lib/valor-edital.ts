// Valor estimado do edital quando a captura não o recebeu pronto — sem IA, sem custo:
// 1) soma dos itens publicados no PNCP; 2) valor escrito no texto do edital (regras de texto, sem IA).

export type ItemComValor = {
  quantidade: number | null;
  valorUnitarioEstimado: number | null;
  valorTotal?: number | null;
  orcamentoSigiloso?: boolean | null;
};

export type ResultadoSomaItens = {
  /** Soma dos itens com valor publicado; null se não há nenhum valor aproveitável. */
  valor: number | null;
  /** Todos os itens são de orçamento sigiloso: o órgão não divulga o valor. */
  sigiloso: boolean;
  /** Parte dos itens ficou de fora (sigilosa ou sem valor): o total real é MAIOR que o somado. */
  parcial: boolean;
};

// O PNCP aceita 0 ou 1 real como "preenchimento" quando o órgão não quer divulgar o valor.
const VALOR_MINIMO_REAL = 2;

export function somarValorDosItens(itens: ItemComValor[]): ResultadoSomaItens {
  if (itens.length === 0) return { valor: null, sigiloso: false, parcial: false };
  const sigilosos = itens.filter((i) => i.orcamentoSigiloso).length;
  if (sigilosos === itens.length) return { valor: null, sigiloso: true, parcial: false };

  let soma = 0;
  let comValor = 0;
  for (const i of itens) {
    if (i.orcamentoSigiloso) continue;
    const total = i.valorTotal ?? (i.valorUnitarioEstimado != null && i.quantidade != null ? i.valorUnitarioEstimado * i.quantidade : null);
    if (total != null && total > 0) {
      soma += total;
      comValor++;
    }
  }
  const valor = Math.round(soma * 100) / 100;
  if (comValor === 0 || valor < VALOR_MINIMO_REAL) return { valor: null, sigiloso: false, parcial: false };
  return { valor, sigiloso: false, parcial: comValor < itens.length };
}

function semAcento(t: string): string {
  return t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** "1.234.567,89" -> 1234567.89 (formato brasileiro); null se não for um valor em reais bem formado. */
export function lerReais(texto: string): number | null {
  const m = texto.match(/^\d{1,3}(?:\.\d{3})*,\d{2}$|^\d+,\d{2}$/);
  if (!m) return null;
  const n = Number(texto.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

// Só frases que falam do valor TOTAL da contratação. "Valor estimado do item" e similares ficam de fora
// de propósito: um valor errado é pior que nenhum.
const FRASES_VALOR_TOTAL =
  /(?:valor\s+(?:total\s+)?(?:estimado|de\s+refer[eê]ncia|global|m[aá]ximo)(?:\s+(?:total|global|da\s+contrata[cç][aã]o|da\s+licita[cç][aã]o|do\s+objeto|para\s+a\s+contrata[cç][aã]o))?|valor\s+total\s+(?:da\s+contrata[cç][aã]o|da\s+licita[cç][aã]o|do\s+objeto|do\s+lote|geral)|pre[cç]o\s+total\s+(?:estimado|de\s+refer[eê]ncia)|or[cç]amento\s+(?:total\s+)?estimado)/;

/**
 * Valor total estimado escrito no texto do edital ("valor total estimado: R$ 1.234.567,89"). Só aceita uma frase
 * de valor TOTAL seguida de um valor em reais até 90 caracteres adiante; se o texto traz valores diferentes, não
 * chuta (devolve null). É uma sugestão a conferir — a tela marca a origem como "lido do edital".
 */
export function extrairValorDoTexto(texto: string): number | null {
  const t = semAcento(texto).replace(/\s+/g, " ");
  const valores = new Set<number>();
  const re = new RegExp(`${FRASES_VALOR_TOTAL.source}[^0-9]{0,90}?r\\$\\s*(\\d{1,3}(?:\\.\\d{3})*,\\d{2}|\\d+,\\d{2})`, "g");
  for (const m of t.matchAll(re)) {
    const v = lerReais(m[1]);
    if (v != null && v >= VALOR_MINIMO_REAL) valores.add(v);
  }
  return valores.size === 1 ? [...valores][0] : null;
}

export type OrigemValor = "PNCP" | "ITENS" | "ITENS_PARCIAL" | "EDITAL" | null | undefined;

/** Explica de onde veio o valor mostrado (para dica/legenda na tela). */
export function notaOrigemDoValor(origem: OrigemValor): string | null {
  if (origem === "ITENS") return "Soma dos valores estimados dos itens publicados no PNCP.";
  if (origem === "ITENS_PARCIAL") {
    return "Soma dos itens com valor publicado no PNCP — alguns itens não divulgam o valor, então o total real é maior.";
  }
  if (origem === "EDITAL") return "Valor lido do texto do edital — confira no documento.";
  return null;
}
