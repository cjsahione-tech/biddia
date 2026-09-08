export type ItemProposta = {
  descricao: string;
  unidade: string;
  quantidade: number;
  valorUnitario: number;
  valorTotal: number;
};

export type ItemPropostaComDesconto = ItemProposta & {
  valorUnitarioComDesconto: number;
  valorTotalComDesconto: number;
};

export function parseItens(itensJson: string): ItemProposta[] {
  try {
    const parsed = JSON.parse(itensJson);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
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
