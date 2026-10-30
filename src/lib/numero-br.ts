/**
 * Leitura e escrita de números no jeito brasileiro (1.234,56) para os campos digitados.
 * Função pura: nada de tela nem banco.
 */

/** Converte o texto digitado em número. Devolve null se estiver vazio ou não for um número. */
export function lerNumeroBR(texto: string | null | undefined): number | null {
  if (texto == null) return null;
  let t = texto.replace(/R\$|%|\s/g, "");
  if (t === "") return null;

  if (t.includes(",")) {
    // 1.234,56 → ponto é milhar, vírgula é decimal
    t = t.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(t)) {
    // 1.234 ou 12.345.678 → só milhares
    t = t.replace(/\./g, "");
  }
  // senão: "12.5" ou "12" → o ponto é decimal

  if (!/^-?\d*\.?\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Número → texto para colocar no campo (vírgula decimal, sem milhar, sem zeros sobrando). */
export function escreverNumeroBR(n: number | null | undefined, casas = 2): string {
  if (n == null || !Number.isFinite(n)) return "";
  const arredondado = Number(n.toFixed(casas));
  return String(arredondado).replace(".", ",");
}
