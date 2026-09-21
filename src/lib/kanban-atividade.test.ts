import { describe, expect, it } from "vitest";
import { calcularEstadoInatividade, LIMITE_ALERTA_MS, LIMITE_INATIVIDADE_MS } from "@/lib/kanban-atividade";

describe("calcularEstadoInatividade", () => {
  const agora = new Date("2026-09-21T12:00:00.000Z");

  it("fora da coluna Oportunidade, nunca retorna estado (sem destaque/expiração)", () => {
    expect(calcularEstadoInatividade("QUALIFICACAO", new Date(agora.getTime() - LIMITE_INATIVIDADE_MS - 1), agora)).toBeNull();
    expect(calcularEstadoInatividade("RASCUNHO", new Date(agora.getTime() - LIMITE_INATIVIDADE_MS - 1), agora)).toBeNull();
  });

  it("dentro de Oportunidade, recém-tocado é normal", () => {
    expect(calcularEstadoInatividade("OPORTUNIDADE", agora, agora)).toBe("normal");
  });

  it("logo abaixo do limite de alerta (36h) continua normal", () => {
    const ultimaMovimentacao = new Date(agora.getTime() - LIMITE_ALERTA_MS + 60_000);
    expect(calcularEstadoInatividade("OPORTUNIDADE", ultimaMovimentacao, agora)).toBe("normal");
  });

  it("no limite de alerta (36h) ou além, fica quase_expirando", () => {
    const ultimaMovimentacao = new Date(agora.getTime() - LIMITE_ALERTA_MS);
    expect(calcularEstadoInatividade("OPORTUNIDADE", ultimaMovimentacao, agora)).toBe("quase_expirando");
  });

  it("mesmo passado das 48h, a função ainda classifica como quase_expirando (quem efetivamente move o card é a checagem do servidor)", () => {
    const ultimaMovimentacao = new Date(agora.getTime() - LIMITE_INATIVIDADE_MS - 3_600_000);
    expect(calcularEstadoInatividade("OPORTUNIDADE", ultimaMovimentacao, agora)).toBe("quase_expirando");
  });
});
