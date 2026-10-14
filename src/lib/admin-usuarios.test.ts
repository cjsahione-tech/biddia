import { describe, expect, it } from "vitest";
import { calcularFinanceiro, confirmacaoConfere, inicioDoMesBrasilia, motivoParaNaoExcluir, somarTotais } from "@/lib/admin-usuarios";

describe("financeiro por conta", () => {
  it("conta ativa: receita = valor do plano; lucro = receita - custo de IA em reais", () => {
    const r = calcularFinanceiro({ precoPlano: 297, valorPersonalizado: null, status: "ATIVA", custoUsd: 10 });
    expect(r).toEqual({ valorMensal: 297, receita: 297, custoBrl: 55, lucro: 242 });
  });
  it("valor combinado substitui o preço do plano", () => {
    expect(calcularFinanceiro({ precoPlano: 297, valorPersonalizado: 150, status: "ATIVA", custoUsd: 0 }).valorMensal).toBe(150);
    expect(calcularFinanceiro({ precoPlano: 297, valorPersonalizado: 0, status: "ATIVA", custoUsd: 0 }).valorMensal).toBe(0);
  });
  it("em teste, pendente e cancelada não geram receita — mas o custo continua contando (lucro negativo)", () => {
    for (const status of ["EM_TESTE", "PAGAMENTO_PENDENTE", "CANCELADA"] as const) {
      const r = calcularFinanceiro({ precoPlano: 100, valorPersonalizado: null, status, custoUsd: 2 });
      expect(r.receita).toBe(0);
      expect(r.valorMensal).toBe(100);
      expect(r.lucro).toBe(-11);
    }
  });
  it("sem plano e sem valor: zero", () => {
    expect(calcularFinanceiro({ precoPlano: null, valorPersonalizado: null, status: "ATIVA", custoUsd: 0 })).toEqual({ valorMensal: 0, receita: 0, custoBrl: 0, lucro: 0 });
  });
});

describe("totais", () => {
  it("soma receita só das ativas; separa a receber (pendentes)", () => {
    const t = somarTotais([
      { status: "ATIVA", valorMensal: 100, receita: 100, custoBrl: 10, lucro: 90 },
      { status: "PAGAMENTO_PENDENTE", valorMensal: 50, receita: 0, custoBrl: 5, lucro: -5 },
      { status: "EM_TESTE", valorMensal: 0, receita: 0, custoBrl: 1, lucro: -1 },
      { status: "CANCELADA", valorMensal: 70, receita: 0, custoBrl: 0, lucro: 0 },
    ]);
    expect(t).toMatchObject({ contas: 4, ativas: 1, emTeste: 1, pendentes: 1, canceladas: 1, receitaMensal: 100, aReceber: 50, custoBrl: 16, lucro: 84 });
  });
});

describe("início do mês em Brasília", () => {
  it("meio de outubro -> 1º de outubro 00:00 BRT (03:00 UTC)", () => {
    expect(inicioDoMesBrasilia(new Date("2026-10-14T15:00:00Z")).toISOString()).toBe("2026-10-01T03:00:00.000Z");
  });
  it("1º do mês às 01:00 UTC ainda é o mês anterior em Brasília", () => {
    expect(inicioDoMesBrasilia(new Date("2026-11-01T01:00:00Z")).toISOString()).toBe("2026-10-01T03:00:00.000Z");
  });
});

describe("excluir conta: travas", () => {
  const eu = { id: "u1", email: "dono@x.com" };
  it("não exclui a si mesmo nem outro administrador", () => {
    expect(motivoParaNaoExcluir({ id: "u1", email: "dono@x.com" }, eu, ["dono@x.com"])).toMatch(/própria conta/);
    expect(motivoParaNaoExcluir({ id: "u2", email: "Outro@X.com " }, eu, ["outro@x.com"])).toMatch(/administrador/);
    expect(motivoParaNaoExcluir({ id: "u3", email: "cliente@x.com" }, eu, ["dono@x.com"])).toBeNull();
  });
  it("confirmação precisa ser o e-mail da conta", () => {
    expect(confirmacaoConfere(" Cliente@X.com ", "cliente@x.com")).toBe(true);
    expect(confirmacaoConfere("outro@x.com", "cliente@x.com")).toBe(false);
    expect(confirmacaoConfere(undefined, "cliente@x.com")).toBe(false);
    expect(confirmacaoConfere("", "cliente@x.com")).toBe(false);
  });
});
