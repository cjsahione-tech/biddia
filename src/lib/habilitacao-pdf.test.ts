import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { gerarPdfPendenciasHabilitacao } from "@/lib/habilitacao-pdf";
import { textoSituacao, type ItemRelatorio, type RelatorioHabilitacao } from "@/lib/habilitacao-relatorio";
import type { Company } from "@prisma/client";

const company = { razaoSocial: "Empresa Teste LTDA", cnpj: "00.000.000/0001-91", logoUrl: null } as unknown as Company;

const item = (n: number, over: Partial<ItemRelatorio> = {}): ItemRelatorio => ({
  id: `i${n}`,
  documento: `Documento exigido número ${n} com um nome bem comprido para obrigar a quebra de linha na tabela do relatório de pendências`,
  categoria: "fiscal",
  situacao: "NAO_ENVIADA",
  situacaoTexto: "Não enviado",
  origem: "ANEXO I - TR.pdf",
  localizacao: `item 4.${n}, pág. ${n + 4}`,
  condicao: "índices maiores que 1,00 ˚",
  aplicavelSe: null,
  observacao: null,
  acaoSugerida: "Emitir a certidão no site do órgão e enviar na tela Documentos para atender à exigência do edital.",
  validade: null,
  venceAntesDaSessao: false,
  ...over,
});

const base = (pendentes: ItemRelatorio[]): RelatorioHabilitacao => ({
  edital: { id: "e1", titulo: "Pregão 12/2026 — aquisição de materiais", orgaoNome: "Prefeitura de Campinas", municipio: "Campinas", uf: "SP", modalidade: "Pregão Eletrônico" },
  empresa: { razaoSocial: "Empresa Teste LTDA", cnpj: "00000000000191" },
  status: pendentes.length ? "NAO_HABILITADA" : "HABILITADA",
  percentual: pendentes.length ? 40 : 100,
  auditoria: { estado: "CONCLUIDA", mensagem: null, concluidaEm: "2026-10-09T18:00:00Z", dataReferencia: "2026-10-20T13:00:00Z", leituraCompleta: true, documentosLidos: [] },
  resumo: { exigidas: 10, atendidas: 4, pendentes: pendentes.length, naoSeAplicam: 1 },
  pendencias: pendentes.length ? [{ categoria: "fiscal", titulo: "Regularidade Fiscal", itens: pendentes }] : [],
  atendidas: [item(99, { situacao: "ATENDIDA", situacaoTexto: "Atendida" })],
  naoSeAplicam: [item(98, { situacao: "NAO_SE_APLICA", situacaoTexto: "Não se aplica", aplicavelSe: "cooperativa" })],
});

describe("relatório de pendências de habilitação", () => {
  it("texto da situação em português simples", () => {
    expect(textoSituacao("NAO_ENVIADA", null)).toBe("Não enviado");
    expect(textoSituacao("VENCIDA", new Date("2026-10-15T00:00:00Z"))).toBe("Vencido em 15/10/2026");
    expect(textoSituacao("VERIFICAR", null)).toBe("Verificar manualmente");
  });

  it("gera o PDF com muitas pendências, textos longos e símbolos sem quebrar", async () => {
    const pendentes = Array.from({ length: 40 }, (_, i) => item(i));
    const pdf = await gerarPdfPendenciasHabilitacao(company, base(pendentes));
    expect(Buffer.from(pdf.slice(0, 4)).toString()).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(5_000);
  });

  it("gera o PDF 'sem pendências' quando tudo está atendido", async () => {
    const pdf = await gerarPdfPendenciasHabilitacao(company, base([]));
    expect(Buffer.from(pdf.slice(0, 4)).toString()).toBe("%PDF");
  });
});
