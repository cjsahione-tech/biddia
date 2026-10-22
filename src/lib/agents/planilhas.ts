import ExcelJS from "exceljs";

// Planilhas (.xlsx e .csv) viram texto para a auditoria ler: anexos de preços e planilhas de quantitativo são
// documentos PRINCIPAIS do edital e antes eram ignorados em silêncio.

/** Teto de linhas lidas por aba e de caracteres por planilha — uma planilha gigante não pode estourar o tempo nem a IA. */
const MAX_LINHAS_POR_ABA = 4_000;
const MAX_CARACTERES = 400_000;

type Celula = ExcelJS.CellValue;

function textoDaCelula(v: Celula): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as unknown as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as { text?: string }[]).map((p) => p.text ?? "").join("");
    if ("result" in o) return textoDaCelula(o.result as Celula); // fórmula: vale o resultado calculado
    if (typeof o.text === "string") return o.text; // hiperlink
    if (typeof o.error === "string") return "";
    return "";
  }
  return String(v).replace(/\s+/g, " ").trim();
}

/** true se o ZIP é uma pasta de trabalho do Excel (.xlsx). */
export function ehPacoteXlsx(nomesDeArquivos: string[]): boolean {
  return nomesDeArquivos.includes("xl/workbook.xml");
}

/** Texto de um .xlsx: uma seção por aba, uma linha por linha da planilha, células separadas por " | ". */
export async function extrairTextoXlsx(bytes: Uint8Array): Promise<string | null> {
  const wb = new ExcelJS.Workbook();
  // Mesmo escape de proposal-import.ts: o Buffer tipado do exceljs não bate com o do projeto, mas é o mesmo em runtime.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(Buffer.from(bytes) as any);

  const partes: string[] = [];
  let total = 0;
  for (const aba of wb.worksheets) {
    const linhas: string[] = [];
    let cortou = false;
    aba.eachRow({ includeEmpty: false }, (row, n) => {
      if (linhas.length >= MAX_LINHAS_POR_ABA) {
        cortou = true;
        return;
      }
      const celulas: string[] = [];
      for (let c = 1; c <= row.cellCount; c++) celulas.push(textoDaCelula(row.getCell(c).value));
      while (celulas.length > 0 && celulas[celulas.length - 1] === "") celulas.pop();
      if (celulas.length > 0) linhas.push(`${n}: ${celulas.join(" | ")}`);
    });
    if (linhas.length === 0) continue;
    const bloco = `===== PLANILHA: ${aba.name} =====\n${linhas.join("\n")}${cortou ? `\n[...planilha cortada nas primeiras ${MAX_LINHAS_POR_ABA} linhas...]` : ""}`;
    total += bloco.length;
    partes.push(bloco);
    if (total > MAX_CARACTERES) {
      partes.push("[...demais abas omitidas: planilha muito grande...]");
      break;
    }
  }
  const texto = partes.join("\n\n").trim();
  return texto || null;
}

/** Texto de um .csv: decodifica (UTF-8; se vier com caracteres quebrados, tenta Latin-1) e troca o separador por " | ". */
export function extrairTextoCsv(bytes: Uint8Array): string | null {
  let texto = new TextDecoder("utf-8").decode(bytes);
  if (texto.includes("�")) texto = new TextDecoder("latin1").decode(bytes);
  texto = texto.replace(/^﻿/, "").trim();
  if (!texto) return null;
  const primeira = texto.split(/\r?\n/, 1)[0] ?? "";
  const separador = (primeira.match(/;/g)?.length ?? 0) >= (primeira.match(/,/g)?.length ?? 0) ? ";" : ",";
  const linhas = texto
    .split(/\r?\n/)
    .slice(0, MAX_LINHAS_POR_ABA)
    .map((l) => l.split(separador).map((c) => c.replace(/^"|"$/g, "").trim()).join(" | "))
    .filter((l) => l.replace(/[|\s]/g, "") !== "");
  return linhas.length > 0 ? linhas.join("\n").slice(0, MAX_CARACTERES) : null;
}
