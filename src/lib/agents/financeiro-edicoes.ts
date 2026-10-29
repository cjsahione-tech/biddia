// Edições manuais de preço (marcadas com editadoManualmente) não podem se perder quando o Agente Financeiro roda de
// novo — antes, cada nova execução regravava a lista inteira e apagava o trabalho de quem ajustou preços na tela.

export type ItemSalvo = {
  numero: number | null;
  descricao: string;
  unidade: string;
  quantidade: number;
  valorUnitario: number;
  valorTotal: number;
  lote: string | null;
  editadoManualmente: boolean;
  /** true quando o preço veio de uma sugestão de mercado (não do edital). */
  precoSugerido?: boolean;
};

const normaliza = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

function chaveDoItem(it: Pick<ItemSalvo, "numero" | "descricao" | "lote">): string {
  return `${it.lote ?? ""}#${it.numero != null ? `n${it.numero}` : `d${normaliza(it.descricao)}`}`;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Junta o que o agente acabou de extrair com as edições manuais da proposta anterior: o item editado à mão mantém o
 * preço que a pessoa colocou (e a marca de edição). Casa por lote + número do item (ou, sem número, pela descrição).
 * Se o item editado não existe mais na nova leitura, ele continua na lista, para o trabalho não se perder.
 */
export function preservarEdicoesManuais<T extends ItemSalvo>(novos: T[], anteriores: ItemSalvo[]): T[] {
  const editados = anteriores.filter((a) => a.editadoManualmente);
  if (editados.length === 0) return novos;

  const resultado = [...novos];
  const indicePorChave = new Map<string, number>();
  resultado.forEach((it, i) => {
    const k = chaveDoItem(it);
    if (!indicePorChave.has(k)) indicePorChave.set(k, i);
  });

  const sobras: T[] = [];
  for (const ant of editados) {
    const i = indicePorChave.get(chaveDoItem(ant));
    if (i === undefined) {
      sobras.push(ant as T);
      continue;
    }
    const atual = resultado[i];
    resultado[i] = {
      ...atual,
      valorUnitario: ant.valorUnitario,
      valorTotal: round2(atual.quantidade * ant.valorUnitario),
      editadoManualmente: true,
      precoSugerido: false,
    };
  }
  return [...resultado, ...sobras];
}
