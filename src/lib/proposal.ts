// Catálogo FECHADO de colunas extras que só ALGUNS editais pedem (ex: atas de registro
// de preços de longa duração costumam exigir "valor corrigido" por índice de reajuste).
// Fechado de propósito: a IA nunca inventa chave de coluna livre — isso quebraria a
// renderização da tabela na tela e no PDF/Word (ver agente3-financeiro.ts e
// proposta-comercial.ts).
export const CAMPOS_EXTRAS_CATALOGO = {
  valorUnitarioCorrigido: { label: "Valor unit. corrigido", tipo: "number" },
  marcaModelo: { label: "Marca/Modelo", tipo: "string" },
  prazoGarantiaMeses: { label: "Prazo de garantia (meses)", tipo: "number" },
} as const satisfies Record<string, { label: string; tipo: "number" | "string" }>;

export type ChaveCampoExtra = keyof typeof CAMPOS_EXTRAS_CATALOGO;

export function chaveCampoExtraValida(chave: string): chave is ChaveCampoExtra {
  return Object.prototype.hasOwnProperty.call(CAMPOS_EXTRAS_CATALOGO, chave);
}

export type ItemProposta = {
  // Número/identificação do item dentro do lote, como aparece no edital — null quando
  // não foi possível identificar (ex: proposta importada de planilha sem essa coluna).
  numero: number | null;
  descricao: string;
  unidade: string;
  quantidade: number;
  valorUnitario: number;
  valorTotal: number;
  // Lote/grupo do edital — null quando o edital não tem estrutura de lote (a maioria).
  lote: string | null;
  camposExtras?: Partial<Record<ChaveCampoExtra, number | string>>;
  // Distingue valor extraído pela IA (false) de valor que o usuário sobrescreveu na
  // tela (true) — usado só pra exibição/auditoria, nunca muda o cálculo em si.
  editadoManualmente: boolean;
};

export type ItemPropostaComDesconto = ItemProposta & {
  valorUnitarioComDesconto: number;
  valorTotalComDesconto: number;
};

export type LoteMeta = { numero: string; descricao: string; valorReferencia: number | null };

export function parseItens(itensJson: string): ItemProposta[] {
  try {
    const parsed = JSON.parse(itensJson);
    if (!Array.isArray(parsed)) return [];
    // Defaults pra compatibilidade retroativa: propostas salvas antes desta mudança não
    // têm numero/lote/editadoManualmente/camposExtras no JSON.
    return parsed.map(
      (it): ItemProposta => ({
        numero: it.numero ?? null,
        descricao: it.descricao,
        unidade: it.unidade,
        quantidade: it.quantidade,
        valorUnitario: it.valorUnitario,
        valorTotal: it.valorTotal,
        lote: it.lote ?? null,
        camposExtras: it.camposExtras,
        editadoManualmente: it.editadoManualmente ?? false,
      })
    );
  } catch {
    return [];
  }
}

export function parseLotes(lotesJson: string | null | undefined): LoteMeta[] {
  if (!lotesJson) return [];
  try {
    const parsed = JSON.parse(lotesJson);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function parseColunasExtras(colunasExtrasJson: string | null | undefined): ChaveCampoExtra[] {
  if (!colunasExtrasJson) return [];
  try {
    const parsed = JSON.parse(colunasExtrasJson);
    return Array.isArray(parsed) ? parsed.filter(chaveCampoExtraValida) : [];
  } catch {
    return [];
  }
}

/** null = nenhuma seleção salva ainda, o que significa "todos os lotes selecionados"
 * por padrão (ver FinanceTab.tsx) — só um array vazio significa "nenhum lote marcado". */
export function parseLotesSelecionados(lotesSelecionadosJson: string | null | undefined): string[] | null {
  if (!lotesSelecionadosJson) return null;
  try {
    const parsed = JSON.parse(lotesSelecionadosJson);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Aplica o desconto percentual sobre o valor unitário de cada item:
 * valor unitário com desconto × quantidade = valor total com desconto.
 */
export function aplicarDesconto(itens: ItemProposta[], descontoPercentual: number): ItemPropostaComDesconto[] {
  const fator = 1 - descontoPercentual / 100;
  return itens.map((item) => {
    const valorUnitarioComDesconto = round2(item.valorUnitario * fator);
    return {
      ...item,
      valorUnitarioComDesconto,
      valorTotalComDesconto: round2(valorUnitarioComDesconto * item.quantidade),
    };
  });
}

export function round2(n: number) {
  return Math.round(n * 100) / 100;
}
