import { describe, expect, it } from "vitest";
import { escreverNumeroBR, lerNumeroBR } from "@/lib/numero-br";

describe("lerNumeroBR", () => {
  it("entende vírgula decimal e ponto de milhar", () => {
    expect(lerNumeroBR("1.234,56")).toBe(1234.56);
    expect(lerNumeroBR("68.264,57")).toBe(68264.57);
    expect(lerNumeroBR("12,5")).toBe(12.5);
    expect(lerNumeroBR("0,35")).toBe(0.35);
  });
  it("entende milhar sem decimais e inteiros", () => {
    expect(lerNumeroBR("1.234")).toBe(1234);
    expect(lerNumeroBR("12.345.678")).toBe(12345678);
    expect(lerNumeroBR("100")).toBe(100);
  });
  it("aceita ponto como decimal quando não é milhar", () => {
    expect(lerNumeroBR("12.5")).toBe(12.5);
    expect(lerNumeroBR("0.35")).toBe(0.35);
  });
  it("ignora R$, % e espaços", () => {
    expect(lerNumeroBR("R$ 1.500,00")).toBe(1500);
    expect(lerNumeroBR(" 8,5 % ")).toBe(8.5);
  });
  it("devolve null para vazio ou texto", () => {
    expect(lerNumeroBR("")).toBeNull();
    expect(lerNumeroBR("   ")).toBeNull();
    expect(lerNumeroBR(null)).toBeNull();
    expect(lerNumeroBR("abc")).toBeNull();
    expect(lerNumeroBR("1,2,3")).toBeNull();
  });
});

describe("escreverNumeroBR", () => {
  it("usa vírgula e não deixa zeros sobrando", () => {
    expect(escreverNumeroBR(12.5)).toBe("12,5");
    expect(escreverNumeroBR(1234)).toBe("1234");
    expect(escreverNumeroBR(0.35)).toBe("0,35");
    expect(escreverNumeroBR(10.456)).toBe("10,46");
  });
  it("nulo vira texto vazio", () => {
    expect(escreverNumeroBR(null)).toBe("");
    expect(escreverNumeroBR(Number.NaN)).toBe("");
  });
});
