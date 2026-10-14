import { describe, it, expect } from "vitest";
import { lerGruposHabilitacao, lerLista, normalizarGruposHabilitacao, normalizarLista, paraTexto } from "@/lib/analise-dados";

// Regressão: o Analista devolveu, num edital republicado, um grupo de habilitação SEM "itens". A tela tentava
// desenhar o objeto ("Objects are not valid as a React child" → "This page couldn't load") e o Secretário falhava.
describe("grupos de habilitação — formatos que a IA devolve", () => {
  it("CASO REAL: grupo só com categoriaEdital, sem itens, não quebra nem vira lixo na tela", () => {
    const json = '[{"categoriaEdital":"não encontrado no texto do edital"}]';
    const grupos = lerGruposHabilitacao(json);
    expect(grupos).toEqual([]); // nada a mostrar (e nada de objeto para desenhar)
  });

  it("formato atual: mantém os grupos com seus itens", () => {
    const g = normalizarGruposHabilitacao([{ categoriaEdital: "Regularidade Fiscal", itens: ["CND federal", "FGTS"] }]);
    expect(g).toEqual([{ categoriaEdital: "Regularidade Fiscal", itens: ["CND federal", "FGTS"] }]);
  });

  it("formato antigo (lista plana de textos) vira um grupo sem cabeçalho", () => {
    expect(normalizarGruposHabilitacao(["Contrato social", "Cartão CNPJ"])).toEqual([{ categoriaEdital: null, itens: ["Contrato social", "Cartão CNPJ"] }]);
  });

  it("mistura: grupo bom + grupo sem itens + texto solto", () => {
    const g = normalizarGruposHabilitacao([{ categoriaEdital: "Fiscal", itens: ["CND"] }, { categoriaEdital: "Técnica" }, "Atestado de capacidade"]);
    expect(g).toEqual([
      { categoriaEdital: null, itens: ["Atestado de capacidade"] },
      { categoriaEdital: "Fiscal", itens: ["CND"] },
    ]);
  });

  it("itens que não são texto (objetos, números, vazios) viram texto ou somem", () => {
    const g = normalizarGruposHabilitacao([{ categoriaEdital: "X", itens: [{ documento: "Balanço", prazo: "2025" }, 5, "", null, "Certidão"] }]);
    expect(g[0].itens).toEqual(["Balanço — 2025", "5", "Certidão"]);
    for (const item of g[0].itens) expect(typeof item).toBe("string");
  });

  it("lixo total vira lista vazia, nunca exceção", () => {
    for (const v of [null, undefined, 7, "texto", {}, { a: 1 }]) expect(normalizarGruposHabilitacao(v)).toEqual([]);
    expect(lerGruposHabilitacao("isto não é json")).toEqual([]);
    expect(lerGruposHabilitacao(null)).toEqual([]);
  });
});

describe("listas de texto (obrigações, requisitos, riscos)", () => {
  it("objetos na lista viram texto (antes derrubavam a tela)", () => {
    expect(normalizarLista([{ risco: "prazo curto", nivel: "alto" }, "outro risco"])).toEqual(["prazo curto — alto", "outro risco"]);
  });
  it("texto solto vira lista de 1; vazio e lixo viram lista vazia", () => {
    expect(normalizarLista("um item")).toEqual(["um item"]);
    expect(normalizarLista(null)).toEqual([]);
    expect(lerLista("[invalido")).toEqual([]);
    expect(lerLista('["a","b"]')).toEqual(["a", "b"]);
  });
  it("paraTexto nunca devolve objeto", () => {
    for (const v of [{ a: { b: "c" } }, [1, [2, 3]], true, 0, null]) expect(typeof paraTexto(v)).toBe("string");
  });
});

describe("prazos do edital", () => {
  it("objeto no lugar de texto vira texto; sem tipo/prazo some; lixo vira lista vazia", async () => {
    const { normalizarPrazos, lerPrazos } = await import("@/lib/analise-dados");
    const r = normalizarPrazos([
      { tipo: "Impugnação", prazo: "3 dias úteis", referencia: "item 5.1" },
      { tipo: { nome: "Entrega" }, prazo: { dias: 30 }, referencia: null },
      { tipo: "Sem prazo" },
      "texto solto",
    ]);
    expect(r).toEqual([
      { tipo: "Impugnação", prazo: "3 dias úteis", referencia: "item 5.1" },
      { tipo: "Entrega", prazo: "30", referencia: null },
    ]);
    for (const p of r) expect(typeof p.tipo + typeof p.prazo).toBe("stringstring");
    expect(normalizarPrazos("x")).toEqual([]);
    expect(lerPrazos("não é json")).toEqual([]);
  });
});
