import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/anthropic", () => ({ askJSON: vi.fn(), MODELO_HAIKU: "haiku" }));
vi.mock("@/lib/agents/pdf-extract", () => ({ obterTextoCompletoEdital: vi.fn() }));
vi.mock("@/lib/agents/run-tracker", () => ({ withAgentRun: vi.fn(), logAudit: vi.fn() }));

import { promptAnalista, promptHabilitacao } from "@/lib/agents/agente2-analista";

describe("prompts do Analista (duas leituras em paralelo)", () => {
  const principal = promptAnalista("Você TEM ACESSO ao texto completo.");
  const habilitacao = promptHabilitacao("Você TEM ACESSO ao texto completo.");

  it("a leitura principal separa tudo o que o dono do projeto pediu", () => {
    for (const chave of [
      "prazos",
      "obrigacoesContratada",
      "obrigacoesContratante",
      "requisitosObrigatorios",
      "requisitosAdicionais",
      "pontosDeAtencao",
      "avisos",
    ]) {
      expect(principal).toContain(`"${chave}"`);
    }
  });

  it("a habilitação sai numa leitura própria (o Secretário depende dela)", () => {
    expect(habilitacao).toContain('"habilitacao"');
    expect(principal).not.toContain('"habilitacao": [');
  });

  it("não pede parecer nem recomendação", () => {
    expect(principal).not.toContain('"parecer"');
    expect(principal).toMatch(/NÃO dá\s+parecer/);
  });

  it("a resposta é enxuta: cada lista tem limite de itens (era o que estourava o teto de tokens)", () => {
    expect(principal).toMatch(/até 20 prazos/);
    expect(principal).toMatch(/até 12 obrigações/);
    expect(principal).toMatch(/até 8 pontos/);
    expect(principal).toContain("CONCISO");
    expect(habilitacao).toContain("CONCISO");
  });

  it("traz as regras comuns e a conferência final", () => {
    for (const p of [principal, habilitacao]) {
      expect(p).toContain("REGRAS QUE VALEM SEMPRE");
      expect(p).toContain("CONFERÊNCIA FINAL");
      expect(p).toContain("Você TEM ACESSO ao texto completo.");
    }
  });

  it("não manda completar com requisitos 'típicos da modalidade'", () => {
    expect(principal).not.toMatch(/t[ií]picos da modalidade/i);
  });
});
