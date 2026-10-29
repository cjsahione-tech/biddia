import { describe, expect, it } from "vitest";
import { REGRAS_COMUNS, comRegrasComuns } from "@/lib/agents/regras-comuns";

describe("regras comuns dos agentes", () => {
  it("têm as 12 regras", () => {
    for (let n = 1; n <= 12; n++) expect(REGRAS_COMUNS).toContain(`\n${n}. `);
  });

  it("vêm antes do prompt do agente", () => {
    const r = comRegrasComuns("FUNÇÃO: testar");
    expect(r.indexOf("REGRAS QUE VALEM SEMPRE")).toBeLessThan(r.indexOf("FUNÇÃO: testar"));
  });
});
