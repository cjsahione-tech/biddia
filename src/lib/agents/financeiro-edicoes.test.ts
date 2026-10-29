import { describe, expect, it } from "vitest";
import { preservarEdicoesManuais, type ItemSalvo } from "@/lib/agents/financeiro-edicoes";

const item = (numero: number | null, descricao: string, quantidade: number, valorUnitario: number, extra: Partial<ItemSalvo> = {}): ItemSalvo => ({
  numero,
  descricao,
  unidade: "UN",
  quantidade,
  valorUnitario,
  valorTotal: quantidade * valorUnitario,
  lote: null,
  editadoManualmente: false,
  ...extra,
});

describe("preservarEdicoesManuais", () => {
  it("sem edição manual, devolve a leitura nova como está", () => {
    const novos = [item(1, "A", 2, 10)];
    expect(preservarEdicoesManuais(novos, [item(1, "A", 2, 99)])).toBe(novos);
  });

  it("mantém o preço que a pessoa colocou, casando por número do item", () => {
    const novos = [item(1, "Caneta azul", 5, 0), item(2, "Lápis", 3, 4)];
    const anteriores = [item(1, "Caneta", 5, 2.5, { editadoManualmente: true })];
    const r = preservarEdicoesManuais(novos, anteriores);
    expect(r[0]).toMatchObject({ valorUnitario: 2.5, valorTotal: 12.5, editadoManualmente: true });
    expect(r[1].valorUnitario).toBe(4);
    expect(r).toHaveLength(2);
  });

  it("casa pela descrição quando o edital não numera os itens", () => {
    const novos = [item(null, "DESPESAS COM EXAMES DE HEMOCULTURA", 200, 0)];
    const anteriores = [item(null, "despesas com  exames de hemocultura", 200, 31, { editadoManualmente: true })];
    expect(preservarEdicoesManuais(novos, anteriores)[0]).toMatchObject({ valorUnitario: 31, editadoManualmente: true });
  });

  it("não confunde o mesmo número em lotes diferentes", () => {
    const novos = [item(1, "A", 1, 0, { lote: "1" }), item(1, "B", 1, 0, { lote: "2" })];
    const anteriores = [item(1, "B", 1, 8, { lote: "2", editadoManualmente: true })];
    const r = preservarEdicoesManuais(novos, anteriores);
    expect(r[0].valorUnitario).toBe(0);
    expect(r[1].valorUnitario).toBe(8);
  });

  it("o item editado que sumiu da nova leitura não se perde", () => {
    const novos = [item(1, "A", 1, 1)];
    const anteriores = [item(9, "Item que sumiu", 4, 7, { editadoManualmente: true })];
    const r = preservarEdicoesManuais(novos, anteriores);
    expect(r).toHaveLength(2);
    expect(r[1]).toMatchObject({ numero: 9, valorUnitario: 7, editadoManualmente: true });
  });

  it("uma edição manual vira o preço da pessoa, não mais uma sugestão", () => {
    const novos = [item(1, "A", 2, 0)];
    const anteriores = [item(1, "A", 2, 6, { editadoManualmente: true, precoSugerido: true })];
    expect(preservarEdicoesManuais(novos, anteriores)[0].precoSugerido).toBe(false);
  });
});
