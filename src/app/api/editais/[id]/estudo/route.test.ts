/* eslint-disable @typescript-eslint/no-explicit-any -- os mocks deste teste usam any de propósito (dados de mentira) */
import { beforeEach, describe, expect, it, vi } from "vitest";

/* ---------- banco de mentira, em memória ---------- */
type Row = Record<string, any>;
const db = vi.hoisted(() => ({
  edital: [] as Row[],
  estudo: [] as Row[],
  custo: [] as Row[],
  company: [{ id: "c1", regimeTributarioPadrao: "SIMPLES_NACIONAL", anexoSimplesPadrao: "I", rbt12Padrao: 500000 }] as Row[],
  relogio: 1000,
  seq: 0,
}));

function bate(row: Row, where: Row): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v && typeof v === "object" && !(v instanceof Date) && "not" in v) return row[k] !== v.not && !(v.not === null && row[k] == null);
    return row[k] === v;
  });
}
function agora() {
  return new Date(++db.relogio * 1000);
}
function comInclude(e: Row, include?: Row) {
  if (!include) return e;
  const out: Row = { ...e };
  if (include.edital) out.edital = db.edital.find((x) => x.id === e.editalId) ?? null;
  if (include.custosItens) out.custosItens = db.custo.filter((c) => c.estudoId === e.id);
  return out;
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    edital: { findFirst: async ({ where }: any) => db.edital.find((e) => bate(e, where)) ?? null },
    company: { findUnique: async ({ where }: any) => db.company.find((c) => c.id === where.id) ?? null },
    estudoViabilidade: {
      findFirst: async ({ where, orderBy, include }: any) => {
        let r = db.estudo.filter((e) => bate(e, where));
        if (orderBy?.updatedAt === "desc") r = [...r].sort((a, b) => b.updatedAt - a.updatedAt);
        return r[0] ? comInclude(r[0], include) : null;
      },
      findMany: async ({ where, orderBy, take, include }: any) => {
        let r = db.estudo.filter((e) => bate(e, where));
        if (orderBy?.updatedAt === "desc") r = [...r].sort((a, b) => b.updatedAt - a.updatedAt);
        return r.slice(0, take ?? 999).map((e) => comInclude(e, include));
      },
      create: async ({ data }: any) => {
        const row = { id: `s${++db.seq}`, nome: null, requisitosJson: null, requisitosConfirmadoEm: null, itensSnapshotJson: null, parametrosCustoJson: null,
          custosConfirmadoEm: null, calculoConfirmadoEm: null, resultadoCalculoJson: null, margemMinimaAceitavel: null, regimeTributario: null,
          anexoSimples: null, rbt12: null, aliquotasJson: null, tributosConfirmadoEm: null, ...data, createdAt: agora(), updatedAt: agora() };
        db.estudo.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = db.estudo.find((e) => e.id === where.id)!;
        Object.assign(row, data, { updatedAt: agora() });
        return row;
      },
    },
    custoItemEstudo: {
      findMany: async ({ where }: any) => db.custo.filter((c) => bate(c, where)),
      upsert: async ({ where, create, update }: any) => {
        const k = where.estudoId_itemIndex;
        const ex = db.custo.find((c) => c.estudoId === k.estudoId && c.itemIndex === k.itemIndex);
        if (ex) Object.assign(ex, update);
        else db.custo.push({ id: `c${++db.seq}`, ...create });
        return ex ?? create;
      },
    },
    $transaction: async (ops: any[]) => Promise.all(ops),
  },
}));
vi.mock("@/lib/api-utils", () => ({ requireCompany: async () => ({ user: {}, company: { id: "c1" }, error: null }) }));
vi.mock("@/lib/tributos-server", () => ({
  resolverAliquotas: async (p: any) => ({
    regime: p.regime, ramo: p.ramo, anexoSimples: p.anexoSimples ?? undefined, rbt12: p.rbt12 ?? undefined,
    aliquotaTotalEfetiva: p.regime === "SIMPLES_NACIONAL" ? 13 : 20, detalhes: {},
  }),
}));
vi.mock("@/lib/estudo-server", () => ({ estudoInclude: { edital: true } }));

import { GET, POST, PUT, PATCH } from "./route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (metodo: string, corpo?: unknown) =>
  new Request("http://x/api", { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo ? JSON.stringify(corpo) : undefined });

function novoEdital(id: string, itens: Row[], extra: Row = {}) {
  db.edital.push({
    id, companyId: "c1", titulo: `Aviso ${id}`, orgaoNome: "Prefeitura", valorGlobal: null, orcamentoSigiloso: false, tipoObjeto: "BEM",
    proposal: { itensJson: JSON.stringify(itens), valorGlobalReferencia: 0, lotesSelecionadosJson: null }, ...extra,
  });
}
const item = (descricao: string, quantidade: number, valorUnitario: number) => ({
  numero: null, descricao, unidade: "un", quantidade, valorUnitario, valorTotal: quantidade * valorUnitario, lote: null, editadoManualmente: false,
});
const MARGENS = { piso: 5, alvo: 12, inicial: 20, despesas: 8 };

beforeEach(() => {
  db.edital.length = 0; db.estudo.length = 0; db.custo.length = 0; db.relogio = 1000; db.seq = 0;
  db.company[0] = { id: "c1", regimeTributarioPadrao: "SIMPLES_NACIONAL", anexoSimplesPadrao: "I", rbt12Padrao: 500000 };
});

describe("rota da aba Viabilidade", () => {
  it("GET sem estudo devolve estudo nulo e o ramo sugerido", async () => {
    novoEdital("e1", [item("Notebook", 10, 200)]);
    const r = await (await GET(req("GET"), ctx("e1"))).json();
    expect(r.estudo).toBeNull();
    expect(r.produto).toBeNull();
    expect(r.ramoSugerido).toBe("PRODUTO");
  });

  it("edital de outra empresa não aparece", async () => {
    novoEdital("e9", [], { companyId: "outra" });
    expect((await GET(req("GET"), ctx("e9"))).status).toBe(404);
  });

  it("POST cria o estudo com itens congelados e o regime do cadastro já confirmado", async () => {
    novoEdital("e1", [item("Notebook", 10, 200), item("Mouse", 20, 30)]);
    const r = await (await POST(req("POST", { ramo: "PRODUTO" }), ctx("e1"))).json();
    expect(r.estudo.ramo).toBe("PRODUTO");
    expect(r.produto.percentualTributos).toBe(13);
    expect(r.produto.itens).toHaveLength(2);
    expect(r.produto.itens[0]).toMatchObject({ descricao: "Notebook", valorTotalReferencia: 2000, fonteCusto: "VAZIO" });
    expect(r.produto.margens.origem).toBe("PADRAO");
    // chamar de novo não cria um segundo estudo
    await POST(req("POST", { ramo: "PRODUTO" }), ctx("e1"));
    expect(db.estudo).toHaveLength(1);
  });

  it("sem regime no cadastro, o estudo nasce sem impostos confirmados", async () => {
    db.company[0] = { id: "c1", regimeTributarioPadrao: null, anexoSimplesPadrao: null, rbt12Padrao: null };
    novoEdital("e1", [item("Notebook", 10, 200)]);
    const r = await (await POST(req("POST", { ramo: "PRODUTO" }), ctx("e1"))).json();
    expect(r.produto.percentualTributos).toBeNull();
    // concluir sem regime é recusado
    const put = await PUT(req("PUT", { acao: "concluir", margens: MARGENS, itens: [{ itemIndex: 0, custos: { custoAquisicaoUnitario: 100, freteLogistica: 0, icmsStDifal: 0 } }] }), ctx("e1"));
    expect(put.status).toBe(409);
    // escolher o regime pela rota
    const patch = await (await PATCH(req("PATCH", { regimeTributario: "LUCRO_PRESUMIDO" }), ctx("e1"))).json();
    expect(patch.produto.percentualTributos).toBe(20);
  });

  it("conclui o estudo, grava no formato do relatório e guarda os 3 cenários", async () => {
    novoEdital("e1", [item("Notebook", 10, 200), item("Mouse", 20, 30)]);
    await POST(req("POST", { ramo: "PRODUTO" }), ctx("e1"));
    const res = await PUT(
      req("PUT", {
        acao: "concluir",
        margens: MARGENS,
        itens: [
          { itemIndex: 0, custos: { custoAquisicaoUnitario: 100, freteLogistica: 50, icmsStDifal: 30, fornecedor: "Dell" } },
          { itemIndex: 1, custos: { custoAquisicaoUnitario: 15, freteLogistica: 10, icmsStDifal: 0 } },
        ],
      }),
      ctx("e1")
    );
    expect(res.status).toBe(200);
    const estudo = db.estudo[0];
    expect(estudo.custosConfirmadoEm).toBeInstanceOf(Date);
    expect(estudo.calculoConfirmadoEm).toBeInstanceOf(Date);
    expect(estudo.margemMinimaAceitavel).toBe(5);

    const salvo = JSON.parse(estudo.resultadoCalculoJson);
    expect(salvo.consolidado).toBeDefined(); // formato que o relatório antigo lê
    expect(salvo.recomendacao.decisao).toBe("PARTICIPAR");
    expect(salvo.cenarios.consolidado.status).toBe("VIAVEL_COMPETITIVO");
    expect(salvo.itens).toHaveLength(2);

    const custo0 = JSON.parse(db.custo.find((c) => c.itemIndex === 0)!.custosJson);
    expect(custo0).toMatchObject({ custoAquisicaoUnitario: 100, despesasComerciaisAdmin: 8, margemLucroDesejada: 12, fornecedor: "Dell" });

    // o pacote devolvido já mostra o item como SALVO e as margens como SALVAS
    const pacote = await res.json();
    expect(pacote.produto.itens[0].fonteCusto).toBe("SALVO");
    expect(pacote.produto.margens).toMatchObject({ origem: "SALVO", piso: 5, alvo: 12, inicial: 20, despesas: 8 });
  });

  it("recusa concluir com item sem custo, e não marca nada como concluído", async () => {
    novoEdital("e1", [item("Notebook", 10, 200), item("Mouse", 20, 30)]);
    await POST(req("POST", { ramo: "PRODUTO" }), ctx("e1"));
    const res = await PUT(
      req("PUT", { acao: "concluir", margens: MARGENS, itens: [{ itemIndex: 0, custos: { custoAquisicaoUnitario: 100, freteLogistica: 0, icmsStDifal: 0 } }] }),
      ctx("e1")
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("sem custo");
    expect(db.estudo[0].custosConfirmadoEm).toBeNull();
    expect(db.estudo[0].resultadoCalculoJson).toBeNull();
  });

  it("recusa margens fora de ordem", async () => {
    novoEdital("e1", [item("Notebook", 10, 200)]);
    await POST(req("POST", { ramo: "PRODUTO" }), ctx("e1"));
    const res = await PUT(
      req("PUT", { acao: "concluir", margens: { piso: 15, alvo: 10, inicial: 20, despesas: 0 }, itens: [{ itemIndex: 0, custos: { custoAquisicaoUnitario: 100, freteLogistica: 0, icmsStDifal: 0 } }] }),
      ctx("e1")
    );
    expect(res.status).toBe(400);
  });

  it("rascunho guarda os números mas tira o 'concluído' (resultado antigo não vale mais)", async () => {
    novoEdital("e1", [item("Notebook", 10, 200)]);
    await POST(req("POST", { ramo: "PRODUTO" }), ctx("e1"));
    const corpo = (custo: number, acao: string) => ({ acao, margens: MARGENS, itens: [{ itemIndex: 0, custos: { custoAquisicaoUnitario: custo, freteLogistica: 0, icmsStDifal: 0 } }] });
    await PUT(req("PUT", corpo(100, "concluir")), ctx("e1"));
    expect(db.estudo[0].calculoConfirmadoEm).not.toBeNull();
    await PUT(req("PUT", corpo(110, "rascunho")), ctx("e1"));
    expect(db.estudo[0].calculoConfirmadoEm).toBeNull();
    expect(db.estudo[0].resultadoCalculoJson).toBeNull();
    expect(JSON.parse(db.custo[0].custosJson).custoAquisicaoUnitario).toBe(110);
  });

  it("trocar o regime invalida o cálculo salvo, mas mantém os custos", async () => {
    novoEdital("e1", [item("Notebook", 10, 200)]);
    await POST(req("POST", { ramo: "PRODUTO" }), ctx("e1"));
    await PUT(req("PUT", { acao: "concluir", margens: MARGENS, itens: [{ itemIndex: 0, custos: { custoAquisicaoUnitario: 100, freteLogistica: 0, icmsStDifal: 0 } }] }), ctx("e1"));
    await PATCH(req("PATCH", { regimeTributario: "LUCRO_REAL" }), ctx("e1"));
    expect(db.estudo[0].calculoConfirmadoEm).toBeNull();
    expect(db.estudo[0].resultadoCalculoJson).toBeNull();
    expect(JSON.parse(db.custo[0].custosJson).custoAquisicaoUnitario).toBe(100);
  });

  it("MEMÓRIA: o próximo edital com o mesmo produto já vem com o custo sugerido e as margens aprendidas", async () => {
    novoEdital("e1", [item("Notebook Dell 14 polegadas", 10, 200)], { titulo: "Pregão da Saúde" });
    await POST(req("POST", { ramo: "PRODUTO" }), ctx("e1"));
    await PUT(
      req("PUT", { acao: "concluir", margens: MARGENS, itens: [{ itemIndex: 0, custos: { custoAquisicaoUnitario: 100, freteLogistica: 50, icmsStDifal: 30, fornecedor: "Dell" } }] }),
      ctx("e1")
    );

    novoEdital("e2", [item("NOTEBOOK DELL, 14 POLEGADAS", 20, 210), item("Cadeira giratória", 5, 300)]);
    const r = await (await POST(req("POST", { ramo: "PRODUTO" }), ctx("e2"))).json();
    const [nb, cadeira] = r.produto.itens;
    expect(nb.fonteCusto).toBe("HISTORICO");
    expect(nb.custos.custoAquisicaoUnitario).toBe(100);
    expect(nb.custos.fornecedor).toBe("Dell");
    expect(nb.custos.freteLogistica).toBe(100); // 50 para 10 un → 100 para 20 un
    expect(nb.custos.icmsStDifal).toBe(60);
    expect(nb.sugestao).toMatchObject({ rotulo: "Pregão da Saúde", ajustouPorQuantidade: true, ocorrencias: 1 });
    expect(cadeira.fonteCusto).toBe("VAZIO");
    expect(r.produto.margens).toMatchObject({ origem: "APRENDIDO", piso: 5, alvo: 12, inicial: 20, despesas: 8 });
    // a sugestão NÃO foi gravada: só vale quando o usuário salvar
    expect(db.custo.filter((c) => c.estudoId === r.estudo.id)).toHaveLength(0);
  });

  it("estudo ainda não concluído não alimenta a memória", async () => {
    novoEdital("e1", [item("Notebook", 10, 200)]);
    await POST(req("POST", { ramo: "PRODUTO" }), ctx("e1"));
    await PUT(req("PUT", { acao: "rascunho", margens: MARGENS, itens: [{ itemIndex: 0, custos: { custoAquisicaoUnitario: 100, freteLogistica: 0, icmsStDifal: 0 } }] }), ctx("e1"));
    novoEdital("e2", [item("Notebook", 10, 200)]);
    const r = await (await POST(req("POST", { ramo: "PRODUTO" }), ctx("e2"))).json();
    expect(r.produto.itens[0].fonteCusto).toBe("VAZIO");
  });

  it("edital sigiloso: sem valor de referência não conclui; informando, conclui e grava o valor digitado", async () => {
    novoEdital("e1", [item("Notebook", 10, 0)], { orcamentoSigiloso: true });
    await POST(req("POST", { ramo: "PRODUTO" }), ctx("e1"));
    const base = { acao: "concluir", margens: MARGENS };
    const custos = { custoAquisicaoUnitario: 100, freteLogistica: 50, icmsStDifal: 30 };

    const sem = await PUT(req("PUT", { ...base, itens: [{ itemIndex: 0, custos }] }), ctx("e1"));
    expect(sem.status).toBe(400);
    expect((await sem.json()).error).toContain("valor de referência");

    const com = await PUT(req("PUT", { ...base, itens: [{ itemIndex: 0, custos, valorReferenciaUnitario: 200 }] }), ctx("e1"));
    expect(com.status).toBe(200);
    const snap = JSON.parse(db.estudo[0].itensSnapshotJson);
    expect(snap[0]).toMatchObject({ valorUnitario: 200, valorTotal: 2000, valorManual: true });
    const pacote = await com.json();
    expect(pacote.produto.itens[0]).toMatchObject({ valorReferenciaManual: true, valorTotalReferencia: 2000 });
  });

  it("valor de referência digitado NÃO sobrescreve um valor que o edital divulgou", async () => {
    novoEdital("e1", [item("Notebook", 10, 200)]);
    await POST(req("POST", { ramo: "PRODUTO" }), ctx("e1"));
    await PUT(req("PUT", { acao: "rascunho", margens: MARGENS, itens: [{ itemIndex: 0, custos: { custoAquisicaoUnitario: 100, freteLogistica: 0, icmsStDifal: 0 }, valorReferenciaUnitario: 999 }] }), ctx("e1"));
    expect(JSON.parse(db.estudo[0].itensSnapshotJson)[0].valorTotal).toBe(2000);
  });

  it("preço só 'sugerido de mercado' não vira valor do edital", async () => {
    novoEdital("e1", [{ ...item("Notebook", 10, 200), precoSugerido: true }]);
    const r = await (await POST(req("POST", { ramo: "PRODUTO" }), ctx("e1"))).json();
    expect(r.produto.itens[0].valorTotalReferencia).toBe(0);
  });

  it("edital sem lista de itens vira um item global com o valor do edital", async () => {
    novoEdital("e1", [], { valorGlobal: 68264.57 });
    const r = await (await POST(req("POST", { ramo: "PRODUTO" }), ctx("e1"))).json();
    expect(r.produto.itens).toHaveLength(1);
    expect(r.produto.itens[0]).toMatchObject({ itemGlobal: true, quantidade: 1, valorTotalReferencia: 68264.57 });
  });

  it("respeita os lotes marcados na aba Financeiro", async () => {
    novoEdital("e1", [{ ...item("Notebook", 10, 200), lote: "1" }, { ...item("Cadeira", 5, 300), lote: "2" }]);
    db.edital[0].proposal.lotesSelecionadosJson = JSON.stringify(["2"]);
    const r = await (await POST(req("POST", { ramo: "PRODUTO" }), ctx("e1"))).json();
    expect(r.produto.itens.map((i: any) => i.descricao)).toEqual(["Cadeira"]);
  });

  it("estudo de serviço nasce com os impostos do cadastro e sem pacote de produto", async () => {
    novoEdital("e1", [], { tipoObjeto: "SERVICO" });
    const r = await (await POST(req("POST", { ramo: "SERVICO" }), ctx("e1"))).json();
    expect(r.estudo.ramo).toBe("SERVICO");
    expect(r.produto).toBeNull();
    expect(r.estudo.tributosConfirmadoEm).toBeTruthy();
    expect(r.ramoSugerido).toBe("SERVICO");
  });
});
