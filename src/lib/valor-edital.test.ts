import { describe, expect, it } from "vitest";
import { extrairValorDoTexto, lerReais, notaOrigemDoValor, somarValorDosItens } from "@/lib/valor-edital";

const item = (valorTotal: number | null, extra: object = {}) => ({ quantidade: 1, valorUnitarioEstimado: valorTotal, valorTotal, ...extra });

describe("soma dos itens do PNCP", () => {
  it("soma os valores totais dos itens", () => {
    expect(somarValorDosItens([item(100.5), item(200.25)])).toEqual({ valor: 300.75, sigiloso: false, parcial: false });
  });
  it("sem valorTotal usa unitário x quantidade", () => {
    const r = somarValorDosItens([{ quantidade: 10, valorUnitarioEstimado: 25.5, valorTotal: null }]);
    expect(r.valor).toBe(255);
  });
  it("todos os itens sigilosos = orçamento sigiloso", () => {
    expect(somarValorDosItens([item(0, { orcamentoSigiloso: true }), item(0, { orcamentoSigiloso: true })])).toEqual({ valor: null, sigiloso: true, parcial: false });
  });
  it("parte sigilosa ou sem valor: soma o que há e avisa que é parcial", () => {
    const r = somarValorDosItens([item(1000), item(0, { orcamentoSigiloso: true }), item(null)]);
    expect(r).toEqual({ valor: 1000, sigiloso: false, parcial: true });
  });
  it("valor de preenchimento (0 ou R$ 1) não vale como valor", () => {
    expect(somarValorDosItens([item(1)]).valor).toBeNull();
    expect(somarValorDosItens([item(0), item(null)]).valor).toBeNull();
  });
  it("sem itens = nada", () => {
    expect(somarValorDosItens([])).toEqual({ valor: null, sigiloso: false, parcial: false });
  });
});

describe("valor escrito no texto do edital", () => {
  it("lê o valor total estimado", () => {
    expect(extrairValorDoTexto("O valor total estimado da contratação é de R$ 1.234.567,89 (um milhão...)")).toBe(1234567.89);
    expect(extrairValorDoTexto("VALOR DE REFERÊNCIA: R$ 85.000,00")).toBe(85000);
    expect(extrairValorDoTexto("Valor global estimado\nR$ 4.990,00")).toBe(4990);
  });
  it("valor de item não conta; sem frase de total não chuta", () => {
    expect(extrairValorDoTexto("Item 1 - valor unitário estimado R$ 25,00 cada")).toBeNull();
    expect(extrairValorDoTexto("Multa de R$ 500,00 por dia de atraso")).toBeNull();
  });
  it("valores diferentes citados = ambíguo, não chuta; o mesmo valor repetido vale", () => {
    expect(extrairValorDoTexto("valor total estimado R$ 100.000,00. Já o valor de referência é R$ 90.000,00")).toBeNull();
    expect(extrairValorDoTexto("valor estimado R$ 100.000,00 ... valor de referência R$ 100.000,00")).toBe(100000);
  });
  it("lerReais aceita só formato brasileiro bem formado", () => {
    expect(lerReais("1.234,56")).toBe(1234.56);
    expect(lerReais("1234,56")).toBe(1234.56);
    expect(lerReais("1,234.56")).toBeNull();
    expect(lerReais("12")).toBeNull();
  });
});

describe("origem do valor", () => {
  it("explica a origem; valor do próprio PNCP não precisa de nota", () => {
    expect(notaOrigemDoValor("ITENS")).toMatch(/Soma dos valores estimados/);
    expect(notaOrigemDoValor("ITENS_PARCIAL")).toMatch(/total real é maior/);
    expect(notaOrigemDoValor("EDITAL")).toMatch(/confira/);
    expect(notaOrigemDoValor("PNCP")).toBeNull();
    expect(notaOrigemDoValor(null)).toBeNull();
  });
});
