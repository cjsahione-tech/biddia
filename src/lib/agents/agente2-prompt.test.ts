import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/anthropic", () => ({ askJSON: vi.fn(), MODELO_HAIKU: "haiku" }));
vi.mock("@/lib/agents/pdf-extract", () => ({ obterTextoCompletoEdital: vi.fn() }));
vi.mock("@/lib/agents/run-tracker", () => ({ withAgentRun: vi.fn(), logAudit: vi.fn() }));

import { promptAnalista } from "@/lib/agents/agente2-analista";

describe("prompt do Analista", () => {
  const p = promptAnalista("Você TEM ACESSO ao texto completo.");

  it("separa tudo o que o dono do projeto pediu", () => {
    for (const chave of [
      "prazos",
      "obrigacoesContratada",
      "obrigacoesContratante",
      "requisitosObrigatorios",
      "requisitosAdicionais",
      "pontosDeAtencao",
      "habilitacao",
      "avisos",
    ]) {
      expect(p).toContain(`"${chave}"`);
    }
  });

  it("não pede parecer nem recomendação", () => {
    expect(p).not.toContain('"parecer"');
    expect(p).toContain("NÃO dá parecer");
  });

  it("traz as regras comuns e a conferência final", () => {
    expect(p).toContain("REGRAS QUE VALEM SEMPRE");
    expect(p).toContain("CONFERÊNCIA FINAL");
    expect(p).toContain("Você TEM ACESSO ao texto completo.");
  });

  it("não manda completar com requisitos 'típicos da modalidade'", () => {
    expect(p).not.toMatch(/t[ií]picos da modalidade/i);
  });
});
