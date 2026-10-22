import { describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";

vi.mock("@/lib/anthropic", () => ({ transcreverPdfViaVisao: vi.fn(), OCR_VISAO_LIMITE_BYTES: 15 * 1024 * 1024 }));

import {
  detectarFormato,
  escolherPaginasParaOcr,
  extrairTextoPdfEmLotes,
  formatarIntervalos,
  ehOcrEmAndamento,
  PAGINAS_POR_LOTE_OCR,
  TETO_PAGINAS_OCR,
  type EstadoOcr,
} from "@/lib/agents/leitura-documentos";
import { extrairTextoCsv, extrairTextoXlsx } from "@/lib/agents/planilhas";
import { extrairTextoDeZip, MARCA_ILEGIVEL, textoSoIlegivel } from "@/lib/agents/arquivos-compactados";

const bytesDe = (...n: number[]) => new Uint8Array([...n, 0, 0, 0, 0]);

describe("detectarFormato — pelo conteúdo, não pelo nome", () => {
  it("reconhece PDF, ZIP, Word antigo, imagem e página de site no lugar do arquivo", () => {
    expect(detectarFormato(bytesDe(0x25, 0x50, 0x44, 0x46))).toBe("pdf");
    expect(detectarFormato(bytesDe(0x50, 0x4b, 0x03, 0x04))).toBe("zip");
    expect(detectarFormato(bytesDe(0xd0, 0xcf, 0x11, 0xe0))).toBe("doc_antigo");
    expect(detectarFormato(bytesDe(0xff, 0xd8, 0xff, 0xe0))).toBe("imagem");
    expect(detectarFormato(new TextEncoder().encode("<!DOCTYPE html><html><body>Entrar</body></html>"))).toBe("html");
    expect(detectarFormato(new TextEncoder().encode("  <html><head></head></html>"))).toBe("html");
  });
  it("separa .docx e .xlsx de um pacote ZIP qualquer pelos nomes de dentro", () => {
    const zip = bytesDe(0x50, 0x4b, 0x03, 0x04);
    expect(detectarFormato(zip, "x.docx", ["word/document.xml", "[Content_Types].xml"])).toBe("docx");
    expect(detectarFormato(zip, "x.xlsx", ["xl/workbook.xml"])).toBe("xlsx");
    expect(detectarFormato(zip, "pacote.zip", ["edital.pdf", "anexo.pdf"])).toBe("zip");
  });
  it("texto solto: usa a extensão para CSV/TXT; sem pista, 'desconhecido'", () => {
    const t = new TextEncoder().encode("item;qtd\n1;10\n");
    expect(detectarFormato(t, "precos.csv")).toBe("csv");
    expect(detectarFormato(t, "leia.txt")).toBe("txt");
    expect(detectarFormato(t, "arquivo")).toBe("desconhecido");
    expect(detectarFormato(new Uint8Array([1, 2]))).toBe("desconhecido");
  });
});

describe("planilhas viram texto para a auditoria", () => {
  it("lê as abas do .xlsx, linha a linha, com fórmulas pelo resultado", async () => {
    const wb = new ExcelJS.Workbook();
    const a = wb.addWorksheet("Itens");
    a.addRow(["Item", "Descrição", "Qtd", "Valor unit."]);
    a.addRow([1, "Caneta azul", 100, 1.5]);
    a.addRow([2, "Papel A4", 50, { formula: "A3*2", result: 22 }]);
    wb.addWorksheet("Vazia");
    const bytes = new Uint8Array(await wb.xlsx.writeBuffer());
    const texto = await extrairTextoXlsx(bytes);
    expect(texto).toContain("===== PLANILHA: Itens =====");
    expect(texto).toContain("1: Item | Descrição | Qtd | Valor unit.");
    expect(texto).toContain("2: 1 | Caneta azul | 100 | 1.5");
    expect(texto).toContain("Papel A4 | 50 | 22");
    expect(texto).not.toContain("Vazia");
  });
  it("CSV com ponto e vírgula e acentos", () => {
    const csv = new TextEncoder().encode('item;descrição;qtd\n1;"Cadeira giratória";10\n;;\n');
    expect(extrairTextoCsv(csv)).toBe("item | descrição | qtd\n1 | Cadeira giratória | 10");
  });
  it("um .xlsx solto ou dentro de um ZIP é lido (antes era ignorado em silêncio)", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Preços").addRow(["Serviço de limpeza", 12000]);
    const xlsx = new Uint8Array(await wb.xlsx.writeBuffer());
    const direto = await extrairTextoDeZip(xlsx, async () => null);
    expect(direto).toContain("Serviço de limpeza | 12000");

    const pacote = new JSZip();
    pacote.file("anexo-precos.xlsx", xlsx);
    pacote.file("quantitativo.csv", "item;qtd\n1;5\n");
    const texto = await extrairTextoDeZip(new Uint8Array(await pacote.generateAsync({ type: "uint8array" })), async () => null);
    expect(texto).toContain("===== ARQUIVO: anexo-precos.xlsx =====");
    expect(texto).toContain("Serviço de limpeza | 12000");
    expect(texto).toContain("===== ARQUIVO: quantitativo.csv =====");
    expect(texto).toContain("item | qtd");
  });
});

describe("escolha das páginas para ler por imagem (teto de 60)", () => {
  const vazias = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
  it("abaixo do teto lê todas", () => {
    expect(escolherPaginasParaOcr(vazias(40), Array(40).fill(""), 60)).toEqual({ escolhidas: vazias(40), deixadas: [] });
  });
  it("documento 100% escaneado acima do teto: começo (cláusulas) + fim (anexos e preços)", () => {
    const { escolhidas, deixadas } = escolherPaginasParaOcr(vazias(200), Array(200).fill(""), 60);
    expect(escolhidas).toHaveLength(60);
    expect(escolhidas.slice(0, 40)).toEqual(vazias(40));
    expect(escolhidas.slice(40)).toEqual(vazias(200).slice(180));
    expect(deixadas).toHaveLength(140);
  });
  it("com texto vizinho de habilitação, prioriza essas páginas", () => {
    const porPagina = Array(100).fill("");
    // páginas 71-72 têm texto digital falando de habilitação; as escaneadas ao redor devem entrar
    porPagina[69] = "Documentos de habilitação: certidão negativa, regularidade fiscal, qualificação técnica e econômico-financeira, balanço patrimonial.";
    porPagina[72] = "Habilitação jurídica: contrato social, certidão negativa de débitos, atestado de capacidade técnica.";
    const vaz = vazias(100).filter((p) => p !== 70 && p !== 73);
    const { escolhidas } = escolherPaginasParaOcr(vaz, porPagina, 10);
    expect(escolhidas).toHaveLength(10);
    expect(escolhidas.every((p) => [69, 71, 72, 74].includes(p) || p > 0)).toBe(true);
    expect(escolhidas).toEqual(expect.arrayContaining([69, 71, 72, 74]));
  });
  it("formata intervalos", () => {
    expect(formatarIntervalos([61, 62, 63, 70, 5, 6])).toBe("5-6, 61-63, 70");
    expect(formatarIntervalos([])).toBe("");
  });
});

async function pdfSemTexto(paginas: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < paginas; i++) doc.addPage([200, 200]);
  return doc.save();
}

/** Simula a IA: devolve "[Pág. N] texto" para cada página do lote. */
const ocrQueResponde = (log: number[][]) => async (_b64: string, paginas: number[]) => {
  log.push(paginas);
  return paginas.map((p) => `[Pág. ${p}]\nTexto da página ${p} com exigência de certidão negativa.`).join("\n");
};

describe("OCR em lotes com progresso guardado", () => {
  it("lê 25 páginas escaneadas em lotes de 10, sem marcar nada como não lido", async () => {
    const bytes = await pdfSemTexto(25);
    const log: number[][] = [];
    const estado: EstadoOcr = { lidas: {} };
    const r = await extrairTextoPdfEmLotes(bytes, {
      estado,
      restanteMs: () => 40_000,
      aoAvancar: async () => {},
      camadaDeTexto: async () => Array(25).fill(""),
      ocrLote: ocrQueResponde(log),
    });
    expect(log.map((l) => l.length)).toEqual([PAGINAS_POR_LOTE_OCR, PAGINAS_POR_LOTE_OCR, 5]);
    expect(r.paginasNaoLidas).toEqual([]);
    expect(r.viaOcr).toBe(true);
    expect(r.texto).toContain("[Pág. 25]\nTexto da página 25");
    expect(r.texto).not.toContain(MARCA_ILEGIVEL);
  });

  it("acaba o tempo no meio: guarda o progresso e a próxima execução continua sem refazer páginas", async () => {
    const bytes = await pdfSemTexto(25);
    const log: number[][] = [];
    const estado: EstadoOcr = { lidas: {} };
    let salvou = 0;
    // 1ª execução: só dá tempo de 1 lote
    let relogio = 40_000;
    const ctx1 = {
      estado,
      restanteMs: () => relogio,
      aoAvancar: async () => {
        salvou++;
        relogio = 10_000; // depois do primeiro lote o tempo acabou
      },
      camadaDeTexto: async () => Array(25).fill(""),
      ocrLote: ocrQueResponde(log),
    };
    const erro = await extrairTextoPdfEmLotes(bytes, ctx1).catch((e) => e);
    expect(ehOcrEmAndamento(erro)).toBe(true);
    expect(log).toHaveLength(1);
    expect(Object.keys(estado.lidas)).toHaveLength(10);

    // 2ª execução (estado vindo "do banco"): continua da página 11
    const estadoSalvo = JSON.parse(JSON.stringify(estado)) as EstadoOcr;
    const r = await extrairTextoPdfEmLotes(bytes, { ...ctx1, estado: estadoSalvo, restanteMs: () => 40_000, aoAvancar: async () => {} });
    expect(log[1]![0]).toBe(11);
    expect(log.flat()).toHaveLength(25); // nenhuma página lida duas vezes
    expect(r.paginasNaoLidas).toEqual([]);
    expect(salvou).toBeGreaterThan(0);
  });

  it("acima do teto: lê só 60 e avisa quais páginas ficaram de fora (resultado nunca fica 'completo')", async () => {
    const bytes = await pdfSemTexto(100);
    const log: number[][] = [];
    const r = await extrairTextoPdfEmLotes(bytes, {
      estado: { lidas: {} },
      restanteMs: () => 1_000_000,
      aoAvancar: async () => {},
      camadaDeTexto: async () => Array(100).fill(""),
      ocrLote: ocrQueResponde(log),
    });
    expect(log.flat()).toHaveLength(TETO_PAGINAS_OCR);
    expect(r.paginasNaoLidas).toHaveLength(40);
    expect(r.texto).toContain(MARCA_ILEGIVEL);
    expect(r.texto).toMatch(/acima do limite de leitura por imagem/);
    expect(textoSoIlegivel(r.texto!)).toBe(false); // há conteúdo lido; só está marcado como incompleto
  });

  it("leitura completa liberada pelo analista: sem teto", async () => {
    const bytes = await pdfSemTexto(70);
    const log: number[][] = [];
    const r = await extrairTextoPdfEmLotes(bytes, {
      estado: { lidas: {} },
      restanteMs: () => 1_000_000,
      aoAvancar: async () => {},
      semTeto: true,
      camadaDeTexto: async () => Array(70).fill(""),
      ocrLote: ocrQueResponde(log),
    });
    expect(log.flat()).toHaveLength(70);
    expect(r.paginasNaoLidas).toEqual([]);
  });

  it("a IA não responde um lote: guarda o que tem e lança 'em andamento' (não é falha do arquivo, não perde páginas)", async () => {
    const bytes = await pdfSemTexto(15);
    const estado: EstadoOcr = { lidas: {} };
    let chamadas = 0;
    const avancos: boolean[] = [];
    const erro = await extrairTextoPdfEmLotes(bytes, {
      estado,
      restanteMs: () => 1_000_000,
      aoAvancar: async (a) => void avancos.push(a),
      camadaDeTexto: async () => Array(15).fill(""),
      ocrLote: async (_b, paginas) => (++chamadas === 1 ? paginas.map((p) => `[Pág. ${p}]\nok ${p} certidão negativa de débitos`).join("\n") : null),
    }).catch((e) => e);
    expect(ehOcrEmAndamento(erro)).toBe(true);
    expect(Object.keys(estado.lidas)).toHaveLength(10);
    expect(avancos).toEqual([true, false]); // o lote que falhou NÃO conta como avanço (evita laço infinito)
    expect(estado.falhasDeLote).toBe(1);
  });

  it("página que a IA nunca devolve: depois de 2 tentativas vira 'não lida' e a auditoria marca leitura incompleta", async () => {
    const bytes = await pdfSemTexto(3);
    const estado: EstadoOcr = { lidas: {} };
    const ctx = {
      estado,
      restanteMs: () => 1_000_000,
      aoAvancar: async () => {},
      camadaDeTexto: async () => Array(3).fill(""),
      // devolve só as páginas 1 e 3
      ocrLote: async () => "[Pág. 1]\num documento com texto suficiente para contar\n[Pág. 3]\noutro trecho com texto suficiente",
    };
    const r = await extrairTextoPdfEmLotes(bytes, ctx);
    expect(r.paginasNaoLidas).toEqual([2]);
    expect(r.texto).toContain(MARCA_ILEGIVEL);
    expect(r.texto).toMatch(/páginas 2 não lidas \(ilegíveis\)/);
  });

  it("PDF com texto digital e só 1–2 páginas em branco: não gasta IA nenhuma", async () => {
    const bytes = await pdfSemTexto(5);
    const log: number[][] = [];
    const camada = ["a".repeat(300), "b".repeat(300), "", "c".repeat(300), "d".repeat(300)];
    const r = await extrairTextoPdfEmLotes(bytes, {
      estado: { lidas: {} },
      restanteMs: () => 1_000_000,
      aoAvancar: async () => {},
      camadaDeTexto: async () => camada,
      ocrLote: ocrQueResponde(log),
    });
    expect(log).toHaveLength(0);
    expect(r.viaOcr).toBe(false);
    expect(r.paginasNaoLidas).toEqual([]);
  });
});
