import { describe, expect, it } from "vitest";
import { aplicarRevisaoConjunto, promptRevisaoConjunto } from "@/lib/agents/financeiro-revisao";

const itens = (n: number) => Array.from({ length: n }, (_, i) => ({ descricao: `Item ${i}`, quantidade: 10, valorUnitario: 5, lote: null as string | null }));

describe("revisão do conjunto de itens", () => {
  it("o prompt proíbe acrescentar item e mudar preço", () => {
    const p = promptRevisaoConjunto(10);
    expect(p).toContain("NUNCA acrescente itens novos e NUNCA altere preços");
    expect(p).toContain("[0..9]");
  });

  it("remove o que não é item e os duplicados", () => {
    const r = aplicarRevisaoConjunto(itens(20), { remover: [{ indice: 3 }], unificar: [{ indice: 7 }] });
    expect(r.itens).toHaveLength(18);
    expect(r.removidos).toBe(2);
  });

  it("nunca remove mais de 20% da lista (trava de segurança)", () => {
    const r = aplicarRevisaoConjunto(itens(10), { remover: [{ indice: 0 }, { indice: 1 }, { indice: 2 }] });
    expect(r.itens).toHaveLength(10);
    expect(r.removidos).toBe(0);
  });

  it("corrige só o lote; quantidade e preço ficam como foram lidos", () => {
    const base = itens(5);
    const r = aplicarRevisaoConjunto(base, { corrigirLote: [{ indice: 2, lote: "LOTE 02" }] });
    expect(r.itens[2]).toMatchObject({ lote: "LOTE 02", quantidade: 10, valorUnitario: 5 });
    expect(r.lotesCorrigidos).toBe(1);
  });

  it("ignora índices inventados e não acrescenta item algum", () => {
    const r = aplicarRevisaoConjunto(itens(5), {
      remover: [{ indice: 99 }, { indice: -1 }],
      corrigirLote: [{ indice: 50, lote: "X" }],
      conferirManualmente: [{ indice: 1, motivo: "quantidade zero" }, { indice: 77 }],
    });
    expect(r.itens).toHaveLength(5);
    expect(r.conferirManualmente).toEqual([1]);
  });

  it("aceita resposta vazia ou nula", () => {
    expect(aplicarRevisaoConjunto(itens(3), null).itens).toHaveLength(3);
    expect(aplicarRevisaoConjunto(itens(3), {}).itens).toHaveLength(3);
  });
});
