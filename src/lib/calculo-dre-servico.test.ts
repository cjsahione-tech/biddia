import { describe, expect, it } from "vitest";
import { calcularDreServico } from "@/lib/calculo-dre-servico";
import type { CargoServico, CustoOperacionalLinha } from "@/lib/estudo-custos";
import type { AliquotasResolvidas } from "@/lib/tributos";

function cargo(nome: string, quantidade: number, valorUnitarioMensal: number): CargoServico {
  return { nome, quantidade, salarioBase: valorUnitarioMensal, percentualEncargos: 0, beneficiosValor: 0, origemEdital: true };
}

function custoOperacional(nome: string, valorMensal: number): CustoOperacionalLinha {
  return { nome, quantidade: null, valorUnitario: null, valorMensal };
}

describe("calcularDreServico — reprodução de um estudo real (laboratório de análises clínicas)", () => {
  // Números tirados de uma DRE real (Pregão 083/2026 — Fundação iNOVA Capixaba, Lucro
  // Presumido com equiparação hospitalar) — serve de teste de regressão contra um
  // cenário validado externamente, não só contra a própria fórmula.
  const valorTetoLote = 303_826.4125; // teto tal que 20% de desconto dá receita de R$243.061,13
  const aliquotas: AliquotasResolvidas = {
    regime: "LUCRO_PRESUMIDO",
    ramo: "SERVICO",
    aliquotaTotalEfetiva: 0.65 + 3.0 + 3.0 + 2.28,
    detalhes: { issOuIcms: 3.0, pis: 0.65, cofins: 3.0, irpjCsll: 2.28 },
    baseCalculoPresumidoPercentual: 8, // equiparação hospitalar
  };

  const cargos: CargoServico[] = [
    cargo("Técnico de Laboratório/Análises Clínicas", 6, 4614.48),
    cargo("Técnico de Enfermagem", 2, 6090.0),
    cargo("Biomédico", 2, 5996.22),
    cargo("Farmacêutico Bioquímico (RT/Gestão)", 1, 6648.9),
    cargo("Médico Patologista Clínico (RT)", 1, 7268.48),
    cargo("Auxiliar Administrativo", 1, 3852.58),
  ];

  const custosOperacionais: CustoOperacionalLinha[] = [
    custoOperacional("Pacote Aluguel laboratorial", 5500),
    custoOperacional("Luz e água (operação 24h/dia, 365 dias/ano)", 4500),
    custoOperacional("Material para administrativo", 3500),
    custoOperacional("Equipamento — Bioquímica", 5000),
    custoOperacional("Equipamento — Hematologia", 5000),
    custoOperacional("Equipamento — Gasometria", 5000),
    custoOperacional("Equipamento — Urinálise", 5000),
    custoOperacional("Insumos de coleta", 34_480 * 0.35),
    custoOperacional("Insumos de microbiologia", 1834 * 14.5),
  ];

  const resultado = calcularDreServico({
    valorTetoLote,
    descontoPercentual: 20,
    duracaoContratoMeses: 24,
    cargos,
    custosOperacionais,
    aliquotas,
    margemMinimaAceitavel: 10,
  });

  it("calcula a receita bruta mensal a partir do desconto sobre o teto do lote", () => {
    expect(resultado.receitaBrutaMensal).toBeCloseTo(243_061.13, 2);
  });

  it("soma os custos operacionais diretos exatamente como a planilha de referência", () => {
    expect(resultado.custosOperacionaisTotal).toBeCloseTo(72_161.0, 2);
  });

  it("soma a folha de pagamento (quantidade × valor unitário por cargo) exatamente como a planilha de referência", () => {
    expect(resultado.folhaPagamentoTotal).toBeCloseTo(69_629.28, 2);
    const tecnico = resultado.folhaPagamento.find((c) => c.nome.includes("Técnico de Laboratório"))!;
    expect(tecnico.valorMensal).toBeCloseTo(27_686.88, 2);
  });

  it("abre os impostos do Lucro Presumido por tipo (ISS, PIS, COFINS, IRPJ+CSLL) e soma próximo da referência", () => {
    const nomes = resultado.impostos.map((i) => i.nome);
    expect(nomes).toEqual(expect.arrayContaining(["ISS", "PIS", "COFINS", "IRPJ + CSLL"]));
    // Tolerância de 1 centavo: a planilha de referência arredonda linha a linha antes de
    // somar, este motor soma e depois arredonda — diferença de precisão esperada, não bug.
    expect(resultado.impostosTotal).toBeCloseTo(21_705.36, 1);
  });

  it("NÃO aplica o IRPJ adicional quando a base presumida mensal fica abaixo do limite de R$20.000", () => {
    // base presumida = 8% × 243.061,13 = 19.444,89 — abaixo do limite, então a linha nem aparece
    expect(resultado.impostos.some((i) => i.nome.includes("IRPJ adicional"))).toBe(false);
  });

  it("chega ao custo total e lucro líquido mensal muito próximos da planilha de referência", () => {
    expect(resultado.custoTotalMensal).toBeCloseTo(163_495.64, 1);
    expect(resultado.lucroLiquidoMensal).toBeCloseTo(79_565.49, 1);
    expect(resultado.margemLiquidaPercentual).toBeCloseTo(32.73, 1);
  });

  it("classifica como Viável e recomenda participar", () => {
    expect(resultado.indicador).toBe("VIAVEL");
    expect(resultado.recomendacao.decisao).toBe("PARTICIPAR");
  });

  it("projeta o valor global e o lucro acumulado do contrato pela duração informada", () => {
    expect(resultado.valorGlobalContrato).toBeCloseTo(resultado.receitaBrutaMensal * 24, 2);
    expect(resultado.lucroLiquidoAcumulado).toBeCloseTo(resultado.lucroLiquidoMensal * 24, 2);
  });

  it("compõe o custo total por categoria somando de volta ao custo total mensal", () => {
    const somaCategorias = resultado.composicaoCustoTotal.reduce((acc, c) => acc + c.valorMensal, 0);
    expect(somaCategorias).toBeCloseTo(resultado.custoTotalMensal, 1);
  });
});

describe("calcularDreServico — regimes tributários", () => {
  const base = {
    valorTetoLote: 100_000,
    descontoPercentual: 0,
    duracaoContratoMeses: 12,
    cargos: [cargo("Auxiliar", 1, 3000)],
    custosOperacionais: [] as CustoOperacionalLinha[],
    margemMinimaAceitavel: 10,
  };

  it("Simples Nacional gera uma única linha de imposto (DAS), sem abrir por tributo", () => {
    const aliquotas: AliquotasResolvidas = {
      regime: "SIMPLES_NACIONAL",
      ramo: "SERVICO",
      anexoSimples: "III",
      rbt12: 300_000,
      aliquotaTotalEfetiva: 8.08,
      detalhes: { faixa: 2, aliquotaNominal: 11.2, parcelaDeduzir: 9360 },
    };
    const resultado = calcularDreServico({ ...base, aliquotas });
    expect(resultado.impostos).toHaveLength(1);
    expect(resultado.impostos[0].nome).toContain("Simples Nacional");
    expect(resultado.impostos[0].valorMensal).toBeCloseTo(resultado.receitaBrutaMensal * 0.0808, 2);
  });

  it("Lucro Presumido e Lucro Real abrem os impostos por tipo (ISS/PIS/COFINS/IRPJ+CSLL)", () => {
    for (const regime of ["LUCRO_PRESUMIDO", "LUCRO_REAL"] as const) {
      const aliquotas: AliquotasResolvidas = {
        regime,
        ramo: "SERVICO",
        aliquotaTotalEfetiva: 16.33,
        detalhes: { issOuIcms: 5, pis: 0.65, cofins: 3, irpjCsll: 7.68 },
      };
      const resultado = calcularDreServico({ ...base, aliquotas });
      expect(resultado.impostos.map((i) => i.nome)).toEqual(["ISS", "PIS", "COFINS", "IRPJ + CSLL"]);
      expect(resultado.impostosTotal).toBeCloseTo(resultado.receitaBrutaMensal * 0.1633, 1);
    }
  });

  it("aplica o IRPJ adicional de 10% só sobre o excedente mensal de R$20.000 na base presumida", () => {
    const aliquotas: AliquotasResolvidas = {
      regime: "LUCRO_PRESUMIDO",
      ramo: "SERVICO",
      aliquotaTotalEfetiva: 16.33,
      detalhes: { issOuIcms: 5, pis: 0.65, cofins: 3, irpjCsll: 7.68 },
      baseCalculoPresumidoPercentual: 32,
    };
    // receita alta o bastante para a base presumida (32%) passar de R$20.000/mês
    const resultado = calcularDreServico({ ...base, valorTetoLote: 200_000, aliquotas });
    const basePresumida = 200_000 * 0.32;
    const excedente = basePresumida - 20_000;
    const linhaAdicional = resultado.impostos.find((i) => i.nome.includes("IRPJ adicional"));
    expect(linhaAdicional).toBeDefined();
    expect(linhaAdicional!.valorMensal).toBeCloseTo(excedente * 0.1, 2);
  });
});

describe("calcularDreServico — múltiplos cargos e linhas de custo (edital de serviço continuado)", () => {
  const aliquotas: AliquotasResolvidas = {
    regime: "SIMPLES_NACIONAL",
    ramo: "SERVICO",
    anexoSimples: "III",
    rbt12: 200_000,
    aliquotaTotalEfetiva: 6,
    detalhes: { faixa: 1, aliquotaNominal: 6, parcelaDeduzir: 0 },
  };

  const resultado = calcularDreServico({
    valorTetoLote: 50_000,
    descontoPercentual: 10,
    duracaoContratoMeses: 6,
    cargos: [cargo("Vigilante", 4, 3200), cargo("Supervisor", 1, 4500)],
    custosOperacionais: [custoOperacional("Uniformes", 800), custoOperacional("Equipamentos de segurança", 1200)],
    aliquotas,
    margemMinimaAceitavel: 10,
  });

  it("soma corretamente vários cargos com quantidades diferentes", () => {
    // 4×3200 + 1×4500 = 17300
    expect(resultado.folhaPagamentoTotal).toBeCloseTo(17_300, 2);
  });

  it("soma corretamente várias linhas de custo operacional", () => {
    expect(resultado.custosOperacionaisTotal).toBeCloseTo(2000, 2);
  });

  it("o custo total mensal é a soma das três categorias (operacional + folha + impostos)", () => {
    const somaCategorias = resultado.custosOperacionaisTotal + resultado.folhaPagamentoTotal + resultado.impostosTotal;
    expect(resultado.custoTotalMensal).toBeCloseTo(somaCategorias, 2);
  });
});
