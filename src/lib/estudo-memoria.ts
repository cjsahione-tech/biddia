/**
 * "Memória" do Estudo de Viabilidade: o sistema aprende com os estudos que a PRÓPRIA empresa já
 * concluiu. Função pura — recebe o histórico já carregado e devolve sugestões; não grava nada e
 * não consulta o banco (quem carrega o histórico é a rota). Nenhuma sugestão vale sozinha: a tela
 * mostra de onde veio e o usuário confere e salva.
 *
 * Duas coisas são aprendidas:
 *  1. Custos por produto — se o mesmo produto (ou um muito parecido) já apareceu em outro estudo
 *     concluído, sugere o custo de aquisição, frete, ICMS-ST, despesas e fornecedor de lá.
 *  2. Margens do negócio — a mediana das margens que a empresa costuma usar.
 */
import type { CustoItemProduto } from "@/lib/estudo-custos";

export type CustoComFornecedor = CustoItemProduto & { fornecedor?: string };

export type RegistroHistorico = {
  descricao: string;
  /** Quantidade que foi comprada naquele estudo — frete e ICMS-ST são totais, então dependem dela. */
  quantidade: number;
  custos: CustoComFornecedor;
  origem: {
    estudoId: string;
    /** Edital ou nome do estudo de onde veio o custo — para o usuário reconhecer. */
    rotulo: string;
    /** Data (ISO) do estudo. */
    atualizadoEm: string;
  };
};

export type SugestaoCusto = {
  custos: CustoComFornecedor;
  /** 0 a 1. 1 = descrição idêntica (depois de normalizar). */
  similaridade: number;
  origem: RegistroHistorico["origem"];
  /** Em quantos estudos anteriores esse produto apareceu. */
  ocorrencias: number;
  /** true quando frete e ICMS-ST foram ajustados proporcionalmente à quantidade nova. */
  ajustouPorQuantidade: boolean;
};

/** Palavras que não ajudam a reconhecer um produto. */
const PALAVRAS_VAZIAS = new Set([
  "de", "da", "do", "das", "dos", "para", "com", "sem", "em", "no", "na", "nos", "nas", "por", "ao", "aos",
  "e", "ou", "a", "o", "as", "os", "um", "uma", "tipo", "item", "similar", "equivalente", "marca",
  "modelo", "unidade", "unid", "und", "un", "cada",
]);

/** Minúsculas, sem acento, sem pontuação, com número e unidade separados ("10ml" → "10 ml"). */
export function normalizarTexto(texto: string): string {
  return texto
    .toLowerCase()
    // abreviações comuns nos editais: "c/" = com, "s/" = sem
    .replace(/(^|\s)c\s*\/\s*/g, "$1com ")
    .replace(/(^|\s)s\s*\/\s*/g, "$1sem ")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(texto: string): string[] {
  return normalizarTexto(texto)
    .split(" ")
    .filter((t) => t.length > 0 && !PALAVRAS_VAZIAS.has(t));
}

/** Tokens que definem a especificação (medidas, tamanhos): têm número ou são uma letra só. */
function ehEspecificacao(token: string): boolean {
  return /\d/.test(token) || token.length === 1;
}

/**
 * Parecido de 0 a 1 entre duas descrições. Usa a proporção de palavras em comum; mas se as
 * especificações (números, tamanhos P/M/G) forem diferentes, são produtos diferentes → 0.
 * Ex.: "Seringa 10 ml" e "Seringa 5 ml" não são o mesmo produto.
 */
export function similaridade(a: string, b: string): number {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;

  const specA = [...ta].filter(ehEspecificacao).sort().join("|");
  const specB = [...tb].filter(ehEspecificacao).sort().join("|");
  if (specA !== specB) return 0;

  let emComum = 0;
  for (const t of ta) if (tb.has(t)) emComum++;
  const uniao = ta.size + tb.size - emComum;
  return uniao === 0 ? 0 : emComum / uniao;
}

export const LIMIAR_SIMILARIDADE = 0.75;

/**
 * Procura no histórico o custo mais confiável para esta descrição. O custo de compra por unidade é
 * copiado como está; frete e ICMS-ST são TOTAIS do item, então são ajustados proporcionalmente à
 * quantidade deste edital (uma estimativa de partida — o usuário confere).
 */
export function sugerirCustos(
  descricao: string,
  quantidade: number,
  historico: RegistroHistorico[],
  limiar: number = LIMIAR_SIMILARIDADE
): SugestaoCusto | null {
  const candidatos = historico
    .filter((r) => r.custos.custoAquisicaoUnitario > 0)
    .map((r) => ({ r, s: similaridade(descricao, r.descricao) }))
    .filter((x) => x.s >= limiar);
  if (candidatos.length === 0) return null;

  // Mais parecido primeiro; entre iguais, o mais recente.
  candidatos.sort((x, y) => y.s - x.s || y.r.origem.atualizadoEm.localeCompare(x.r.origem.atualizadoEm));
  const melhor = candidatos[0].r;
  const estudos = new Set(candidatos.map((c) => c.r.origem.estudoId));

  const podeAjustar = melhor.quantidade > 0 && quantidade > 0 && melhor.quantidade !== quantidade;
  const fator = podeAjustar ? quantidade / melhor.quantidade : 1;
  const arredonda = (n: number) => Math.round(n * fator * 100) / 100;

  return {
    custos: {
      ...melhor.custos,
      freteLogistica: arredonda(melhor.custos.freteLogistica),
      icmsStDifal: arredonda(melhor.custos.icmsStDifal),
    },
    similaridade: Math.round(candidatos[0].s * 100) / 100,
    origem: melhor.origem,
    ocorrencias: estudos.size,
    ajustouPorQuantidade: podeAjustar && (melhor.custos.freteLogistica > 0 || melhor.custos.icmsStDifal > 0),
  };
}

/* ------------------------------------------------------------------ margens do negócio */

export type ParametrosHistorico = {
  margemPiso: number | null;
  margemAlvo: number | null;
  margemInicial: number | null;
  despesasComerciaisAdmin: number | null;
};

export type ParametrosAprendidos = {
  margemPiso: number | null;
  margemAlvo: number | null;
  margemInicial: number | null;
  despesasComerciaisAdmin: number | null;
  /** Quantos estudos concluídos alimentaram a conta. */
  amostras: number;
};

function mediana(valores: (number | null)[]): number | null {
  const v = valores.filter((x): x is number => x != null && Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const meio = Math.floor(v.length / 2);
  const m = v.length % 2 === 1 ? v[meio] : (v[meio - 1] + v[meio]) / 2;
  return Math.round(m * 10) / 10;
}

/** Margens e despesas que a empresa costuma usar (mediana dos estudos concluídos). */
export function aprenderParametros(estudos: ParametrosHistorico[]): ParametrosAprendidos {
  return {
    margemPiso: mediana(estudos.map((e) => e.margemPiso)),
    margemAlvo: mediana(estudos.map((e) => e.margemAlvo)),
    margemInicial: mediana(estudos.map((e) => e.margemInicial)),
    despesasComerciaisAdmin: mediana(estudos.map((e) => e.despesasComerciaisAdmin)),
    amostras: estudos.length,
  };
}

/** Mediana de uma lista (usada pela rota para resumir os itens de um estudo antigo). */
export function medianaOuNulo(valores: (number | null | undefined)[]): number | null {
  return mediana(valores.map((v) => v ?? null));
}
