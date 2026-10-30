/* eslint-disable @typescript-eslint/no-explicit-any -- os mocks deste teste usam any de propósito (dados de mentira) */
import { beforeEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";

/* ---------- banco de mentira, em memória ---------- */
type Row = Record<string, any>;
const db = vi.hoisted(() => ({
  edital: [] as Row[],
  resultado: [] as Row[],
  documento: [] as Row[],
  auditoria: [] as string[],
  seq: 0,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    edital: {
      findFirst: async ({ where }: any) => db.edital.find((e) => e.id === where.id && e.companyId === where.companyId) ?? null,
    },
    resultadoEdital: {
      findUnique: async ({ where }: any) => db.resultado.find((r) => r.editalId === where.editalId) ?? null,
      upsert: async ({ where, create, update }: any) => {
        const existente = db.resultado.find((r) => r.editalId === where.editalId);
        if (existente) {
          Object.assign(existente, update, { updatedAt: new Date("2026-10-30T12:00:00Z") });
          return existente;
        }
        const nova = { id: `r${++db.seq}`, ...create, createdAt: new Date(), updatedAt: new Date("2026-10-30T10:00:00Z") };
        db.resultado.push(nova);
        return nova;
      },
    },
    document: {
      create: async ({ data }: any) => {
        const doc = { id: `d${++db.seq}`, ...data };
        db.documento.push(doc);
        return { id: doc.id };
      },
    },
  },
}));
vi.mock("@/lib/api-utils", () => ({ requireCompany: async () => ({ user: {}, company: { id: "c1" }, error: null }) }));
vi.mock("@/lib/agents/run-tracker", () => ({
  logAudit: async (_id: string, _a: string, etapa: string) => {
    db.auditoria.push(etapa);
  },
  tocarEdital: async () => {},
}));

// O módulo real puxa leitura de PDF/IA; aqui só interessa a conversão base64 → bytes (mesma lógica do original).
vi.mock("@/lib/agents/pdf-extract", () => ({
  base64ParaBytes: (dataUrl: string) => new Uint8Array(Buffer.from(dataUrl.split(",")[1] ?? dataUrl, "base64")),
}));

import { GET, PUT } from "./route";
import { POST as LER } from "./ler/route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (metodo: string, corpo?: unknown) =>
  new Request("http://x/api", { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo ? JSON.stringify(corpo) : undefined });

const itens = [
  { numero: 1, descricao: "Caneta azul", unidade: "un", quantidade: 100, valorUnitario: 1.5 },
  { descricao: "Papel A4", quantidade: 10, valorUnitario: 25.9 },
];

beforeEach(() => {
  db.edital.length = 0;
  db.resultado.length = 0;
  db.documento.length = 0;
  db.auditoria.length = 0;
  db.edital.push({ id: "e1", companyId: "c1", titulo: "Pregão 1/2026", orgaoNome: "Prefeitura", valorGlobal: 1000, proposal: null });
  db.edital.push({ id: "e2", companyId: "outra", titulo: "De outra empresa", orgaoNome: "X", valorGlobal: null, proposal: null });
});

describe("PUT /api/editais/[id]/resultado", () => {
  it("salva o valor homologado e os itens, recalculando o total de cada item", async () => {
    const res = await PUT(req("PUT", { valorHomologado: 409, itens }), ctx("e1"));
    expect(res.status).toBe(200);
    const { resultado } = await res.json();
    expect(resultado.valorHomologado).toBe(409);
    expect(resultado.itens).toHaveLength(2);
    expect(resultado.itens[0]).toMatchObject({ descricao: "Caneta azul", valorTotal: 150 });
    expect(resultado.itens[1]).toMatchObject({ unidade: "un", valorTotal: 259, numero: null });
    expect(db.auditoria).toEqual(["Resultado registrado"]);
  });

  it("guarda a planilha na aba Documentos, fora do pipeline", async () => {
    const res = await PUT(req("PUT", { valorHomologado: 409, itens, arquivo: { nome: "proposta-final.xlsx", base64: "QUJD" } }), ctx("e1"));
    expect(res.status).toBe(200);
    expect(db.documento).toHaveLength(1);
    expect(db.documento[0]).toMatchObject({ editalId: "e1", nome: "proposta-final.xlsx", tipo: "DOCUMENTO_USUARIO", status: "DISPONIVEL" });
    expect((await res.json()).resultado.nomeArquivo).toBe("proposta-final.xlsx");
  });

  it("guarda o arquivo no mesmo formato da aba Documentos (data:<tipo>;base64,...), que é o que o download espera", async () => {
    await PUT(req("PUT", { valorHomologado: 409, itens, arquivo: { nome: "proposta-final.xlsx", base64: "QUJD" } }), ctx("e1"));
    await PUT(req("PUT", { valorHomologado: 409, itens, arquivo: { nome: "dados.CSV", base64: "QUJD" } }), ctx("e1"));
    expect(db.documento[0].conteudoBase64).toBe("data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,QUJD");
    expect(db.documento[1].conteudoBase64).toBe("data:text/csv;base64,QUJD");
  });

  it("corrigir o resultado atualiza o mesmo registro e mantém a planilha anterior", async () => {
    await PUT(req("PUT", { valorHomologado: 409, itens, arquivo: { nome: "a.xlsx", base64: "QUJD" } }), ctx("e1"));
    const res = await PUT(req("PUT", { valorHomologado: 450, itens }), ctx("e1"));
    expect(db.resultado).toHaveLength(1);
    expect(db.documento).toHaveLength(1);
    const { resultado } = await res.json();
    expect(resultado.valorHomologado).toBe(450);
    expect(resultado.nomeArquivo).toBe("a.xlsx");
    expect(db.auditoria).toEqual(["Resultado registrado", "Resultado corrigido"]);
  });

  it("aceita resultado sem planilha", async () => {
    const res = await PUT(req("PUT", { valorHomologado: 1000, itens: [] }), ctx("e1"));
    expect(res.status).toBe(200);
    expect((await res.json()).resultado.itens).toEqual([]);
  });

  it("recusa valor zerado, negativo ou item inválido", async () => {
    expect((await PUT(req("PUT", { valorHomologado: 0, itens: [] }), ctx("e1"))).status).toBe(400);
    expect((await PUT(req("PUT", { valorHomologado: -5, itens: [] }), ctx("e1"))).status).toBe(400);
    expect((await PUT(req("PUT", { valorHomologado: 10, itens: [{ descricao: "", quantidade: 1, valorUnitario: 1 }] }), ctx("e1"))).status).toBe(400);
    expect((await PUT(req("PUT", { valorHomologado: 10, itens: [{ descricao: "A", quantidade: 0, valorUnitario: 1 }] }), ctx("e1"))).status).toBe(400);
    expect(db.resultado).toHaveLength(0);
  });

  it("não deixa mexer em edital de outra empresa", async () => {
    expect((await PUT(req("PUT", { valorHomologado: 10, itens: [] }), ctx("e2"))).status).toBe(404);
    expect((await GET(req("GET"), ctx("e2"))).status).toBe(404);
  });
});

describe("GET /api/editais/[id]/resultado", () => {
  it("devolve null quando ainda não há resultado, junto com o valor de referência", async () => {
    const dados = await (await GET(req("GET"), ctx("e1"))).json();
    expect(dados.resultado).toBeNull();
    expect(dados.edital).toMatchObject({ titulo: "Pregão 1/2026", valorReferencia: 1000 });
  });

  it("devolve o resultado salvo", async () => {
    await PUT(req("PUT", { valorHomologado: 409, itens }), ctx("e1"));
    const dados = await (await GET(req("GET"), ctx("e1"))).json();
    expect(dados.resultado.valorHomologado).toBe(409);
    expect(dados.resultado.itens).toHaveLength(2);
  });
});

describe("POST /api/editais/[id]/resultado/ler", () => {
  async function xlsxBase64(): Promise<string> {
    const wb = new ExcelJS.Workbook();
    const aba = wb.addWorksheet("Proposta");
    aba.addRow(["Item", "Descrição", "Qtd", "Valor unitário"]);
    aba.addRow([1, "Luva", 20, 3.5]);
    aba.addRow([2, "Máscara", 100, 0.8]);
    return Buffer.from(await wb.xlsx.writeBuffer()).toString("base64");
  }

  it("lê a planilha e devolve os itens sem salvar nada", async () => {
    const res = await LER(req("POST", { arquivoBase64: await xlsxBase64(), nomeArquivo: "p.xlsx" }), ctx("e1"));
    expect(res.status).toBe(200);
    const { leitura } = await res.json();
    expect(leitura.itens).toHaveLength(2);
    expect(leitura.itens[1]).toMatchObject({ descricao: "Máscara", valorTotal: 80 });
    expect(leitura.faltando).toEqual([]);
    expect(db.resultado).toHaveLength(0);
    expect(db.documento).toHaveLength(0);
  });

  it("aplica a coluna que o usuário escolheu", async () => {
    const wb = new ExcelJS.Workbook();
    const aba = wb.addWorksheet("P");
    aba.addRow(["Produto", "Qtd", "Preço"]);
    aba.addRow(["Luva", 2, 5]);
    const base64 = Buffer.from(await wb.xlsx.writeBuffer()).toString("base64");
    const res = await LER(req("POST", { arquivoBase64: base64, nomeArquivo: "p.xlsx", ajuste: { valorUnitario: 2 } }), ctx("e1"));
    expect((await res.json()).leitura.itens[0]).toMatchObject({ valorUnitario: 5, valorTotal: 10 });
  });

  it("explica quando o arquivo não é uma planilha legível", async () => {
    const res = await LER(req("POST", { arquivoBase64: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2]).toString("base64"), nomeArquivo: "velho.xls" }), ctx("e1"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/\.xlsx/);
  });

  it("não lê planilha para edital de outra empresa", async () => {
    const res = await LER(req("POST", { arquivoBase64: "QUJD", nomeArquivo: "a.csv" }), ctx("e2"));
    expect(res.status).toBe(404);
  });
});
