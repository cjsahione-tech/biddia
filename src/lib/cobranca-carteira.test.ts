import { describe, it, expect } from "vitest";
import { calcularCobrancaMes, diasAtivosNoMes, diasNoMes, resumoCobranca } from "@/lib/cobranca-carteira";

// Datas ao meio-dia UTC para não cruzar o dia em Brasília (UTC-3).
const d = (s: string) => new Date(`${s}T15:00:00Z`);

describe("cobrança mensal dos clientes da carteira (valor do plano de cada cliente)", () => {
  it("conta os dias do mês", () => {
    expect(diasNoMes(2026, 2)).toBe(28);
    expect(diasNoMes(2028, 2)).toBe(29);
    expect(diasNoMes(2026, 9)).toBe(30);
  });

  it("cliente ativo o mês todo paga o valor cheio do plano dele", () => {
    const r = calcularCobrancaMes([{ id: "a", valorMensal: 30, periodos: [{ inicio: d("2026-01-10"), fim: null }] }], 2026, 9);
    expect(r.total).toBe(30);
    expect(r.linhas[0].diasAtivos).toBe(30);
  });

  it("cliente que entra no meio do mês paga proporcional (dia de entrada conta)", () => {
    const r = calcularCobrancaMes([{ id: "a", valorMensal: 30, periodos: [{ inicio: d("2026-09-21"), fim: null }] }], 2026, 9);
    expect(r.linhas[0].diasAtivos).toBe(10); // 21..30
    expect(r.total).toBe(10);
  });

  it("cliente desativado no meio do mês paga só até o dia da saída (inclusive)", () => {
    const r = calcularCobrancaMes(
      [{ id: "a", valorMensal: 30, periodos: [{ inicio: d("2026-01-01"), fim: d("2026-09-10") }] }],
      2026,
      9
    );
    expect(r.linhas[0].diasAtivos).toBe(10);
    expect(r.total).toBe(10);
  });

  it("cliente que saiu antes do mês não gera cobrança nem linha", () => {
    const r = calcularCobrancaMes(
      [{ id: "a", valorMensal: 30, periodos: [{ inicio: d("2026-01-01"), fim: d("2026-08-31") }] }],
      2026,
      9
    );
    expect(r.linhas).toHaveLength(0);
    expect(r.total).toBe(0);
  });

  it("cliente reativado não conta o mesmo dia duas vezes", () => {
    const dias = diasAtivosNoMes(
      [
        { inicio: d("2026-09-01"), fim: d("2026-09-10") },
        { inicio: d("2026-09-10"), fim: d("2026-09-12") },
      ],
      2026,
      9
    );
    expect(dias).toBe(12);
  });

  it("cada cliente paga o valor do SEU plano, e o total soma tudo com centavos", () => {
    const r = calcularCobrancaMes(
      [
        { id: "a", valorMensal: 100, periodos: [{ inicio: d("2026-01-01"), fim: null }] },
        { id: "b", valorMensal: 10, periodos: [{ inicio: d("2026-09-28"), fim: null }] },
      ],
      2026,
      9
    );
    expect(r.linhas.map((l) => l.valor)).toEqual([100, 1]);
    expect(r.total).toBe(101);
  });

  it("cliente sem plano (valor 0) não gera cobrança", () => {
    const r = calcularCobrancaMes([{ id: "a", valorMensal: 0, periodos: [{ inicio: d("2026-01-01"), fim: null }] }], 2026, 9);
    expect(r.total).toBe(0);
  });

  it("resumo: soma dos planos dos clientes ativos", () => {
    const r = resumoCobranca(
      [
        { id: "a", valorMensal: 25, periodos: [{ inicio: d("2026-01-01"), fim: null }] },
        { id: "b", valorMensal: 75, periodos: [{ inicio: d("2026-01-01"), fim: null }] },
        { id: "c", valorMensal: 500, periodos: [{ inicio: d("2026-01-01"), fim: d("2026-08-01") }] },
      ],
      d("2026-09-15")
    );
    expect(r.clientesAtivos).toBe(2);
    expect(r.totalMensalCheio).toBe(100);
    expect(r.faturaPrevistaDoMes).toBe(100);
  });

  it("resumo: cliente desativado hoje deixa de ser ativo, mas o dia da saída ainda entra na fatura do mês", () => {
    const r = resumoCobranca(
      [
        { id: "a", valorMensal: 30, periodos: [{ inicio: d("2026-01-01"), fim: null }] },
        { id: "b", valorMensal: 30, periodos: [{ inicio: d("2026-01-01"), fim: d("2026-09-15") }] },
      ],
      d("2026-09-15")
    );
    expect(r.clientesAtivos).toBe(1);
    expect(r.totalMensalCheio).toBe(30);
    expect(r.faturaPrevistaDoMes).toBe(30 + 15); // a: mês todo; b: dias 1..15
  });
});
