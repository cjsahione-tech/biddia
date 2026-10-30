import { describe, expect, it } from "vitest";
import {
  aprenderParametros,
  medianaOuNulo,
  normalizarTexto,
  similaridade,
  sugerirCustos,
  type RegistroHistorico,
} from "@/lib/estudo-memoria";

function registro(descricao: string, estudoId: string, data: string, custo = 10, extra: Partial<RegistroHistorico["custos"]> = {}, quantidade = 100): RegistroHistorico {
  return {
    descricao,
    quantidade,
    custos: {
      custoAquisicaoUnitario: custo,
      freteLogistica: 20,
      icmsStDifal: 5,
      despesasComerciaisAdmin: 8,
      margemLucroDesejada: 12,
      ...extra,
    },
    origem: { estudoId, rotulo: `Edital ${estudoId}`, atualizadoEm: data },
  };
}

describe("normalizarTexto", () => {
  it("tira acento, maiúsculas e pontuação, e separa número de unidade", () => {
    expect(normalizarTexto("Seringa DESCARTÁVEL 10ml, c/ agulha!")).toBe("seringa descartavel 10 ml com agulha");
  });
});

describe("similaridade", () => {
  it("mesmas palavras em outra ordem e outro formato = igual", () => {
    expect(similaridade("Papel A4 75g resma 500 folhas", "RESMA DE PAPEL A4, 75 g, 500 FOLHAS")).toBe(1);
  });
  it("especificação diferente (capacidade) = produtos diferentes", () => {
    expect(similaridade("Seringa 10 ml", "Seringa 5 ml")).toBe(0);
    expect(similaridade("Seringa 10ml", "Seringa 10 ml")).toBe(1);
  });
  it("tamanho P/M/G diferente = produtos diferentes", () => {
    expect(similaridade("Luva nitrílica tamanho M", "Luva nitrílica tamanho G")).toBe(0);
    expect(similaridade("Luva nitrílica tamanho M", "Luva nitrílica tamanho M")).toBe(1);
  });
  it("produtos sem relação ficam perto de zero", () => {
    expect(similaridade("Caneta esferográfica azul", "Cadeira giratória com braço")).toBe(0);
  });
  it("texto vazio = 0", () => {
    expect(similaridade("", "Caneta azul")).toBe(0);
  });
});

describe("sugerirCustos", () => {
  const historico = [
    registro("Papel A4 75g resma 500 folhas", "e1", "2026-03-01T00:00:00Z", 24.5, { fornecedor: "Papelaria Norte" }),
    registro("Resma de papel A4 75 g 500 folhas", "e2", "2026-08-10T00:00:00Z", 26.9),
    registro("Caneta esferográfica azul", "e3", "2026-05-01T00:00:00Z", 1.2),
  ];

  it("acha o produto no histórico e usa o estudo mais recente entre os iguais", () => {
    const s = sugerirCustos("PAPEL A4 75G RESMA C/ 500 FOLHAS", 100, historico);
    expect(s).not.toBeNull();
    expect(s!.custos.custoAquisicaoUnitario).toBe(26.9);
    expect(s!.origem.estudoId).toBe("e2");
    expect(s!.ocorrencias).toBe(2);
    expect(s!.similaridade).toBe(1);
  });

  it("não sugere quando nada no histórico se parece", () => {
    expect(sugerirCustos("Impressora a laser monocromática", 10, historico)).toBeNull();
  });

  it("ignora registros sem custo de aquisição (não aprende zero)", () => {
    const h = [registro("Caneta esferográfica azul", "e9", "2026-09-01T00:00:00Z", 0), ...historico];
    expect(sugerirCustos("Caneta esferográfica azul", 100, h)!.origem.estudoId).toBe("e3");
  });

  it("histórico vazio = sem sugestão", () => {
    expect(sugerirCustos("Papel A4", 1, [])).toBeNull();
  });

  it("frete e ICMS-ST (totais) acompanham a quantidade nova; o custo unitário não muda", () => {
    // histórico: 100 unidades, frete total 20, ICMS-ST total 5 → para 250 unidades: 50 e 12,50
    const s = sugerirCustos("Caneta esferográfica azul", 250, historico);
    expect(s!.custos.custoAquisicaoUnitario).toBe(1.2);
    expect(s!.custos.freteLogistica).toBe(50);
    expect(s!.custos.icmsStDifal).toBe(12.5);
    expect(s!.ajustouPorQuantidade).toBe(true);
  });

  it("mesma quantidade = nada é ajustado", () => {
    const s = sugerirCustos("Caneta esferográfica azul", 100, historico);
    expect(s!.custos.freteLogistica).toBe(20);
    expect(s!.ajustouPorQuantidade).toBe(false);
  });

  it("devolve o fornecedor quando existia", () => {
    const s = sugerirCustos("Papel A4 75g resma 500 folhas", 100, [historico[0]]);
    expect(s!.custos.fornecedor).toBe("Papelaria Norte");
  });
});

describe("aprenderParametros", () => {
  it("usa a mediana (um estudo fora do padrão não puxa a média)", () => {
    const r = aprenderParametros([
      { margemPiso: 5, margemAlvo: 10, margemInicial: 20, despesasComerciaisAdmin: 8 },
      { margemPiso: 6, margemAlvo: 12, margemInicial: 22, despesasComerciaisAdmin: 8 },
      { margemPiso: 40, margemAlvo: 60, margemInicial: 80, despesasComerciaisAdmin: 30 },
    ]);
    expect(r.margemPiso).toBe(6);
    expect(r.margemAlvo).toBe(12);
    expect(r.margemInicial).toBe(22);
    expect(r.despesasComerciaisAdmin).toBe(8);
    expect(r.amostras).toBe(3);
  });

  it("campo sem nenhum dado fica nulo (não inventa)", () => {
    const r = aprenderParametros([{ margemPiso: null, margemAlvo: 10, margemInicial: null, despesasComerciaisAdmin: null }]);
    expect(r.margemPiso).toBeNull();
    expect(r.margemAlvo).toBe(10);
  });

  it("sem estudos = tudo nulo", () => {
    const r = aprenderParametros([]);
    expect(r.margemAlvo).toBeNull();
    expect(r.amostras).toBe(0);
  });

  it("mediana de par tira a média dos dois do meio", () => {
    expect(medianaOuNulo([10, 20])).toBe(15);
    expect(medianaOuNulo([null, undefined])).toBeNull();
  });
});
