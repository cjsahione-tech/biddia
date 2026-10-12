import { describe, it, expect, vi, beforeEach } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { extractText, getDocumentProxy } from "unpdf";

const ocr = vi.hoisted(() => ({ chamadas: [] as { base64: string; paginas?: number[] }[], resposta: null as string | null }));

vi.mock("@/lib/anthropic", () => ({
  OCR_VISAO_LIMITE_PAGINAS: 25,
  OCR_VISAO_LIMITE_BYTES: 15 * 1024 * 1024,
  transcreverPdfViaVisao: async (base64: string, opts?: { paginas?: number[] }) => {
    ocr.chamadas.push({ base64, paginas: opts?.paginas });
    return ocr.resposta;
  },
}));

import { mesclarTextoComOcr, montarPdfComPaginas, paginasSemTexto, separarTranscricaoPorPagina } from "@/lib/pdf-paginas";
import { extrairTextoPdfComOrigem } from "@/lib/agents/pdf-extract";

/** PDF de `total` páginas; as listadas em `vazias` ficam em branco (como uma página escaneada). */
async function pdfDe(total: number, vazias: number[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const fonte = await pdf.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= total; n++) {
    const pagina = pdf.addPage([400, 400]);
    if (!vazias.includes(n)) {
      pagina.drawText(`Pagina ${n}: certidao negativa de debitos federais exigida do licitante habilitado`, { x: 10, y: 300, size: 8, font: fonte });
    }
  }
  return pdf.save();
}

async function textoPorPagina(bytes: Uint8Array): Promise<string[]> {
  const doc = await getDocumentProxy(bytes);
  const { text } = await extractText(doc, { mergePages: false });
  return Array.isArray(text) ? text : [text];
}

beforeEach(() => {
  ocr.chamadas.length = 0;
  ocr.resposta = null;
});

describe("ajudantes de página", () => {
  it("paginasSemTexto acha as páginas vazias (a partir de 1)", () => {
    expect(paginasSemTexto(["texto bem comprido da pagina um, com mais de quarenta caracteres", "", "  ", "outra pagina com texto suficiente para contar como texto"])).toEqual([2, 3]);
  });

  it("montarPdfComPaginas gera um PDF só com as páginas pedidas, na ordem", async () => {
    const original = await pdfDe(6, [3, 5]);
    const sub = await montarPdfComPaginas(original, [4, 1]);
    const paginas = await textoPorPagina(sub);
    expect(paginas).toHaveLength(2);
    expect(paginas[0]).toContain("Pagina 4");
    expect(paginas[1]).toContain("Pagina 1");
  });

  it("separarTranscricaoPorPagina devolve só as páginas pedidas, pelo número original", () => {
    const t = "[Pág. 3]\nTexto da três\nmais uma linha\n[Pág. 7]\nTexto da sete\n[Pág. 99]\nnão pedida";
    const m = separarTranscricaoPorPagina(t, [3, 7]);
    expect([...m.keys()]).toEqual([3, 7]);
    expect(m.get(3)).toBe("Texto da três\nmais uma linha");
  });

  it("mesclarTextoComOcr mantém o texto digital e troca só as páginas lidas por OCR", () => {
    const r = mesclarTextoComOcr(["um", "", "três"], new Map([[2, "dois via OCR"]]));
    expect(r).toBe("[Pág. 1]\num\n\n[Pág. 2]\ndois via OCR\n\n[Pág. 3]\ntrês");
  });
});

describe("extrairTextoPdfComOrigem — OCR só das páginas necessárias", () => {
  it("PDF misto: manda para a IA apenas as páginas em branco e devolve o texto no lugar certo", async () => {
    const bytes = await pdfDe(10, [3, 5, 7]);
    ocr.resposta = "[Pág. 3]\nESCANEADA TRES\n\n[Pág. 5]\nESCANEADA CINCO\n\n[Pág. 7]\nESCANEADA SETE";

    const r = await extrairTextoPdfComOrigem(bytes);

    expect(ocr.chamadas).toHaveLength(1);
    expect(ocr.chamadas[0].paginas).toEqual([3, 5, 7]);
    // o PDF enviado à IA tem só 3 páginas (não as 10)
    const enviado = await textoPorPagina(Uint8Array.from(Buffer.from(ocr.chamadas[0].base64, "base64")));
    expect(enviado).toHaveLength(3);

    expect(r.viaOcr).toBe(true);
    expect(r.texto).toContain("[Pág. 1]\nPagina 1");
    expect(r.texto).toMatch(/\[Pág\. 3\]\nESCANEADA TRES/);
    expect(r.texto).toMatch(/\[Pág\. 5\]\nESCANEADA CINCO/);
    expect(r.texto).toMatch(/\[Pág\. 7\]\nESCANEADA SETE/);
    expect(r.texto).toContain("[Pág. 10]\nPagina 10");
  });

  it("só 1 ou 2 páginas em branco (verso em branco, separador): não gasta IA", async () => {
    const r = await extrairTextoPdfComOrigem(await pdfDe(10, [4, 8]));
    expect(ocr.chamadas).toHaveLength(0);
    expect(r.viaOcr).toBe(false);
    expect(r.texto).toContain("Pagina 1");
  });

  it("se o OCR falhar (resposta vazia), segue só com o texto digital — nunca piora", async () => {
    ocr.resposta = null;
    const r = await extrairTextoPdfComOrigem(await pdfDe(10, [3, 5, 7]));
    expect(ocr.chamadas).toHaveLength(1);
    expect(r.viaOcr).toBe(false);
    expect(r.texto).toContain("Pagina 1");
    expect(r.texto).toContain("Pagina 10");
  });

  it("REGRESSÃO — PDF todo escaneado: o arquivo enviado ao OCR chega inteiro (antes chegava vazio)", async () => {
    ocr.resposta = "texto transcrito do documento escaneado";
    const r = await extrairTextoPdfComOrigem(await pdfDe(4, [1, 2, 3, 4]));
    expect(ocr.chamadas).toHaveLength(1);
    expect(ocr.chamadas[0].base64.length).toBeGreaterThan(100);
    expect((await textoPorPagina(Uint8Array.from(Buffer.from(ocr.chamadas[0].base64, "base64")))).length).toBe(4);
    expect(r.viaOcr).toBe(true);
    expect(r.texto).toContain("texto transcrito");
  });

  it("PDF todo com texto: nenhuma chamada de OCR", async () => {
    const r = await extrairTextoPdfComOrigem(await pdfDe(5, []));
    expect(ocr.chamadas).toHaveLength(0);
    expect(r.viaOcr).toBe(false);
  });
});
