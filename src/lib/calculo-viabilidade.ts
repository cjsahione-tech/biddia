/**
 * Motor de cálculo do Estudo de Viabilidade para o ramo Produto — função pura e isolada
 * da UI/banco (recebe dados já resolvidos, devolve o resultado). Fórmula "por dentro":
 *
 *   Preço = (Custo Direto + Despesas Indiretas) / (1 − %Tributos_sobre_receita − %Margem_desejada)
 *
 * %Tributos_sobre_receita vem de fora (já resolvido na Etapa 3 a partir dos parâmetros
 * tributários do regime/ramo escolhidos — este módulo não sabe nada sobre alíquotas). O
 * ramo Serviço usa a DRE mensal em src/lib/calculo-dre-servico.ts, não este módulo.
 */
import type { CustoItemProduto } from "@/lib/estudo-custos";

export type IndicadorViabilidade = "VIAVEL" | "MARGINAL" | "INVIAVEL";

export type ItemCalculoInput = {
  descricao: string;
  quantidade: number;
  valorTetoEdital: number;
  custos: CustoItemProduto;
};

export type CenarioSensibilidade = {
  margemLiquidaPercentual: number;
  indicador: IndicadorViabilidade;
};

export type ResultadoItemCalculo = {
  descricao: string;
  quantidade: number;
  custoDireto: number;
  despesasIndiretas: number;
  percentualMargemDesejada: number;
  /** null quando tributos + margem desejada somam 100% ou mais da receita — a fórmula
   * não tem solução matemática nesse caso (ver `margemDesejadaInviavel`). */
  precoMinimoViavel: number | null;
  precoUnitarioMinimo: number | null;
  margemDesejadaInviavel: boolean;
  valorTetoEdital: number;
  diferencaParaOTeto: number | null;
  /** Margem líquida percentual se o item for vendido pelo valor estimado do edital. */
  margemLiquidaNoTeto: number;
  /** Preço de margem zero (ponto de equilíbrio) — só cobre custo + tributos. */
  pontoEquilibrio: number | null;
  indicador: IndicadorViabilidade;
  sensibilidade: {
    custoMenos10: CenarioSensibilidade;
    custoMais10: CenarioSensibilidade;
  };
};

export type ResultadoConsolidado = {
  custoDiretoTotal: number;
  despesasIndiretasTotal: number;
  precoMinimoTotal: number;
  valorTetoTotal: number;
  margemLiquidaConsolidada: number;
  indicador: IndicadorViabilidade;
  qtdItensViaveis: number;
  qtdItensMarginais: number;
  qtdItensInviaveis: number;
};

export type Recomendacao = {
  decisao: "PARTICIPAR" | "PARTICIPAR_COM_RESSALVAS" | "NAO_PARTICIPAR";
  motivo: string;
};

export type ResultadoCalculoViabilidade = {
  itens: ResultadoItemCalculo[];
  consolidado: ResultadoConsolidado;
  recomendacao: Recomendacao;
  percentualTributos: number;
  margemMinimaAceitavel: number;
};

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function custoDiretoDoItem(custos: CustoItemProduto, quantidade: number): number {
  return custos.custoAquisicaoUnitario * quantidade + custos.freteLogistica + custos.icmsStDifal;
}

function despesasIndiretasDoItem(custos: CustoItemProduto, custoDireto: number): number {
  return custoDireto * (custos.despesasComerciaisAdmin / 100);
}

/** Fórmula "por dentro" — null quando tributos + margem >= 100% da receita (sem solução). */
function precoPorDentro(custoTotal: number, percentualTributos: number, percentualMargem: number): number | null {
  const denominador = 1 - percentualTributos / 100 - percentualMargem / 100;
  if (denominador <= 0) return null;
  return custoTotal / denominador;
}

export function classificarIndicador(margemLiquidaPercentual: number, margemMinimaAceitavel: number): IndicadorViabilidade {
  if (margemLiquidaPercentual < 0) return "INVIAVEL";
  if (margemLiquidaPercentual < margemMinimaAceitavel) return "MARGINAL";
  return "VIAVEL";
}

/** Margem líquida ao vender pelo valor do edital: receita menos tributos menos custo,
 * dividido pela receita. Sem valor de referência, não há como avaliar — trata como
 * inviável (nunca um falso "viável" por falta de dado). */
function margemLiquidaNoTeto(custoTotal: number, valorTeto: number, percentualTributos: number): number {
  if (valorTeto <= 0) return -100;
  return round2(((1 - percentualTributos / 100) - custoTotal / valorTeto) * 100);
}

export function calcularItem(
  input: ItemCalculoInput,
  percentualTributos: number,
  margemMinimaAceitavel: number
): ResultadoItemCalculo {
  const custoDireto = custoDiretoDoItem(input.custos, input.quantidade);
  const despesasIndiretas = despesasIndiretasDoItem(input.custos, custoDireto);
  const percentualMargemDesejada = input.custos.margemLucroDesejada;
  const custoTotal = custoDireto + despesasIndiretas;

  const precoMinimoViavel = precoPorDentro(custoTotal, percentualTributos, percentualMargemDesejada);
  const pontoEquilibrio = precoPorDentro(custoTotal, percentualTributos, 0);
  const margemNoTeto = margemLiquidaNoTeto(custoTotal, input.valorTetoEdital, percentualTributos);
  const indicador = classificarIndicador(margemNoTeto, margemMinimaAceitavel);

  function cenario(fatorCusto: number): CenarioSensibilidade {
    const cd = custoDireto * fatorCusto;
    const di = despesasIndiretasDoItem(input.custos, cd);
    const margem = margemLiquidaNoTeto(cd + di, input.valorTetoEdital, percentualTributos);
    return { margemLiquidaPercentual: margem, indicador: classificarIndicador(margem, margemMinimaAceitavel) };
  }

  return {
    descricao: input.descricao,
    quantidade: input.quantidade,
    custoDireto: round2(custoDireto),
    despesasIndiretas: round2(despesasIndiretas),
    percentualMargemDesejada,
    precoMinimoViavel: precoMinimoViavel != null ? round2(precoMinimoViavel) : null,
    precoUnitarioMinimo:
      precoMinimoViavel != null && input.quantidade > 0 ? round2(precoMinimoViavel / input.quantidade) : null,
    margemDesejadaInviavel: precoMinimoViavel == null,
    valorTetoEdital: round2(input.valorTetoEdital),
    diferencaParaOTeto: precoMinimoViavel != null ? round2(input.valorTetoEdital - precoMinimoViavel) : null,
    margemLiquidaNoTeto: margemNoTeto,
    pontoEquilibrio: pontoEquilibrio != null ? round2(pontoEquilibrio) : null,
    indicador,
    sensibilidade: {
      custoMenos10: cenario(0.9),
      custoMais10: cenario(1.1),
    },
  };
}

export function calcularConsolidado(
  itens: ResultadoItemCalculo[],
  percentualTributos: number,
  margemMinimaAceitavel: number
): ResultadoConsolidado {
  const custoDiretoTotal = itens.reduce((acc, i) => acc + i.custoDireto, 0);
  const despesasIndiretasTotal = itens.reduce((acc, i) => acc + i.despesasIndiretas, 0);
  const valorTetoTotal = itens.reduce((acc, i) => acc + i.valorTetoEdital, 0);
  const precoMinimoTotal = itens.reduce((acc, i) => acc + (i.precoMinimoViavel ?? 0), 0);
  const custoTotal = custoDiretoTotal + despesasIndiretasTotal;
  const margemLiquidaConsolidada = margemLiquidaNoTeto(custoTotal, valorTetoTotal, percentualTributos);

  return {
    custoDiretoTotal: round2(custoDiretoTotal),
    despesasIndiretasTotal: round2(despesasIndiretasTotal),
    precoMinimoTotal: round2(precoMinimoTotal),
    valorTetoTotal: round2(valorTetoTotal),
    margemLiquidaConsolidada,
    indicador: classificarIndicador(margemLiquidaConsolidada, margemMinimaAceitavel),
    qtdItensViaveis: itens.filter((i) => i.indicador === "VIAVEL").length,
    qtdItensMarginais: itens.filter((i) => i.indicador === "MARGINAL").length,
    qtdItensInviaveis: itens.filter((i) => i.indicador === "INVIAVEL").length,
  };
}

export function gerarRecomendacao(consolidado: ResultadoConsolidado, margemMinimaAceitavel: number): Recomendacao {
  if (consolidado.indicador === "INVIAVEL") {
    return {
      decisao: "NAO_PARTICIPAR",
      motivo: `Vendendo pelo valor estimado do edital (R$ ${consolidado.valorTetoTotal.toFixed(2)}), a margem líquida projetada é ${consolidado.margemLiquidaConsolidada.toFixed(2)}% — negativa depois de custos e tributos. Participar nessas condições geraria prejuízo.`,
    };
  }
  if (consolidado.indicador === "MARGINAL") {
    return {
      decisao: "PARTICIPAR_COM_RESSALVAS",
      motivo: `A margem líquida projetada (${consolidado.margemLiquidaConsolidada.toFixed(2)}%) fica abaixo do mínimo aceitável definido (${margemMinimaAceitavel.toFixed(2)}%) — viável, mas com pouca folga. Reavalie os custos, especialmente nos ${consolidado.qtdItensInviaveis + consolidado.qtdItensMarginais} item(ns) marginal(is)/inviável(is), antes de decidir.`,
    };
  }
  return {
    decisao: "PARTICIPAR",
    motivo: `A margem líquida projetada (${consolidado.margemLiquidaConsolidada.toFixed(2)}%) está acima do mínimo aceitável (${margemMinimaAceitavel.toFixed(2)}%), com o preço mínimo viável (R$ ${consolidado.precoMinimoTotal.toFixed(2)}) dentro do valor estimado pelo edital (R$ ${consolidado.valorTetoTotal.toFixed(2)}).`,
  };
}

/** Ponto de entrada único: calcula item a item, consolida e recomenda. */
export function calcularViabilidade(
  itens: ItemCalculoInput[],
  percentualTributos: number,
  margemMinimaAceitavel: number
): ResultadoCalculoViabilidade {
  const resultadoItens = itens.map((item) => calcularItem(item, percentualTributos, margemMinimaAceitavel));
  const consolidado = calcularConsolidado(resultadoItens, percentualTributos, margemMinimaAceitavel);
  const recomendacao = gerarRecomendacao(consolidado, margemMinimaAceitavel);

  return { itens: resultadoItens, consolidado, recomendacao, percentualTributos, margemMinimaAceitavel };
}
