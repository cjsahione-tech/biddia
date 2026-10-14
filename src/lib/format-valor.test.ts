import { describe, expect, it } from "vitest";
import { descreverValorEdital } from "@/lib/format";

const agora = Date.now();
const horasAtras = (h: number) => new Date(agora - h * 3_600_000).toISOString();
const base = { valorGlobal: null, orcamentoSigiloso: false, valorOrigem: null, valorTentadoEm: null, createdAt: horasAtras(1), fonte: "PNCP" };

describe("como o valor do edital aparece", () => {
  it("sigiloso fala sigiloso e explica", () => {
    const v = descreverValorEdital({ ...base, orcamentoSigiloso: true });
    expect(v.texto).toBe("Sigiloso");
    expect(v.nota).toMatch(/não divulga/);
  });
  it("valor do PNCP: só o número; soma dos itens: número + de onde veio; parcial: 'A partir de'", () => {
    expect(descreverValorEdital({ ...base, valorGlobal: 1000, valorOrigem: "PNCP" })).toMatchObject({ nota: null, apagado: false });
    const itens = descreverValorEdital({ ...base, valorGlobal: 1000, valorOrigem: "ITENS" });
    expect(itens.texto).toContain("1.000,00");
    expect(itens.nota).toMatch(/Soma dos valores estimados/);
    const parcial = descreverValorEdital({ ...base, valorGlobal: 1000, valorOrigem: "ITENS_PARCIAL" });
    expect(parcial.texto).toMatch(/^A partir de/);
    expect(descreverValorEdital({ ...base, valorGlobal: 5, valorOrigem: "EDITAL" }).nota).toMatch(/confira/);
  });
  it("recém-captado e ainda sem busca: 'Buscando valor…'", () => {
    expect(descreverValorEdital(base).texto).toBe("Buscando valor…");
  });
  it("nunca mostra 'Não informado': depois da busca ou de 2 dias, diz o motivo por fonte", () => {
    expect(descreverValorEdital({ ...base, valorTentadoEm: horasAtras(1) }).texto).toBe("Não divulgado pelo órgão");
    expect(descreverValorEdital({ ...base, createdAt: horasAtras(72) }).texto).toBe("Não divulgado pelo órgão");
    expect(descreverValorEdital({ ...base, fonte: "LICITANET", valorTentadoEm: horasAtras(1) }).texto).toBe("Não consta no edital");
    expect(descreverValorEdital({ ...base, fonte: "MANUAL" }).texto).toBe("Não consta no PDF enviado");
    for (const f of ["PNCP", "LICITANET", "MANUAL", "COMPRASGOV", null]) {
      expect(descreverValorEdital({ ...base, fonte: f, createdAt: horasAtras(500) }).texto).not.toMatch(/Não informado/);
    }
  });
  it("sem dados de criação (outras telas) não fica 'buscando' para sempre", () => {
    expect(descreverValorEdital({ valorGlobal: null, orcamentoSigiloso: false }).texto).toBe("Não divulgado pelo órgão");
  });
});
