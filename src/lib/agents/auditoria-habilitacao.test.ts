import { describe, it, expect, vi } from "vitest";

// O módulo importa o banco/IA; aqui só testamos funções puras.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/agents/agente1-comercial", () => ({ baixarDocumentosPendentes: async () => {} }));
vi.mock("@/lib/agents/pdf-extract", () => ({ obterTextoBrutoDocumento: async () => null }));
vi.mock("@/lib/notifications", () => ({ notificarPrazosVencendo: async () => {} }));

import { avaliarTodas, selecionarDocumentos } from "@/lib/agents/auditoria-habilitacao";

const val = (s: string) => new Date(`${s}T00:00:00Z`);
const sessao = new Date("2026-10-20T10:00:00-03:00");
const doc = (id: string, catalogoChave: string, validade: string | null = null) => ({
  id,
  tipo: catalogoChave,
  nome: `${id}.pdf`,
  catalogoChave,
  validade: validade ? val(validade) : null,
  updatedAt: new Date(),
});
const exig = (over: Record<string, unknown>) => ({
  categoria: "fiscal",
  documento: "Documento X",
  chave: null as string | null,
  origem: "Edital",
  localizacao: "item 1, pág. 2",
  condicao: null,
  aplicavelSe: null as string | null,
  aplica: true as boolean | null,
  docEmpresaId: null as string | null,
  certeza: true,
  acaoSugerida: null,
  ...over,
});

describe("selecionarDocumentos", () => {
  const base = { tipo: "DOCUMENTO_LICITANET", categoria: "EDITAL", createdAt: new Date(1) };
  it("do LicitaNet, só o envio mais recente do edital vale (retificação)", () => {
    const antigo = { ...base, nome: "1_editais_1700000000.zip" };
    const novo = { ...base, nome: "1_editais_1800000000.zip" };
    const anexo = { ...base, categoria: null, nome: "anexo.pdf" };
    const r = selecionarDocumentos([antigo, novo, anexo]);
    expect(r.lidos).toEqual([novo, anexo]);
    expect(r.ignorados).toEqual([antigo]);
  });
  it("documentos do PNCP entram todos", () => {
    const a = { tipo: "DOCUMENTO_PNCP", categoria: "EDITAL", nome: "a.pdf", createdAt: new Date() };
    const b = { tipo: "DOCUMENTO_PNCP", categoria: "TERMO_REFERENCIA", nome: "b.pdf", createdAt: new Date() };
    expect(selecionarDocumentos([a, b]).lidos).toHaveLength(2);
  });
});

describe("avaliarTodas", () => {
  const docs = [doc("d1", "trabalhista-crf-fgts", "2027-01-01"), doc("d2", "trabalhista-cndt", "2026-10-15"), doc("d3", "fiscal-estadual-icms")];

  it("item do catálogo enviado e válido: atendida; vencido antes da sessão: vencida com aviso", () => {
    const r = avaliarTodas([exig({ chave: "trabalhista-crf-fgts" }), exig({ chave: "trabalhista-cndt" })], docs, sessao);
    expect(r[0].situacao).toBe("ATENDIDA");
    expect(r[1].situacao).toBe("VENCIDA");
    expect(r[1].venceAntesDaSessao).toBe(true);
  });

  it("sem documento no item: não enviada; certeza baixa: verificar", () => {
    const r = avaliarTodas([exig({ chave: "economica-balanco-dre" }), exig({ chave: null, certeza: false })], docs, sessao);
    expect(r[0].situacao).toBe("NAO_ENVIADA");
    expect(r[1].situacao).toBe("VERIFICAR");
  });

  it("a IA não pode creditar o documento de OUTRO item do catálogo", () => {
    const r = avaliarTodas([exig({ chave: "economica-balanco-dre", docEmpresaId: "d1" })], docs, sessao);
    expect(r[0].situacao).toBe("NAO_ENVIADA");
  });

  it("a IA pode indicar um documento personalizado (Outros) que atende", () => {
    const comPersonalizado = [...docs, { id: "d9", tipo: "Atestado de visita técnica", nome: "visita.pdf", catalogoChave: null, validade: null, updatedAt: new Date() }];
    const r = avaliarTodas([exig({ chave: null, docEmpresaId: "d9" })], comPersonalizado, sessao);
    expect(r[0].situacao).toBe("ATENDIDA");
    expect(r[0].documentoEmpresaId).toBe("d9");
  });

  it("versão de produto/serviço do mesmo documento: só com conferência humana", () => {
    const r = avaliarTodas([exig({ chave: "fiscal-estadual-servicos" })], docs, sessao);
    expect(r[0].situacao).toBe("VERIFICAR");
    expect(r[0].observacao).toContain("confira");
  });

  it("exigência só para outro tipo de empresa: não se aplica; sem saber: verificar; vale: segue normal", () => {
    const r = avaliarTodas(
      [
        exig({ aplicavelSe: "cooperativa", aplica: false }),
        exig({ aplicavelSe: "ME/EPP", aplica: null, chave: "trabalhista-crf-fgts" }),
        exig({ aplicavelSe: "sociedades empresárias", aplica: true, chave: "trabalhista-crf-fgts" }),
      ],
      docs,
      sessao
    );
    expect(r.map((x) => x.situacao)).toEqual(["NAO_SE_APLICA", "VERIFICAR", "ATENDIDA"]);
  });
});
