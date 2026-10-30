import { describe, expect, it } from "vitest";
import { calcularViabilidade } from "@/lib/calculo-viabilidade";
import {
  calcularCenarios,
  calcularItemCenarios,
  explicarResultado,
  resultadoParaRelatorio,
  validarMargens,
  type ItemCenarioInput,
  type MargensEstudo,
} from "@/lib/estudo-cenarios";
import type { CustoItemProduto } from "@/lib/estudo-custos";

const custos: CustoItemProduto = {
  custoAquisicaoUnitario: 100,
  freteLogistica: 50,
  icmsStDifal: 30,
  despesasComerciaisAdmin: 8,
  margemLucroDesejada: 12,
};
const margens: MargensEstudo = { piso: 5, alvo: 12, inicial: 20 };
const TRIB = 13;

// custo direto = 100*10 + 50 + 30 = 1080 ; despesas 8% = 86,40 ; custo total = 1166,40
function item(teto: number, c: Partial<CustoItemProduto> = {}): ItemCenarioInput {
  return { descricao: "Notebook", quantidade: 10, valorTetoTotal: teto, custos: { ...custos, ...c } };
}

describe("calcularItemCenarios — as três contas", () => {
  it("calcula custo total e os preços Piso, Alvo e Inicial pela fórmula por dentro", () => {
    const r = calcularItemCenarios(item(2000), TRIB, margens);
    expect(r.custoDireto).toBe(1080);
    expect(r.despesasIndiretas).toBe(86.4);
    expect(r.custoTotal).toBe(1166.4);
    // 1166,40 / (1 - 0,13 - margem)
    expect(r.cenarios.PISO.precoTotal).toBe(1422.44); // /0,82
    expect(r.cenarios.ALVO.precoTotal).toBe(1555.2); // /0,75
    expect(r.cenarios.INICIAL.precoTotal).toBe(1740.9); // /0,67
    expect(r.cenarios.ALVO.precoUnitario).toBe(155.52);
  });

  it("lucro em reais e margem líquida batem com a margem pedida", () => {
    const r = calcularItemCenarios(item(2000), TRIB, margens);
    const alvo = r.cenarios.ALVO;
    expect(alvo.tributosValor).toBe(202.18); // 13% de 1555,20
    expect(alvo.lucroValor).toBe(186.62); // 1555,20 - 202,18 - 1166,40
    expect(alvo.margemLiquidaPercentual).toBe(12);
    expect(r.cenarios.PISO.margemLiquidaPercentual).toBe(5);
  });

  it("calcula o desconto sobre o valor do edital e a folga máxima para lances", () => {
    const r = calcularItemCenarios(item(2000), TRIB, margens);
    expect(r.cenarios.ALVO.descontoSobreTetoPercentual).toBe(22.24); // (2000-1555,2)/2000
    expect(r.descontoMaximoPercentual).toBe(28.88); // (2000-1422,44)/2000
    expect(r.status).toBe("VIAVEL_COMPETITIVO");
  });

  it("o preço Inicial nunca passa do valor do edital: é travado no teto", () => {
    const r = calcularItemCenarios(item(1600), TRIB, margens);
    const ini = r.cenarios.INICIAL;
    expect(ini.precoTotal).toBe(1600);
    expect(ini.limitadoAoTeto).toBe(true);
    expect(ini.descontoSobreTetoPercentual).toBe(0);
    // margem real ao vender pelo teto: (1600 - 208 - 1166,40)/1600 = 14,1%
    expect(ini.margemLiquidaPercentual).toBe(14.1);
    expect(r.status).toBe("VIAVEL_COMPETITIVO");
  });

  it("DISPUTA APERTADA: o piso cabe no edital, mas o alvo não", () => {
    const r = calcularItemCenarios(item(1500), TRIB, margens);
    expect(r.cenarios.PISO.acimaDoTeto).toBe(false);
    expect(r.cenarios.ALVO.acimaDoTeto).toBe(true);
    expect(r.status).toBe("DISPUTA_APERTADA");
    expect(r.descontoMaximoPercentual).toBe(5.17); // (1500-1422,44)/1500
  });

  it("INVIÁVEL: nem o piso cabe no valor do edital", () => {
    const r = calcularItemCenarios(item(1300), TRIB, margens);
    expect(r.status).toBe("INVIAVEL");
    expect(r.descontoMaximoPercentual).toBeNull();
    // vendendo pelo teto: (1300 - 169 - 1166,40)/1300
    expect(r.margemNoTeto).toBe(-2.72);
    expect(r.lucroNoTeto).toBe(-35.4);
  });

  it("tributos + margem >= 100% não têm solução: preço nulo e inviável (sem dividir por zero)", () => {
    const r = calcularItemCenarios(item(2000), 85, { piso: 5, alvo: 15, inicial: 20 });
    expect(r.cenarios.ALVO.precoTotal).toBeNull(); // 85 + 15 = 100
    expect(r.cenarios.INICIAL.precoTotal).toBeNull();
    expect(r.cenarios.PISO.precoTotal).not.toBeNull();
    expect(r.status).not.toBe("VIAVEL_COMPETITIVO");
  });
});

describe("calcularItemCenarios — proteções contra falso viável", () => {
  it("custo zero NÃO vira viável: fica SEM_CUSTO e sem preços", () => {
    const r = calcularItemCenarios(item(2000, { custoAquisicaoUnitario: 0, freteLogistica: 0, icmsStDifal: 0 }), TRIB, margens);
    expect(r.status).toBe("SEM_CUSTO");
    expect(r.cenarios.ALVO.precoTotal).toBeNull();
    expect(r.margemNoTeto).toBeNull();
  });

  it("só frete preenchido (sem custo de aquisição) também não conta como custo", () => {
    const r = calcularItemCenarios(item(2000, { custoAquisicaoUnitario: 0, freteLogistica: 500 }), TRIB, margens);
    expect(r.status).toBe("SEM_CUSTO");
  });

  it("edital sem valor divulgado: calcula os preços, mas não dá veredito", () => {
    const r = calcularItemCenarios(item(0), TRIB, margens);
    expect(r.status).toBe("SEM_TETO");
    expect(r.cenarios.PISO.precoTotal).toBe(1422.44);
    expect(r.cenarios.PISO.descontoSobreTetoPercentual).toBeNull();
    expect(r.cenarios.INICIAL.limitadoAoTeto).toBe(false);
    expect(r.descontoMaximoPercentual).toBeNull();
  });

  it("entradas inválidas (NaN, negativo) são tratadas como zero e não quebram", () => {
    const r = calcularItemCenarios(item(2000, { custoAquisicaoUnitario: Number.NaN }), TRIB, margens);
    expect(r.status).toBe("SEM_CUSTO");
    const neg = calcularItemCenarios({ ...item(2000), quantidade: -5 }, TRIB, margens);
    expect(neg.status).toBe("SEM_CUSTO");
  });
});

describe("calcularCenarios — total do estudo", () => {
  it("soma os itens e dá o veredito pelo total", () => {
    const r = calcularCenarios([item(2000), item(2000)], TRIB, margens);
    const c = r.consolidado;
    expect(c.completo).toBe(true);
    expect(c.status).toBe("VIAVEL_COMPETITIVO");
    expect(c.custoTotal).toBe(2332.8);
    expect(c.valorTetoTotal).toBe(4000);
    expect(c.cenarios.ALVO.precoTotal).toBe(3110.4);
    expect(c.cenarios.PISO.precoTotal).toBe(2844.88);
    expect(c.cenarios.ALVO.margemLiquidaPercentual).toBe(12);
    expect(c.qtdCompetitivos).toBe(2);
  });

  it("um item sem custo deixa o estudo INCOMPLETO — nunca viável", () => {
    const r = calcularCenarios([item(2000), item(2000, { custoAquisicaoUnitario: 0 })], TRIB, margens);
    expect(r.consolidado.completo).toBe(false);
    expect(r.consolidado.status).toBe("INCOMPLETO");
    expect(r.consolidado.itensSemCusto).toBe(1);
    expect(explicarResultado(r)).toContain("sem custo informado");
  });

  it("um item sem valor de referência também deixa INCOMPLETO", () => {
    const r = calcularCenarios([item(2000), item(0)], TRIB, margens);
    expect(r.consolidado.status).toBe("INCOMPLETO");
    expect(r.consolidado.itensSemTeto).toBe(1);
  });

  it("sem itens = INCOMPLETO", () => {
    const r = calcularCenarios([], TRIB, margens);
    expect(r.consolidado.status).toBe("INCOMPLETO");
    expect(explicarResultado(r)).toContain("não tem itens");
  });

  it("um item inviável pode ser compensado no total (edital de preço global)", () => {
    // item A: teto 3000 (folga grande); item B: teto 1300 (inviável sozinho)
    const r = calcularCenarios([item(3000), item(1300)], TRIB, margens);
    expect(r.itens[1].status).toBe("INVIAVEL");
    expect(r.consolidado.status).toBe("VIAVEL_COMPETITIVO");
    expect(r.consolidado.qtdInviaveis).toBe(1);
  });

  it("o preço Alvo é o mesmo que o motor antigo chamava de preço mínimo viável", () => {
    const legado = calcularViabilidade(
      [{ descricao: "Notebook", quantidade: 10, valorTetoEdital: 2000, custos }],
      TRIB,
      5
    );
    const novo = calcularCenarios([item(2000)], TRIB, margens);
    expect(novo.itens[0].cenarios.ALVO.precoTotal).toBe(legado.itens[0].precoMinimoViavel);
    expect(novo.itens[0].custoTotal).toBe(legado.itens[0].custoDireto + legado.itens[0].despesasIndiretas);
  });
});

describe("resultadoParaRelatorio — ligação com o relatório antigo", () => {
  function legadoDe(teto: number) {
    return calcularViabilidade([{ descricao: "Notebook", quantidade: 10, valorTetoEdital: teto, custos }], TRIB, margens.piso);
  }

  it("viável → PARTICIPAR e indicador VIAVEL; guarda os cenários dentro", () => {
    const cen = calcularCenarios([item(2000)], TRIB, margens);
    const r = resultadoParaRelatorio(legadoDe(2000), cen);
    expect(r.recomendacao.decisao).toBe("PARTICIPAR");
    expect(r.consolidado.indicador).toBe("VIAVEL");
    expect(r.itens[0].indicador).toBe("VIAVEL");
    expect(r.cenarios.consolidado.status).toBe("VIAVEL_COMPETITIVO");
    expect(r.margemMinimaAceitavel).toBe(5);
  });

  it("disputa apertada → PARTICIPAR_COM_RESSALVAS", () => {
    const r = resultadoParaRelatorio(legadoDe(1500), calcularCenarios([item(1500)], TRIB, margens));
    expect(r.recomendacao.decisao).toBe("PARTICIPAR_COM_RESSALVAS");
    expect(r.consolidado.indicador).toBe("MARGINAL");
    expect(r.consolidado.qtdItensMarginais).toBe(1);
  });

  it("inviável → NAO_PARTICIPAR, mesmo quando o motor antigo diria só 'ressalvas'", () => {
    // teto 1250: margem no teto = (1250-162,5-1166,4)/1250 = -6,3% → antigo também inviável; usa 1290 para margem ~ -2.8%
    const r = resultadoParaRelatorio(legadoDe(1300), calcularCenarios([item(1300)], TRIB, margens));
    expect(r.recomendacao.decisao).toBe("NAO_PARTICIPAR");
    expect(r.consolidado.indicador).toBe("INVIAVEL");
  });

  it("caso do piso: margem no teto entre 0 e o piso é INVIÁVEL no novo e antes era só 'ressalvas'", () => {
    // teto 1400: margem no teto = (1400-182-1166,4)/1400 = 3,69% (> 0 e < 5% do piso)
    const antigo = legadoDe(1400);
    expect(antigo.recomendacao.decisao).toBe("PARTICIPAR_COM_RESSALVAS");
    const novo = resultadoParaRelatorio(antigo, calcularCenarios([item(1400)], TRIB, margens));
    expect(novo.cenarios.consolidado.status).toBe("INVIAVEL");
    expect(novo.recomendacao.decisao).toBe("NAO_PARTICIPAR");
  });

  it("estudo incompleto não troca o veredito do motor antigo", () => {
    const cen = calcularCenarios([item(2000, { custoAquisicaoUnitario: 0 })], TRIB, margens);
    const legado = legadoDe(2000);
    const r = resultadoParaRelatorio(legado, cen);
    expect(r.recomendacao).toEqual(legado.recomendacao);
  });
});

describe("validarMargens", () => {
  it("aceita piso <= alvo <= inicial", () => {
    expect(validarMargens(margens, TRIB)).toBeNull();
  });
  it("recusa ordem trocada, negativa ou que fecha 100%", () => {
    expect(validarMargens({ piso: 15, alvo: 10, inicial: 20 }, TRIB)).toContain("piso");
    expect(validarMargens({ piso: 5, alvo: 25, inicial: 20 }, TRIB)).toContain("alvo");
    expect(validarMargens({ piso: -1, alvo: 10, inicial: 20 }, TRIB)).toContain("zero");
    expect(validarMargens({ piso: 5, alvo: 10, inicial: 90 }, TRIB)).toContain("100%");
  });
});
