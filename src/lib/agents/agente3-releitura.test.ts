import { beforeEach, describe, expect, it, vi } from "vitest";

// A IA simulada é uma função comum (não um vi.fn): assim a falha simulada é só mais um comportamento do teste.
let comportamento: (chamada: unknown[]) => Promise<unknown> = async () => ({ itens: [] });
const chamadas: unknown[][] = [];
vi.mock("@/lib/anthropic", () => ({
  askJSON: (...a: unknown[]) => {
    chamadas.push(a);
    return comportamento(a);
  },
  MODELO_HAIKU: "haiku",
  MODELO_SONNET: "sonnet",
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/agents/pdf-extract", () => ({ obterTextoCompletoEdital: vi.fn() }));
vi.mock("@/lib/agents/run-tracker", () => ({ withAgentRun: vi.fn(), logAudit: vi.fn() }));
vi.mock("@/lib/agents/pncp", () => ({ buscarItensCompra: vi.fn(), parseNumeroControlePNCP: vi.fn() }));

import { relerBlocosSuspeitos } from "@/lib/agents/agente3-financeiro";

type It = { numero: number; descricao: string; unidade: string; quantidade: number; valorUnitario: number; valorTotalLinha: number | null; bloco: number; lote?: string | null };
const mk = (numero: number, bloco: number, extra: Partial<It> = {}): It => ({
  numero,
  descricao: `Produto ${numero}`,
  unidade: "UN",
  quantidade: 10,
  valorUnitario: 5,
  valorTotalLinha: 50,
  bloco,
  ...extra,
});

const blocosTexto = ["texto do trecho 1", "texto do trecho 2"];
const limite = () => Date.now() + 40_000;

beforeEach(() => {
  chamadas.length = 0;
  comportamento = async () => ({ itens: [] });
});

describe("relerBlocosSuspeitos", () => {
  it("não gasta IA quando a conferência não achou defeito", async () => {
    const itens = [1, 2, 3, 4].map((n) => mk(n, 0));
    const r = await relerBlocosSuspeitos({ itens, blocosTexto, cabecalho: "obj", limite: limite() });
    expect(chamadas).toHaveLength(0);
    expect(r.itens).toEqual(itens);
    expect(r.blocosRelidos).toBe(0);
  });

  it("relê só o trecho com a linha que não fecha e usa o raciocínio estendido", async () => {
    const itens = [mk(1, 0), mk(2, 0), mk(3, 0), mk(4, 1), mk(5, 1, { valorUnitario: 50 }), mk(6, 1)];
    comportamento = async () => ({ itens: [mk(4, 1), mk(5, 1), mk(6, 1)] });
    const r = await relerBlocosSuspeitos({ itens, blocosTexto, cabecalho: "obj", limite: limite() });

    expect(chamadas).toHaveLength(1);
    const [prompt, , opts] = chamadas[0] as [string, string, Record<string, unknown>];
    expect(prompt).toContain("RELEITURA CUIDADOSA");
    expect(prompt).toContain("item 5");
    expect(prompt).toContain("= 500");
    expect(opts).toMatchObject({ model: "sonnet", pensar: 3000 });
    expect(r.defeitosAntes).toBe(1);
    expect(r.defeitosDepois).toBe(0);
    expect(r.itens.find((i) => i.numero === 5)?.valorUnitario).toBe(5);
    expect(r.itens).toHaveLength(6);
  });

  it("NÃO troca quando a releitura não melhora (nunca fica pior)", async () => {
    const itens = [mk(1, 0), mk(2, 0), mk(3, 0), mk(4, 1), mk(5, 1, { valorUnitario: 50 }), mk(6, 1)];
    // a releitura devolve algo ainda pior: duas linhas que não fecham
    comportamento = async () => ({ itens: [mk(4, 1, { valorUnitario: 1 }), mk(5, 1, { valorUnitario: 50 }), mk(6, 1)] });
    const r = await relerBlocosSuspeitos({ itens, blocosTexto, cabecalho: "obj", limite: limite() });
    expect(r.itens.find((i) => i.numero === 5)?.valorUnitario).toBe(50);
    expect(r.itens.find((i) => i.numero === 4)?.valorUnitario).toBe(5);
    expect(r.defeitosDepois).toBe(1);
  });

  it("recupera item que faltava na sequência e o põe na ordem certa", async () => {
    const itens = [mk(1, 0), mk(2, 0), mk(3, 0), mk(4, 0), mk(7, 1), mk(8, 1)];
    comportamento = async () => ({ itens: [mk(5, 0), mk(6, 0), mk(1, 0), mk(2, 0), mk(3, 0), mk(4, 0)] });
    const r = await relerBlocosSuspeitos({ itens, blocosTexto, cabecalho: "obj", limite: limite() });
    expect(r.defeitosAntes).toBe(2);
    expect(r.defeitosDepois).toBe(0);
    expect(r.itens).toHaveLength(8);
  });

  it("se a IA falha, mantém a lista como estava", async () => {
    const itens = [mk(1, 0), mk(2, 0), mk(3, 0), mk(4, 1), mk(5, 1, { valorUnitario: 50 }), mk(6, 1)];
    const silencio = vi.spyOn(console, "error").mockImplementation(() => {});
    comportamento = async () => {
      throw new Error("sobrecarga");
    };
    const r = await relerBlocosSuspeitos({ itens, blocosTexto, cabecalho: "obj", limite: limite() });
    expect(r.itens).toEqual(itens);
    expect(r.defeitosDepois).toBe(1);
    silencio.mockRestore();
  });

  it("sem tempo suficiente, não tenta e avisa que foi interrompido", async () => {
    const itens = [mk(1, 0), mk(2, 0), mk(3, 0), mk(4, 1), mk(5, 1, { valorUnitario: 50 }), mk(6, 1)];
    const r = await relerBlocosSuspeitos({ itens, blocosTexto, cabecalho: "obj", limite: Date.now() + 2_000 });
    expect(chamadas).toHaveLength(0);
    expect(r.interrompido).toBe(true);
    expect(r.itens).toEqual(itens);
  });
});
