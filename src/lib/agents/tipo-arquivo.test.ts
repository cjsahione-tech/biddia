import { describe, expect, it } from "vitest";
import { contentTypeReal, ehPdf, nomeComExtensao, nomeDoAnexoDoUsuario, tipoDoArquivo } from "@/lib/agents/tipo-arquivo";

const bytes = (...b: number[]) => new Uint8Array(b);
const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj");
const PDF_COM_LIXO = new TextEncoder().encode("﻿\r\n  %PDF-1.4\n...");
const ZIP = bytes(0x50, 0x4b, 0x03, 0x04, 0, 0, 0);
const TEXTO = new TextEncoder().encode("<html>Acesso negado</html>");

describe("formato real do arquivo", () => {
  it("reconhece PDF pelos bytes, mesmo com lixo antes do cabeçalho", () => {
    expect(ehPdf(PDF)).toBe(true);
    expect(ehPdf(PDF_COM_LIXO)).toBe(true);
    expect(ehPdf(TEXTO)).toBe(false);
    expect(tipoDoArquivo(ZIP)).toBe("zip");
    expect(tipoDoArquivo(TEXTO)).toBe("outro");
  });

  it("PDF é sempre application/pdf, não importa o que o servidor disse (era aí que o tipo 'alternava')", () => {
    expect(contentTypeReal(PDF, "application/octet-stream")).toBe("application/pdf");
    expect(contentTypeReal(PDF, "text/plain; charset=utf-8")).toBe("application/pdf");
    expect(contentTypeReal(PDF, null)).toBe("application/pdf");
  });

  it("ZIP sem tipo claro vira application/zip; o resto mantém o que veio", () => {
    expect(contentTypeReal(ZIP, "application/octet-stream")).toBe("application/zip");
    expect(contentTypeReal(TEXTO, "text/html; charset=utf-8")).toBe("text/html");
    expect(contentTypeReal(TEXTO, undefined)).toBe("application/octet-stream");
  });

  it("PDF sempre sai com extensão .pdf", () => {
    expect(nomeComExtensao("Edital-Republicacao", "pdf")).toBe("Edital-Republicacao.pdf");
    expect(nomeComExtensao("Edital.PDF", "pdf")).toBe("Edital.PDF");
    expect(nomeComExtensao("Edital.zip", "pdf")).toBe("Edital.pdf");
    expect(nomeComExtensao("Anexos", "zip")).toBe("Anexos.zip");
    expect(nomeComExtensao("", "pdf")).toBe("documento.pdf");
  });

  it("planilha e documento do Office (ZIP por dentro) mantêm a extensão própria, sem ganhar .zip", () => {
    expect(nomeComExtensao("proposta-final.xlsx", "zip")).toBe("proposta-final.xlsx");
    expect(nomeComExtensao("Contrato.DOCX", "zip")).toBe("Contrato.DOCX");
    expect(nomeComExtensao("dados.csv", "outro")).toBe("dados.csv");
  });

  it("anexo do usuário: mantém a extensão conhecida; sem extensão continua virando .pdf", () => {
    expect(nomeDoAnexoDoUsuario("proposta-final.xlsx")).toBe("proposta-final.xlsx");
    expect(nomeDoAnexoDoUsuario("dados.CSV")).toBe("dados.CSV");
    expect(nomeDoAnexoDoUsuario("foto.jpeg")).toBe("foto.jpeg");
    expect(nomeDoAnexoDoUsuario("contrato assinado")).toBe("contrato assinado.pdf");
    expect(nomeDoAnexoDoUsuario("Ata 2026.final")).toBe("Ata 2026.final.pdf");
  });
});
