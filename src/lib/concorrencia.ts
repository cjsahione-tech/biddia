/**
 * Roda `fn` para cada item de `itens` com no máximo `limite` execuções simultâneas.
 * Preserva a ordem do resultado. Útil para lotes de chamadas HTTP (ex: baixar vários
 * arquivos do PNCP) sem disparar dezenas de conexões de uma vez nem esperar uma por uma.
 */
export async function mapComLimite<T, R>(
  itens: T[],
  limite: number,
  fn: (item: T, indice: number) => Promise<R>
): Promise<R[]> {
  const resultado = new Array<R>(itens.length);
  let proximo = 0;

  async function trabalhador() {
    while (proximo < itens.length) {
      const indice = proximo++;
      resultado[indice] = await fn(itens[indice], indice);
    }
  }

  const trabalhadores = Array.from({ length: Math.min(limite, itens.length) }, () => trabalhador());
  await Promise.all(trabalhadores);
  return resultado;
}
