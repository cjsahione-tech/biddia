import { beforeEach, describe, expect, it, vi } from "vitest";

let paginas: Record<number, { items: { numero_controle_pncp: string }[]; total: number } | "erro">;
const pedidas: number[] = [];
vi.mock("@/lib/proxy-fetch", () => ({
  fetchViaProxy: async (url: string) => {
    const pagina = Number(new URL(url).searchParams.get("pagina"));
    pedidas.push(pagina);
    const r = paginas[pagina];
    if (!r || r === "erro") return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => r };
  },
}));

import { searchEditaisPorPalavraChave } from "@/lib/agents/pncp";

const bloco = (de: number, n: number) => Array.from({ length: n }, (_, i) => ({ numero_controle_pncp: `E${de + i}` }));

beforeEach(() => {
  pedidas.length = 0;
});

describe("busca no PNCP com paginação", () => {
  it("anda pelas páginas até acabar os editais (antes parava nos 100 primeiros)", async () => {
    paginas = {
      1: { items: bloco(1, 100), total: 250 },
      2: { items: bloco(101, 100), total: 250 },
      3: { items: bloco(201, 50), total: 250 },
    };
    const r = await searchEditaisPorPalavraChave("exames", 500);
    expect(r).toHaveLength(250);
    expect(pedidas).toEqual([1, 2, 3]);
  });

  it("para quando já veio o total que o PNCP informa, sem pedir página à toa", async () => {
    paginas = { 1: { items: bloco(1, 100), total: 100 } };
    expect(await searchEditaisPorPalavraChave("exames", 500)).toHaveLength(100);
    expect(pedidas).toEqual([1]);
  });

  it("respeita o máximo de resultados e de páginas", async () => {
    paginas = { 1: { items: bloco(1, 100), total: 9999 }, 2: { items: bloco(101, 100), total: 9999 }, 3: { items: bloco(201, 100), total: 9999 } };
    expect(await searchEditaisPorPalavraChave("x", 150, 5)).toHaveLength(150);
    pedidas.length = 0;
    expect(await searchEditaisPorPalavraChave("x", 500, 2)).toHaveLength(200);
    expect(pedidas).toEqual([1, 2]);
  });

  it("falha numa página seguinte não derruba o que já veio", async () => {
    const silencio = vi.spyOn(console, "error").mockImplementation(() => {});
    paginas = { 1: { items: bloco(1, 100), total: 300 }, 2: "erro" };
    const r = await searchEditaisPorPalavraChave("x", 500);
    silencio.mockRestore();
    expect(r).toHaveLength(100);
  });

  it("falha na 1ª página continua sendo erro da busca", async () => {
    paginas = { 1: "erro" };
    await expect(searchEditaisPorPalavraChave("x", 100)).rejects.toThrow(/indisponível/);
  });
});
