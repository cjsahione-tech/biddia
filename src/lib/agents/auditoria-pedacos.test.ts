import { describe, expect, it } from "vitest";
import {
  CHAVE_LEGADO,
  chaveDoPedaco,
  dividirAoMeio,
  falhaDoPedacoPedeDivisao,
  hashDoPlanoLegado,
  migrarProgressoLegado,
  planejarPedacos,
  reaproveitarProgresso,
  type ProgressoDePedacos,
} from "@/lib/agents/auditoria-pedacos";

const linhas = (n: number, prefixo: string) =>
  Array.from({ length: n }, (_, i) => `${prefixo} ${i}: o licitante deve apresentar certidão negativa de débitos e comprovar a regularidade fiscal e trabalhista.`).join("\n");

const docEdital = { nome: "Edital.pdf", texto: linhas(700, "Cláusula") }; // ~80 mil caracteres
const docTR = { nome: "TR.pdf", texto: linhas(300, "Item") };

describe("planejarPedacos — chaves vêm do conteúdo", () => {
  it("é determinístico e cobre os documentos", () => {
    const a = planejarPedacos([docEdital], { tamanho: 30_000, divididos: new Set() });
    const b = planejarPedacos([docEdital], { tamanho: 30_000, divididos: new Set() });
    expect(a.map((p) => p.chave)).toEqual(b.map((p) => p.chave));
    expect(a.length).toBeGreaterThan(1);
    expect(new Set(a.map((p) => p.chave)).size).toBe(a.length);
  });

  it("acrescentar um documento NÃO muda as chaves dos pedaços já lidos (nada é refeito)", () => {
    const antes = planejarPedacos([docEdital], { tamanho: 30_000, divididos: new Set() }).map((p) => p.chave);
    const depois = planejarPedacos([docEdital, docTR], { tamanho: 30_000, divididos: new Set() }).map((p) => p.chave);
    for (const chave of antes) expect(depois).toContain(chave);
    expect(depois.length).toBeGreaterThan(antes.length);
  });

  it("pedaço dividido é trocado por duas metades que juntas cobrem o texto original", () => {
    const base = planejarPedacos([docEdital], { tamanho: 30_000, divididos: new Set() });
    const alvo = base[0];
    const dividido = planejarPedacos([docEdital], { tamanho: 30_000, divididos: new Set([alvo.chave]) });
    expect(dividido.length).toBe(base.length + 1);
    expect(dividido.map((p) => p.chave)).not.toContain(alvo.chave);
    const metades = dividido.filter((p) => !base.some((b) => b.chave === p.chave));
    expect(metades).toHaveLength(2);
    const [a, b] = dividirAoMeio(alvo.texto);
    expect(metades.map((m) => m.texto)).toEqual(expect.arrayContaining([a, b]));
    expect(a.length + b.length).toBeGreaterThanOrEqual(alvo.texto.length); // superposição, nunca perda
    expect(alvo.texto.startsWith(a)).toBe(true);
    expect(alvo.texto.endsWith(b)).toBe(true);
  });

  it("metade que também falhou é dividida de novo", () => {
    const base = planejarPedacos([docEdital], { tamanho: 30_000, divididos: new Set() });
    const [a] = dividirAoMeio(base[0].texto);
    const nivel2 = planejarPedacos([docEdital], { tamanho: 30_000, divididos: new Set([base[0].chave, chaveDoPedaco(docEdital.nome, a)]) });
    expect(nivel2.length).toBe(base.length + 2);
  });
});

describe("dividirAoMeio", () => {
  it("corta em fim de linha quando possível", () => {
    const texto = linhas(100, "L");
    const [a, b] = dividirAoMeio(texto);
    expect(a.endsWith("\n")).toBe(true);
    expect(b.startsWith("L ")).toBe(true);
  });
  it("texto sem quebras de linha também divide", () => {
    const [a, b] = dividirAoMeio("x".repeat(10_000));
    expect(a.length).toBe(5_000);
    expect(b.length).toBeGreaterThan(5_000);
  });
});

describe("migrarProgressoLegado — leitura gravada antes das chaves continua valendo", () => {
  const docs = [docEdital, docTR];
  const legado = (tamanho: number, feitos: number[]): ProgressoDePedacos => {
    const plano = planejarPedacos(docs, { tamanho, divididos: new Set() });
    return { chunksTotal: plano.length, feitos, brutas: [{ documento: "Certidão X" }], plano: hashDoPlanoLegado(plano) };
  };

  it("plano igual ao atual: converte índices em chaves e guarda as exigências antigas", () => {
    const p = legado(30_000, [0, 1]);
    const usado = migrarProgressoLegado(p, docs, 30_000);
    const plano = planejarPedacos(docs, { tamanho: 30_000, divididos: new Set() });
    expect(usado).toBe(30_000);
    expect(p.feitosChaves).toEqual([plano[0].chave, plano[1].chave]);
    expect(p.brutasPorChave![CHAVE_LEGADO]).toEqual([{ documento: "Certidão X" }]);
    expect(p.feitos).toEqual([]);
  });

  it("progresso feito com o tamanho ANTIGO (45 mil) é reconhecido e o tamanho antigo é mantido", () => {
    const p = legado(45_000, [0]);
    const usado = migrarProgressoLegado(p, docs, 30_000);
    expect(usado).toBe(45_000);
    expect(p.tamanhoPedaco).toBe(45_000);
    expect(p.feitosChaves).toHaveLength(1);
  });

  it("plano que não bate com nada conhecido: recomeça (como sempre foi)", () => {
    const p = legado(30_000, [0, 1]);
    p.plano = "outro";
    migrarProgressoLegado(p, docs, 30_000);
    expect(p.feitosChaves).toEqual([]);
    expect(p.brutasPorChave).toEqual({});
  });

  it("já no formato novo: usa o tamanho gravado e não mexe em nada", () => {
    const p: ProgressoDePedacos = { chunksTotal: 3, feitos: [], brutas: [], tamanhoPedaco: 20_000, feitosChaves: ["a"], brutasPorChave: { a: [] } };
    expect(migrarProgressoLegado(p, docs, 30_000)).toBe(20_000);
    expect(p.feitosChaves).toEqual(["a"]);
  });
});

describe("reaproveitarProgresso — nova auditoria não joga fora o que já foi lido", () => {
  it("mantém pedaços lidos e a leitura por imagem; zera o que depende do momento", () => {
    const json = JSON.stringify({
      passos: 9,
      semAvanco: 1,
      falhas: { d1: { n: 2, motivo: "formato" } },
      lotes: { "0": [] },
      lotesPlano: "x",
      falhasPedaco: { k: 1 },
      tamanhoPedaco: 30_000,
      feitosChaves: ["k1", "k2"],
      brutasPorChave: { k1: [{ documento: "A" }] },
      divididos: ["k3"],
      ocr: { d9: { lidas: { "1": "texto" } } },
    });
    const novo = JSON.parse(reaproveitarProgresso(json)!);
    expect(novo.feitosChaves).toEqual(["k1", "k2"]);
    expect(novo.divididos).toEqual(["k3"]);
    expect(novo.ocr.d9.lidas["1"]).toBe("texto");
    for (const campo of ["passos", "semAvanco", "falhas", "lotes", "lotesPlano", "falhasPedaco"]) expect(novo[campo]).toBeUndefined();
  });
  it("sem leitura nenhuma para aproveitar, ou JSON inválido: começa limpo", () => {
    expect(reaproveitarProgresso(null)).toBeNull();
    expect(reaproveitarProgresso("{ quebrado")).toBeNull();
    expect(reaproveitarProgresso(JSON.stringify({ passos: 3, falhas: {} }))).toBeNull();
  });
  it("progresso no formato antigo também é aproveitado (a migração acontece na leitura)", () => {
    const novo = JSON.parse(reaproveitarProgresso(JSON.stringify({ feitos: [0], brutas: [{ documento: "A" }], plano: "p", chunksTotal: 2, passos: 4 }))!);
    expect(novo.feitos).toEqual([0]);
    expect(novo.passos).toBeUndefined();
  });
});

describe("falhaDoPedacoPedeDivisao", () => {
  it("só falhas do próprio pedaço pedem divisão; falhas do serviço não", () => {
    for (const t of ["RESPOSTA_INVALIDA", "TEMPO_ESGOTADO", "EDITAL_GRANDE"] as const) expect(falhaDoPedacoPedeDivisao(t)).toBe(true);
    for (const t of ["LIMITE_TAXA", "SOBRECARGA", "SERVICO_IA", "CONEXAO", "SALDO_INSUFICIENTE", "CHAVE_INVALIDA", "DESCONHECIDO"] as const) expect(falhaDoPedacoPedeDivisao(t)).toBe(false);
  });
});
