import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/agents/run-tracker", () => ({ withAgentRun: vi.fn(), logAudit: vi.fn() }));
vi.mock("@/lib/agents/agente2-analista", () => ({ executarAgente2: vi.fn() }));
vi.mock("@/lib/agents/agente3-financeiro", () => ({ executarAgente3: vi.fn() }));
vi.mock("@/lib/agents/agente4-advogado", () => ({ executarAgente4: vi.fn() }));
vi.mock("@/lib/agents/agente5-secretario", () => ({ executarAgente5: vi.fn() }));
vi.mock("@/lib/agents/agente1-comercial", () => ({ baixarDocumentosPendentes: vi.fn() }));
vi.mock("@/lib/agents/pdf-extract", () => ({ prewarmTextoDocumentos: vi.fn() }));

import { LIMITE_EXECUCAO_PRESA_MS, definirEstadoFinal } from "@/lib/agents/agente6-auditor";

describe("Auditor HEAD — estado final", () => {
  it("COMPLETO só com as 4 entregas, nenhum reparo falho e nenhuma ação humana", () => {
    expect(definirEstadoFinal({ entregasFaltando: [], reparosQueFalharam: [], acoesHumanas: 0 })).toBe("COMPLETO");
  });

  it("COM_PENDENCIAS quando falta uma entrega", () => {
    expect(definirEstadoFinal({ entregasFaltando: ["Proposta financeira"], reparosQueFalharam: [], acoesHumanas: 0 })).toBe("COM_PENDENCIAS");
  });

  it("COM_PENDENCIAS quando um reparo falhou", () => {
    expect(definirEstadoFinal({ entregasFaltando: [], reparosQueFalharam: ["Checklist"], acoesHumanas: 0 })).toBe("COM_PENDENCIAS");
  });

  it("COM_PENDENCIAS quando há documento obrigatório esperando uma pessoa (não é 'completo por falta de erro')", () => {
    expect(definirEstadoFinal({ entregasFaltando: [], reparosQueFalharam: [], acoesHumanas: 3 })).toBe("COM_PENDENCIAS");
  });

  it("execução presa vale a partir de 10 minutos", () => {
    expect(LIMITE_EXECUCAO_PRESA_MS).toBe(600_000);
  });
});
