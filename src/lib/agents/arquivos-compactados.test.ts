import { describe, expect, it } from "vitest";
import { MARCA_ILEGIVEL, textoSoIlegivel } from "@/lib/agents/arquivos-compactados";

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
