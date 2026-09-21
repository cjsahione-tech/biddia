import { describe, expect, it } from "vitest";
import { dentroDaValidadeComMargem } from "@/lib/documentos-empresa";

describe("dentroDaValidadeComMargem", () => {
  const dataReferencia = new Date("2026-09-18T00:00:00.000Z"); // sexta-feira

  it("documento sem validade (null) sempre conta como válido", () => {
    expect(dentroDaValidadeComMargem(null, dataReferencia)).toBe(true);
  });

  it("documento que vence bem depois da margem é válido", () => {
    const validade = new Date("2026-12-31T00:00:00.000Z");
    expect(dentroDaValidadeComMargem(validade, dataReferencia)).toBe(true);
  });

  it("documento que já venceu antes da data de referência não é válido", () => {
    const validade = new Date("2026-09-01T00:00:00.000Z");
    expect(dentroDaValidadeComMargem(validade, dataReferencia)).toBe(false);
  });

  it("documento que vence DENTRO da margem de dias úteis não é válido", () => {
    // 18/set/2026 (sex) + 5 dias úteis = 25/set/2026 (sex) — um vencimento no meio do
    // caminho (ex: 22/set, segunda) cai dentro da margem e não deve passar.
    const validade = new Date("2026-09-22T00:00:00.000Z");
    expect(dentroDaValidadeComMargem(validade, dataReferencia)).toBe(false);
  });

  it("documento que vence exatamente no fim da margem de dias úteis é válido", () => {
    const validade = new Date("2026-09-25T00:00:00.000Z");
    expect(dentroDaValidadeComMargem(validade, dataReferencia)).toBe(true);
  });

  it("aceita uma margem customizada de dias úteis", () => {
    const validade = new Date("2026-09-21T00:00:00.000Z"); // segunda seguinte
    expect(dentroDaValidadeComMargem(validade, dataReferencia, 1)).toBe(true);
    expect(dentroDaValidadeComMargem(validade, dataReferencia, 3)).toBe(false);
  });
});
