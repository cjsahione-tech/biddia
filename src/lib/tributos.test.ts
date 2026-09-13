import { describe, expect, it } from "vitest";
import { calcularAliquotaEfetivaSimples, SEED_FAIXAS_SIMPLES, SEED_PARAMETROS_REGIME } from "@/lib/tributos";

describe("calcularAliquotaEfetivaSimples", () => {
  it("na primeira faixa (parcela a deduzir = 0), a alíquota efetiva é igual à nominal", () => {
    const faixa1AnexoIII = SEED_FAIXAS_SIMPLES.find((f) => f.anexo === "III" && f.faixa === 1)!;
    expect(calcularAliquotaEfetivaSimples(faixa1AnexoIII, 100_000)).toBeCloseTo(faixa1AnexoIII.aliquotaNominal, 5);
  });

  it("em faixas superiores, a parcela a deduzir reduz a alíquota efetiva abaixo da nominal", () => {
    const faixa3AnexoIII = SEED_FAIXAS_SIMPLES.find((f) => f.anexo === "III" && f.faixa === 3)!;
    const rbt12 = 500_000;
    const esperado = ((rbt12 * (faixa3AnexoIII.aliquotaNominal / 100) - faixa3AnexoIII.parcelaDeduzir) / rbt12) * 100;
    const efetiva = calcularAliquotaEfetivaSimples(faixa3AnexoIII, rbt12);
    expect(efetiva).toBeCloseTo(esperado, 6);
    expect(efetiva).toBeLessThan(faixa3AnexoIII.aliquotaNominal);
  });

  it("nunca retorna alíquota negativa, mesmo com parcela a deduzir alta e RBT12 baixo dentro da faixa", () => {
    const faixa = { aliquotaNominal: 19.0, parcelaDeduzir: 378_000 };
    expect(calcularAliquotaEfetivaSimples(faixa, 3_600_000.01)).toBeGreaterThanOrEqual(0);
  });

  it("retorna 0 quando o RBT12 é zero ou negativo (evita divisão por zero)", () => {
    expect(calcularAliquotaEfetivaSimples({ aliquotaNominal: 6, parcelaDeduzir: 0 }, 0)).toBe(0);
    expect(calcularAliquotaEfetivaSimples({ aliquotaNominal: 6, parcelaDeduzir: 0 }, -100)).toBe(0);
  });
});

describe("SEED_PARAMETROS_REGIME", () => {
  it("tem uma linha de partida para Lucro Presumido e Lucro Real, nos dois ramos", () => {
    for (const regime of ["LUCRO_PRESUMIDO", "LUCRO_REAL"] as const) {
      for (const ramo of ["SERVICO", "PRODUTO"] as const) {
        const parametro = SEED_PARAMETROS_REGIME.find((p) => p.regime === regime && p.ramo === ramo);
        expect(parametro).toBeDefined();
        const somaAliquotas = parametro!.issOuIcms + parametro!.pis + parametro!.cofins + parametro!.irpjCsll;
        expect(somaAliquotas).toBeGreaterThan(0);
      }
    }
  });
});
