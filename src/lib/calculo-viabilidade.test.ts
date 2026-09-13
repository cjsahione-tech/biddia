import { describe, expect, it } from "vitest";
import { calcularItem, calcularConsolidado, calcularViabilidade, gerarRecomendacao } from "@/lib/calculo-viabilidade";
import { calcularAliquotaEfetivaSimples, SEED_FAIXAS_SIMPLES, SEED_PARAMETROS_REGIME } from "@/lib/tributos";
import type { ItemCalculoInput } from "@/lib/calculo-viabilidade";
import type { CustoItemServico, CustoItemProduto } from "@/lib/estudo-custos";

/** Mesma fórmula "por dentro" da especificação, escrita de forma independente aqui só
 * para servir de oráculo nos testes — se algum dia divergir de calculo-viabilidade.ts,
 * o teste aponta exatamente onde. */
function precoPorDentroEsperado(custoTotal: number, percentualTributos: number, percentualMargem: number) {
  return custoTotal / (1 - percentualTributos / 100 - percentualMargem / 100);
}

describe("calcularItem — ramo Serviço", () => {
  const custos: CustoItemServico = {
    quantidadeProfissionais: 2,
    salarioBase: 3000,
    percentualEncargos: 80,
    insumos: 500,
    equipamentos: 300,
    deslocamento: 200,
    administracaoCentral: 5,
    seguroGarantia: 2,
    risco: 2,
    despesasFinanceiras: 1,
    lucroDesejado: 15,
  };
  const input: ItemCalculoInput = { descricao: "Posto de vigilância", quantidade: 1, valorTetoEdital: 20_000, custos };

  it("calcula custo direto (mão de obra + encargos + insumos) e despesas indiretas (BDI) corretamente", () => {
    const resultado = calcularItem(input, "SERVICO", 10, 20);
    // mão de obra = 2 * 3000 * (1 + 80/100) = 10800; +500+300+200 = 11800
    expect(resultado.custoDireto).toBe(11800);
    // BDI (adm+seguro+risco+financeiras = 10%) sobre custo direto
    expect(resultado.despesasIndiretas).toBe(1180);
  });

  it("aplica a fórmula por dentro (custo / (1 - tributos% - margem%)) para o preço mínimo viável", () => {
    const resultado = calcularItem(input, "SERVICO", 10, 20);
    const custoTotal = resultado.custoDireto + resultado.despesasIndiretas;
    const esperado = precoPorDentroEsperado(custoTotal, 10, resultado.percentualMargemDesejada);
    expect(resultado.percentualMargemDesejada).toBe(15);
    expect(resultado.precoMinimoViavel).toBeCloseTo(esperado, 2);
    expect(resultado.precoMinimoViavel).toBeCloseTo(17306.67, 2);
  });

  it("ponto de equilíbrio usa a mesma fórmula com margem = 0", () => {
    const resultado = calcularItem(input, "SERVICO", 10, 20);
    const custoTotal = resultado.custoDireto + resultado.despesasIndiretas;
    expect(resultado.pontoEquilibrio).toBeCloseTo(precoPorDentroEsperado(custoTotal, 10, 0), 2);
    expect(resultado.pontoEquilibrio).toBeCloseTo(14422.22, 2);
  });

  it("classifica como Viável quando a margem no teto do edital está acima do mínimo aceitável", () => {
    const resultado = calcularItem(input, "SERVICO", 10, 20);
    // margem no teto = (1 - 10%) - 11800+1180=12980/20000 = 25.1%, acima do mínimo de 20%
    expect(resultado.margemLiquidaNoTeto).toBeCloseTo(25.1, 2);
    expect(resultado.indicador).toBe("VIAVEL");
  });

  it("a análise de sensibilidade reclassifica o item quando o custo sobe 10%", () => {
    const resultado = calcularItem(input, "SERVICO", 10, 20);
    expect(resultado.sensibilidade.custoMenos10.indicador).toBe("VIAVEL");
    expect(resultado.sensibilidade.custoMais10.margemLiquidaPercentual).toBeCloseTo(18.61, 2);
    expect(resultado.sensibilidade.custoMais10.indicador).toBe("MARGINAL");
  });

  it("não tem preço mínimo viável quando tributos + margem desejada somam 100% ou mais da receita", () => {
    const custosImpossiveis: CustoItemServico = { ...custos, lucroDesejado: 95 };
    const resultado = calcularItem(
      { ...input, custos: custosImpossiveis },
      "SERVICO",
      10,
      20
    );
    expect(resultado.precoMinimoViavel).toBeNull();
    expect(resultado.precoUnitarioMinimo).toBeNull();
    expect(resultado.margemDesejadaInviavel).toBe(true);
  });
});

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
    const resultado = calcularItem(input, "PRODUTO", 13, 5);
    // 100*10 + 50 + 30 = 1080; despesas comerciais/admin (8%) sobre custo direto = 86.4
    expect(resultado.custoDireto).toBe(1080);
    expect(resultado.despesasIndiretas).toBeCloseTo(86.4, 5);
  });

  it("aplica a fórmula por dentro e devolve também o preço unitário mínimo", () => {
    const resultado = calcularItem(input, "PRODUTO", 13, 5);
    // custoTotal = 1166.4; preço mínimo = 1166.4 / (1 - 0.13 - 0.12) = 1555.2
    expect(resultado.precoMinimoViavel).toBeCloseTo(1555.2, 2);
    expect(resultado.precoUnitarioMinimo).toBeCloseTo(155.52, 2);
  });

  it("classifica como Viável quando a margem no teto supera o mínimo aceitável", () => {
    const resultado = calcularItem(input, "PRODUTO", 13, 5);
    expect(resultado.margemLiquidaNoTeto).toBeCloseTo(28.68, 2);
    expect(resultado.indicador).toBe("VIAVEL");
  });
});

describe("fórmula de precificação aplicada aos três regimes tributários", () => {
  const custos: CustoItemServico = {
    quantidadeProfissionais: 1,
    salarioBase: 5000,
    percentualEncargos: 0,
    insumos: 0,
    equipamentos: 0,
    deslocamento: 0,
    administracaoCentral: 0,
    seguroGarantia: 0,
    risco: 0,
    despesasFinanceiras: 0,
    lucroDesejado: 15,
  };
  const input: ItemCalculoInput = { descricao: "Consultoria", quantidade: 1, valorTetoEdital: 15_000, custos };
  const custoTotal = 5000; // sem BDI e sem encargos, custo direto = despesas totais

  it("Simples Nacional: usa a alíquota efetiva (LC 123/2006) resolvida a partir do RBT12", () => {
    const faixa = SEED_FAIXAS_SIMPLES.find((f) => f.anexo === "III" && f.faixa === 1)!; // 6%, sem parcela a deduzir
    const aliquota = calcularAliquotaEfetivaSimples(faixa, 100_000);
    const resultado = calcularItem(input, "SERVICO", aliquota, 10);
    expect(aliquota).toBeCloseTo(6, 5);
    expect(resultado.precoMinimoViavel).toBeCloseTo(precoPorDentroEsperado(custoTotal, aliquota, 15), 2);
  });

  it("Lucro Presumido: usa a soma dos parâmetros do regime (ISS/ICMS + PIS + COFINS + IRPJ/CSLL)", () => {
    const parametro = SEED_PARAMETROS_REGIME.find((p) => p.regime === "LUCRO_PRESUMIDO" && p.ramo === "SERVICO")!;
    const aliquota = parametro.issOuIcms + parametro.pis + parametro.cofins + parametro.irpjCsll;
    const resultado = calcularItem(input, "SERVICO", aliquota, 10);
    expect(resultado.precoMinimoViavel).toBeCloseTo(precoPorDentroEsperado(custoTotal, aliquota, 15), 2);
  });

  it("Lucro Real: usa a soma dos parâmetros do regime, tipicamente com carga tributária diferente do Presumido", () => {
    const parametro = SEED_PARAMETROS_REGIME.find((p) => p.regime === "LUCRO_REAL" && p.ramo === "SERVICO")!;
    const aliquota = parametro.issOuIcms + parametro.pis + parametro.cofins + parametro.irpjCsll;
    const resultado = calcularItem(input, "SERVICO", aliquota, 10);
    expect(resultado.precoMinimoViavel).toBeCloseTo(precoPorDentroEsperado(custoTotal, aliquota, 15), 2);
  });

  it("quanto maior a alíquota efetiva do regime, maior o preço mínimo necessário para a mesma margem", () => {
    const parametroPresumido = SEED_PARAMETROS_REGIME.find((p) => p.regime === "LUCRO_PRESUMIDO" && p.ramo === "SERVICO")!;
    const parametroReal = SEED_PARAMETROS_REGIME.find((p) => p.regime === "LUCRO_REAL" && p.ramo === "SERVICO")!;
    const aliquotaPresumido = parametroPresumido.issOuIcms + parametroPresumido.pis + parametroPresumido.cofins + parametroPresumido.irpjCsll;
    const aliquotaReal = parametroReal.issOuIcms + parametroReal.pis + parametroReal.cofins + parametroReal.irpjCsll;

    const resultadoPresumido = calcularItem(input, "SERVICO", aliquotaPresumido, 10);
    const resultadoReal = calcularItem(input, "SERVICO", aliquotaReal, 10);

    if (aliquotaPresumido > aliquotaReal) {
      expect(resultadoPresumido.precoMinimoViavel!).toBeGreaterThan(resultadoReal.precoMinimoViavel!);
    } else {
      expect(resultadoReal.precoMinimoViavel!).toBeGreaterThan(resultadoPresumido.precoMinimoViavel!);
    }
  });
});

describe("cenário de edital com múltiplos itens/lotes", () => {
  function itemServico(descricao: string, salarioBase: number, lucroDesejado: number, valorTetoEdital: number): ItemCalculoInput {
    const custos: CustoItemServico = {
      quantidadeProfissionais: 1,
      salarioBase,
      percentualEncargos: 0,
      insumos: 0,
      equipamentos: 0,
      deslocamento: 0,
      administracaoCentral: 0,
      seguroGarantia: 0,
      risco: 0,
      despesasFinanceiras: 0,
      lucroDesejado,
    };
    return { descricao, quantidade: 1, valorTetoEdital, custos };
  }

  const itens: ItemCalculoInput[] = [
    itemServico("Lote 1 — viável", 2000, 20, 10_000),
    itemServico("Lote 2 — marginal", 8000, 5, 9_000),
    itemServico("Lote 3 — inviável", 9500, 5, 9_000),
  ];
  const percentualTributos = 10;
  const margemMinimaAceitavel = 15;

  it("classifica cada item/lote de forma independente (viável, marginal e inviável)", () => {
    const resultado = calcularViabilidade(itens, "SERVICO", percentualTributos, margemMinimaAceitavel);
    expect(resultado.itens.map((i) => i.indicador)).toEqual(["VIAVEL", "MARGINAL", "INVIAVEL"]);
  });

  it("consolida custo, valor de teto e quantidade de itens por situação corretamente", () => {
    const resultado = calcularViabilidade(itens, "SERVICO", percentualTributos, margemMinimaAceitavel);
    const { consolidado } = resultado;
    expect(consolidado.custoDiretoTotal).toBe(2000 + 8000 + 9500);
    expect(consolidado.valorTetoTotal).toBe(10_000 + 9_000 + 9_000);
    expect(consolidado.qtdItensViaveis).toBe(1);
    expect(consolidado.qtdItensMarginais).toBe(1);
    expect(consolidado.qtdItensInviaveis).toBe(1);
  });

  it("a margem líquida consolidada é calculada sobre os totais agregados, não a média dos itens", () => {
    const resultado = calcularConsolidado(
      calcularViabilidade(itens, "SERVICO", percentualTributos, margemMinimaAceitavel).itens,
      percentualTributos,
      margemMinimaAceitavel
    );
    // margem consolidada = (1 - 10%) - 19500/28000 = 20.36%
    expect(resultado.margemLiquidaConsolidada).toBeCloseTo(20.36, 2);
    // mesmo com um item inviável isolado, o edital inteiro pode ser viável no agregado
    expect(resultado.indicador).toBe("VIAVEL");
  });

  it("a recomendação final acompanha o indicador consolidado (não o pior item isolado)", () => {
    const resultado = calcularViabilidade(itens, "SERVICO", percentualTributos, margemMinimaAceitavel);
    expect(resultado.recomendacao.decisao).toBe("PARTICIPAR");

    const recomendacaoInviavel = gerarRecomendacao(
      { ...resultado.consolidado, indicador: "INVIAVEL" },
      margemMinimaAceitavel
    );
    expect(recomendacaoInviavel.decisao).toBe("NAO_PARTICIPAR");
  });
});
