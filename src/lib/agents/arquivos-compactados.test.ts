import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { MARCA_ILEGIVEL, extrairPdfUnicoDoZip, textoSoIlegivel } from "@/lib/agents/arquivos-compactados";

describe("textoSoIlegivel", () => {
  it("ZIP que não pôde ser lido (só o aviso) = ilegível", () => {
    expect(textoSoIlegivel(`${MARCA_ILEGIVEL} edital.zip]]`)).toBe(true);
    expect(textoSoIlegivel(`===== ARQUIVO: a.zip =====\n${MARCA_ILEGIVEL} a.pdf]]\n\n${MARCA_ILEGIVEL} b.docx]]`)).toBe(true);
    expect(textoSoIlegivel("   ")).toBe(true);
  });
  it("com conteúdo de verdade, mesmo com um arquivo ilegível junto, é legível", () => {
    const conteudo = "13.1 Regularidade fiscal: certidão negativa de débitos federais e prova de regularidade com o FGTS.";
    expect(textoSoIlegivel(`===== ARQUIVO: edital.pdf =====\n${conteudo}\n\n${MARCA_ILEGIVEL} anexo.zip]]`)).toBe(false);
    expect(textoSoIlegivel(conteudo)).toBe(false);
  });
});

describe("extrairPdfUnicoDoZip — edital publicado dentro de um ZIP", () => {
  const pdf = new TextEncoder().encode("%PDF-1.7 conteudo");

  it("devolve o PDF quando o pacote tem só ele", async () => {
    const zip = new JSZip();
    zip.file("Edital 12-2026.pdf", pdf);
    const r = await extrairPdfUnicoDoZip(await zip.generateAsync({ type: "uint8array" }));
    expect(r && new TextDecoder().decode(r)).toBe("%PDF-1.7 conteudo");
  });

  it("não extrai quando há vários arquivos, Word ou Excel", async () => {
    const varios = new JSZip();
    varios.file("a.pdf", pdf);
    varios.file("b.pdf", pdf);
    expect(await extrairPdfUnicoDoZip(await varios.generateAsync({ type: "uint8array" }))).toBeNull();

    const word = new JSZip();
    word.file("word/document.xml", "<w:p/>");
    expect(await extrairPdfUnicoDoZip(await word.generateAsync({ type: "uint8array" }))).toBeNull();

    const outro = new JSZip();
    outro.file("edital.docx", "x");
    expect(await extrairPdfUnicoDoZip(await outro.generateAsync({ type: "uint8array" }))).toBeNull();
  });
});
