import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { extrairTrechoDeAnexoParaCorrecao } from "@/lib/agents/pdf-extract";

/**
 * Gera um PDF real (não uma imagem escaneada) com um marcador de texto único por página
 * — o suficiente para testar a extração por intervalo de páginas e por palavra-chave sem
 * depender de nenhum arquivo fixo em disco.
 */
async function gerarPdfComPaginas(textosPorPagina: string[]): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  for (const texto of textosPorPagina) {
    const page = pdfDoc.addPage([400, 200]);
    page.drawText(texto, { x: 20, y: 150, size: 12, font });
  }
  return pdfDoc.save();
}

describe("extrairTrechoDeAnexoParaCorrecao", () => {
  it("quando a mensagem menciona um intervalo de páginas, extrai exatamente essas páginas (com 1 de folga) em vez do início do documento", async () => {
    const bytes = await gerarPdfComPaginas([
      "MARCADOR_PAGINA_1 conteudo irrelevante do inicio",
      "MARCADOR_PAGINA_2",
      "MARCADOR_PAGINA_3 tabela de producao item 8",
      "MARCADOR_PAGINA_4",
      "MARCADOR_PAGINA_5 nao deveria aparecer",
    ]);

    const trecho = await extrairTrechoDeAnexoParaCorrecao(bytes, "troque a tabela pela página 3 a 3 do anexo");

    expect(trecho).not.toBeNull();
    expect(trecho).toContain("MARCADOR_PAGINA_3");
    // Folga de 1 página de cada lado da página pedida.
    expect(trecho).toContain("MARCADOR_PAGINA_2");
    expect(trecho).toContain("MARCADOR_PAGINA_4");
    // Fora da folga não deveria entrar — é isso que evita voltar a mandar o documento inteiro.
    expect(trecho).not.toContain("MARCADOR_PAGINA_1");
    expect(trecho).not.toContain("MARCADOR_PAGINA_5");
  });

  it("intervalo de páginas fora do total do documento cai para o caminho normal em vez de devolver vazio", async () => {
    const bytes = await gerarPdfComPaginas(["MARCADOR_UNICO conteudo do documento pequeno"]);

    const trecho = await extrairTrechoDeAnexoParaCorrecao(bytes, "veja a página 99 a 109 do anexo");

    expect(trecho).toContain("MARCADOR_UNICO");
  });

  it("sem menção a página, documentos que cabem no limite voltam por inteiro", async () => {
    const bytes = await gerarPdfComPaginas(["MARCADOR_A", "MARCADOR_B"]);

    const trecho = await extrairTrechoDeAnexoParaCorrecao(bytes, "corrija a quantidade do item 2");

    expect(trecho).toContain("MARCADOR_A");
    expect(trecho).toContain("MARCADOR_B");
  });
});
