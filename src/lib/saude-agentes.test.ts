import { describe, expect, it } from "vitest";
import { LIMITE_TRAVADA_MS, resumirAuditorias, resumirExecucoes, taxaDeErro } from "@/lib/saude-agentes";
import { custoPorModeloUsd } from "@/lib/habilitacao";

const agora = new Date("2026-10-14T12:00:00Z");
const antes = (ms: number) => new Date(agora.getTime() - ms);

describe("taxa de erro dos agentes", () => {
  it("conta só o que terminou; em andamento recente não entra", () => {
    const r = resumirExecucoes(
      [
        { agentKey: "a", status: "DONE", iniciadaEm: antes(1000) },
        { agentKey: "a", status: "DONE", iniciadaEm: antes(1000) },
        { agentKey: "a", status: "DONE", iniciadaEm: antes(1000) },
        { agentKey: "a", status: "ERROR", iniciadaEm: antes(1000) },
        { agentKey: "a", status: "RUNNING", iniciadaEm: antes(30_000) },
      ],
      agora
    );
    expect(r.porAgente[0]).toMatchObject({ execucoes: 4, concluidas: 3, falhas: 1, taxaErro: 0.25 });
  });
  it("execução 'rodando' há mais de 10 minutos morreu no meio: conta como falha", () => {
    const r = resumirExecucoes([{ agentKey: "a", status: "RUNNING", iniciadaEm: antes(LIMITE_TRAVADA_MS + 1000) }], agora);
    expect(r.geral.falhas).toBe(1);
  });
  it("soma geral e sem execuções = taxa nula (nunca divisão por zero)", () => {
    const r = resumirExecucoes(
      [
        { agentKey: "a", status: "DONE", iniciadaEm: antes(1) },
        { agentKey: "b", status: "ERROR", iniciadaEm: antes(1) },
      ],
      agora
    );
    expect(r.geral).toMatchObject({ execucoes: 2, falhas: 1, taxaErro: 0.5 });
    expect(taxaDeErro(0, 0)).toBeNull();
    expect(resumirExecucoes([], agora).geral.taxaErro).toBeNull();
  });
  it("auditoria: fila, espera por saldo e rodando não são falha", () => {
    const r = resumirAuditorias([
      { estado: "CONCLUIDA", n: 18 },
      { estado: "ERRO", n: 1 },
      { estado: "INTERROMPIDA", n: 1 },
      { estado: "NA_FILA", n: 5 },
      { estado: "AGUARDANDO_SALDO", n: 3 },
      { estado: "RODANDO", n: 2 },
    ]);
    expect(r).toMatchObject({ execucoes: 20, concluidas: 18, falhas: 2, taxaErro: 0.1 });
  });
});

describe("custo por modelo", () => {
  it("Haiku e Sonnet com preços diferentes", () => {
    expect(custoPorModeloUsd("claude-haiku-4-5", 1_000_000, 1_000_000)).toBe(6);
    expect(custoPorModeloUsd("claude-sonnet-4-5", 1_000_000, 1_000_000)).toBe(18);
  });
});
