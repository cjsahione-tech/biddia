import { beforeEach, describe, expect, it, vi } from "vitest";

// A IA simulada é uma função comum (não um vi.fn): assim a falha simulada é só mais um comportamento do teste.
let comportamento: (chamada: unknown[]) => Promise<unknown> = async () => ({ itens: [] });
const chamadas: unknown[][] = [];
vi.mock("@/lib/anthropic", () => ({
  askJSON: (...a: unknown[]) => {
    chamadas.push(a);
    return comportamento(a);
  },
  isAIConfigured: () => true,
  MODELO_HAIKU: "haiku",
}));

import { classificarEditaisEmLote, EXEMPLOS_GENERICOS, gerarExemplosDaEmpresa, promptRelevancia } from "@/lib/agents/relevancia";

const cand = (n: number) => ({ numeroControle: `C${n}`, titulo: `Licitação ${n}`, descricao: "objeto" });

beforeEach(() => {
  chamadas.length = 0;
  comportamento = async () => ({ itens: [] });
});

describe("filtro de relevância do Comercial", () => {
  it("o prompt não cita nenhum ramo fixo (antes só falava de laboratório)", () => {
    const p = promptRelevancia(EXEMPLOS_GENERICOS);
    expect(p).not.toMatch(/laborat[óo]rio|an[áa]lises cl[ií]nicas|reagente/i);
    expect(p).toContain("NA DÚVIDA REAL");
    expect(p).toContain("REGRAS QUE VALEM SEMPRE"); // regras comuns vêm junto
  });

  it("gera exemplos a partir do objeto social e guarda em memória (1 chamada por empresa)", async () => {
    comportamento = async () => ({ exemplos: ["Faz obras de pavimentação ≠ fornece asfalto usinado", "Relevante: pavimentação de ruas"] });
    const a = await gerarExemplosDaEmpresa("Construção e pavimentação de vias urbanas");
    const b = await gerarExemplosDaEmpresa("Construção e pavimentação de vias urbanas");
    expect(a).toContain("pavimentação");
    expect(a).toBe(b);
    expect(chamadas).toHaveLength(1);
  });

  it("se a IA falhar ao gerar exemplos, usa a regra geral (sem derrubar a captação)", async () => {
    const silencio = vi.spyOn(console, "error").mockImplementation(() => {});
    comportamento = async () => {
      throw new Error("sobrecarga");
    };
    const r = await gerarExemplosDaEmpresa("Empresa de limpeza urbana e coleta de resíduos");
    silencio.mockRestore();
    expect(r).toBe(EXEMPLOS_GENERICOS);
  });

  it("classifica em grupos de 12 usando os exemplos da empresa", async () => {
    comportamento = async (chamada) => {
      const sistema = String(chamada[0]);
      if (sistema.includes("calibra um filtro")) return { exemplos: ["Exemplo da empresa de TI"] };
      const ids = [...String(chamada[1]).matchAll(/numeroControle: (C\d+)\]/g)].map((m) => m[1]);
      return { itens: ids.map((id) => ({ numeroControle: id, relevante: id !== "C2", tipoObjeto: "SERVICO" })) };
    };
    const r = await classificarEditaisEmLote("Desenvolvimento de software", Array.from({ length: 13 }, (_, i) => cand(i + 1)));
    expect(r.size).toBe(13);
    expect(r.get("C2")?.relevante).toBe(false);
    expect(r.get("C1")?.relevante).toBe(true);
    // 1 chamada de exemplos + 2 grupos (12 + 1)
    expect(chamadas).toHaveLength(3);
    expect(String(chamadas[1][0])).toContain("Exemplo da empresa de TI");
  });

  it("na dúvida (IA falhou num grupo ou esqueceu um item), o edital é enviado", async () => {
    const silencio = vi.spyOn(console, "error").mockImplementation(() => {});
    comportamento = async (chamada) => {
      if (String(chamada[0]).includes("calibra um filtro")) return { exemplos: [] };
      return { itens: [{ numeroControle: "C1", relevante: false, tipoObjeto: "BEM" }] }; // esqueceu o C2
    };
    const r = await classificarEditaisEmLote("Qualquer empresa", [cand(1), cand(2)]);
    silencio.mockRestore();
    expect(r.get("C1")?.relevante).toBe(false);
    expect(r.get("C2")?.relevante).toBe(true);
  });
});
