import { describe, expect, it } from "vitest";
import { calcularItem, calcularConsolidado, calcularViabilidade, gerarRecomendacao } from "@/lib/calculo-viabilidade";
import type { ItemCalculoInput } from "@/lib/calculo-viabilidade";
import type { CustoItemProduto } from "@/lib/estudo-custos";

/** Mesma fórmula "por dentro" da especificação, escrita de forma independente aqui só
 * para servir de oráculo nos testes — se algum dia divergir de calculo-viabilidade.ts,
 * o teste aponta exatamente onde. */
function precoPorDentroEsperado(custoTotal: number, percentualTributos: number, percentualMargem: number) {
  return custoTotal / (1 - percentualTributos / 100 - percentualMargem / 100);
}

describe("calcularItem — ramo Produto", () => {
  const custos: CustoItemProduto = {
    custoAquisicaoUnitario: 100,
    freteLogistica: 50,
    icmsStDifal: 30,
    despesasComerciaisAdmin: 8,
    margemLucroDesejada: 12,
  };
  const input: ItemCalculoInput = { descricao: "Notebook", quantidade: 10, valorTetoEdital: 2000, custos };

  it("calcula custo direto (aquisição × quantidade + frete + ICMS-ST) e despesas indiretas", () => {
    const resultado = calcularItem(input, 13, 5);
    // 100*10 + 50 + 30 = 1080; despesas comerciais/admin (8%) sobre custo direto = 86.4
    expect(resultado.custoDireto).toBe(1080);
    expect(resultado.despesasIndiretas).toBeCloseTo(86.4, 5);
  });

  it("aplica a fórmula por dentro e devolve também o preço unitário mínimo", () => {
    const resultado = calcularItem(input, 13, 5);
    const custoTotal = resultado.custoDireto + resultado.despesasIndiretas;
    const esperado = precoPorDentroEsperado(custoTotal, 13, resultado.percentualMargemDesejada);
    // custoTotal = 1166.4; preço mínimo = 1166.4 / (1 - 0.13 - 0.12) = 1555.2
    expect(resultado.precoMinimoViavel).toBeCloseTo(esperado, 2);
    expect(resultado.precoMinimoViavel).toBeCloseTo(1555.2, 2);
    expect(resultado.precoUnitarioMinimo).toBeCloseTo(155.52, 2);
  });

  it("ponto de equilíbrio usa a mesma fórmula com margem = 0", () => {
    const resultado = calcularItem(input, 13, 5);
    const custoTotal = resultado.custoDireto + resultado.despesasIndiretas;
    expect(resultado.pontoEquilibrio).toBeCloseTo(precoPorDentroEsperado(custoTotal, 13, 0), 2);
  });

  it("classifica como Viável quando a margem no teto supera o mínimo aceitável", () => {
    const resultado = calcularItem(input, 13, 5);
    expect(resultado.margemLiquidaNoTeto).toBeCloseTo(28.68, 2);
    expect(resultado.indicador).toBe("VIAVEL");
  });

  it("não tem preço mínimo viável quando tributos + margem desejada somam 100% ou mais da receita", () => {
    const custosImpossiveis: CustoItemProduto = { ...custos, margemLucroDesejada: 90 };
    const resultado = calcularItem({ ...input, custos: custosImpossiveis }, 13, 5);
    expect(resultado.precoMinimoViavel).toBeNull();
    expect(resultado.precoUnitarioMinimo).toBeNull();
    expect(resultado.margemDesejadaInviavel).toBe(true);
  });

  it("a análise de sensibilidade reclassifica o item quando o custo sobe ou desce 10%", () => {
    const margemCurta: CustoItemProduto = { ...custos, margemLucroDesejada: 12 };
    const inputMargemJusta: ItemCalculoInput = { descricao: "Notebook", quantidade: 10, valorTetoEdital: 1300, custos: margemCurta };
    const resultado = calcularItem(inputMargemJusta, 13, 20);
    expect(resultado.sensibilidade.custoMenos10.margemLiquidaPercentual).toBeGreaterThan(
      resultado.sensibilidade.custoMais10.margemLiquidaPercentual
    );
  });
});

describe("fórmula de precificação aplicada aos três regimes tributários (ramo Produto)", () => {
  const custos: CustoItemProduto = {
    custoAquisicaoUnitario: 500,
    freteLogistica: 0,
    icmsStDifal: 0,
    despesasComerciaisAdmin: 0,
    margemLucroDesejada: 15,
  };
  const input: ItemCalculoInput = { descricao: "Equipamento", quantidade: 1, valorTetoEdital: 1000, custos };
  const custoTotal = 500;

  it("Simples Nacional (alíquota efetiva baixa) resulta em preço mínimo menor que Lucro Presumido/Real", () => {
    const resultadoSimples = calcularItem(input, 6, 15);
    const resultadoPresumido = calcularItem(input, 23.93, 15); // seed LUCRO_PRESUMIDO/PRODUTO
    expect(resultadoSimples.precoMinimoViavel!).toBeLessThan(resultadoPresumido.precoMinimoViavel!);
  });

  it("cada regime aplica exatamente a fórmula por dentro com sua própria alíquota", () => {
    for (const aliquota of [6, 23.93, 24.85]) {
      const resultado = calcularItem(input, aliquota, 15);
      expect(resultado.precoMinimoViavel).toBeCloseTo(precoPorDentroEsperado(custoTotal, aliquota, 15), 2);
    }
  });
});

describe("cenário de edital com múltiplos itens/lotes (ramo Produto)", () => {
  function itemProduto(descricao: string, custoAquisicaoUnitario: number, margem: number, valorTetoEdital: number): ItemCalculoInput {
    const custos: CustoItemProduto = {
      custoAquisicaoUnitario,
      freteLogistica: 0,
      icmsStDifal: 0,
      despesasComerciaisAdmin: 0,
      margemLucroDesejada: margem,
    };
    return { descricao, quantidade: 1, valorTetoEdital, custos };
  }

  const itens: ItemCalculoInput[] = [
    itemProduto("Lote 1 — viável", 2000, 20, 10_000),
    itemProduto("Lote 2 — marginal", 8000, 5, 9_000),
    itemProduto("Lote 3 — inviável", 9500, 5, 9_000),
  ];
  const percentualTributos = 10;
  const margemMinimaAceitavel = 15;

  it("classifica cada item/lote de forma independente (viável, marginal e inviável)", () => {
    const resultado = calcularViabilidade(itens, percentualTributos, margemMinimaAceitavel);
    expect(resultado.itens.map((i) => i.indicador)).toEqual(["VIAVEL", "MARGINAL", "INVIAVEL"]);
  });

  it("consolida custo, valor de teto e quantidade de itens por situação corretamente", () => {
    const resultado = calcularViabilidade(itens, percentualTributos, margemMinimaAceitavel);
    const { consolidado } = resultado;
    expect(consolidado.custoDiretoTotal).toBe(2000 + 8000 + 9500);
    expect(consolidado.valorTetoTotal).toBe(10_000 + 9_000 + 9_000);
    expect(consolidado.qtdItensViaveis).toBe(1);
    expect(consolidado.qtdItensMarginais).toBe(1);
    expect(consolidado.qtdItensInviaveis).toBe(1);
  });

  it("a margem líquida consolidada é calculada sobre os totais agregados, não a média dos itens", () => {
    const resultado = calcularConsolidado(
      calcularViabilidade(itens, percentualTributos, margemMinimaAceitavel).itens,
      percentualTributos,
      margemMinimaAceitavel
    );
    // margem consolidada = (1 - 10%) - 19500/28000 = 20.36%
    expect(resultado.margemLiquidaConsolidada).toBeCloseTo(20.36, 2);
    // mesmo com um item inviável isolado, o edital inteiro pode ser viável no agregado
    expect(resultado.indicador).toBe("VIAVEL");
  });

  it("a recomendação final acompanha o indicador consolidado (não o pior item isolado)", () => {
    const resultado = calcularViabilidade(itens, percentualTributos, margemMinimaAceitavel);
    expect(resultado.recomendacao.decisao).toBe("PARTICIPAR");

    const recomendacaoInviavel = gerarRecomendacao({ ...resultado.consolidado, indicador: "INVIAVEL" }, margemMinimaAceitavel);
    expect(recomendacaoInviavel.decisao).toBe("NAO_PARTICIPAR");
  });
});
