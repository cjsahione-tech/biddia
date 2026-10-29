import { beforeEach, describe, expect, it, vi } from "vitest";

let comportamento: (chamada: unknown[]) => Promise<unknown> = async () => ({ itens: [] });
const chamadas: unknown[][] = [];
vi.mock("@/lib/anthropic", () => ({
  askJSON: (...a: unknown[]) => {
    chamadas.push(a);
    return comportamento(a);
  },
  MODELO_HAIKU: "haiku",
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/agents/run-tracker", () => ({ withAgentRun: vi.fn(), logAudit: vi.fn() }));

import { casarItensComCatalogo } from "@/lib/agents/agente5-secretario";

beforeEach(() => {
  chamadas.length = 0;
  comportamento = async () => ({ itens: [] });
});

describe("Secretário — itens do edital × catálogo da aba Documentos", () => {
  it("casa só com chave que existe no catálogo e inclui as versões equivalentes", async () => {
    comportamento = async () => ({
      itens: [
        { id: 1, chave: "fiscal-municipal" },
        { id: 2, chave: "chave-que-nao-existe" },
        { id: 3, chave: null },
      ],
    });
    const m = await casarItensComCatalogo(["Prova de regularidade municipal", "Documento esquisito", "Atestado de obra"]);
    expect(m.get("Prova de regularidade municipal")).toEqual(["fiscal-municipal", "fiscal-issqn"]);
    expect(m.has("Documento esquisito")).toBe(false);
    expect(m.has("Atestado de obra")).toBe(false);
  });

  it("o prompt traz o catálogo e a regra de não usar item 'parecido'", async () => {
    await casarItensComCatalogo(["Qualquer"]);
    const sistema = String(chamadas[0][0]);
    expect(sistema).toContain("fiscal-federal");
    expect(sistema).toContain("EXATAMENTE esse documento");
  });

  it("se a IA falhar, os itens continuam manuais (mapa vazio, sem derrubar o agente)", async () => {
    const silencio = vi.spyOn(console, "error").mockImplementation(() => {});
    comportamento = async () => {
      throw new Error("sobrecarga");
    };
    const m = await casarItensComCatalogo(["Qualquer"]);
    silencio.mockRestore();
    expect(m.size).toBe(0);
  });

  it("sem itens, nem chama a IA", async () => {
    expect((await casarItensComCatalogo([])).size).toBe(0);
    expect(chamadas).toHaveLength(0);
  });
});
