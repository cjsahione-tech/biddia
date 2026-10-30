/**
 * Abre o arquivo enviado (Excel .xlsx ou CSV) e devolve a leitura dos itens. A parte de
 * "entender as colunas" está em planilha-resultado.ts (pura, testável sem exceljs).
 */
import ExcelJS from "exceljs";
import {
  csvParaMatriz,
  decodificarTexto,
  lerPlanilhaDeMatriz,
  type Celula,
  type LeituraPlanilha,
  type Mapeamento,
  type Matriz,
} from "@/lib/planilha-resultado";

const MAX_LINHAS = 5000;
const MAX_COLUNAS = 60;

export class ErroLeituraPlanilha extends Error {}

function ehZip(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b; // "PK" — todo .xlsx é um zip
}

function ehExcelAntigo(bytes: Uint8Array): boolean {
  // .xls antigo (OLE2): D0 CF 11 E0
  return bytes.length > 4 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
}

function celulaParaValor(valor: ExcelJS.CellValue): Celula {
  if (valor == null) return null;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  if (typeof valor === "string") return valor;
  if (typeof valor === "boolean") return null;
  if (valor instanceof Date) return valor.toLocaleDateString("pt-BR");
  if (typeof valor === "object") {
    if ("result" in valor) return celulaParaValor((valor as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
    if ("richText" in valor) return (valor as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join("");
    if ("text" in valor) return String((valor as ExcelJS.CellHyperlinkValue).text);
    if ("error" in valor) return null;
  }
  return null;
}

async function matrizesDoXlsx(bytes: Uint8Array): Promise<{ nome: string; matriz: Matriz }[]> {
  const workbook = new ExcelJS.Workbook();
  // Mesmo escape de tipo usado em proposal-import.ts: o Buffer do exceljs vem de uma cópia
  // mais antiga de @types/node.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await workbook.xlsx.load(Buffer.from(bytes) as any);

  return workbook.worksheets.map((aba) => {
    const matriz: Matriz = [];
    const totalLinhas = Math.min(aba.rowCount, MAX_LINHAS);
    const totalColunas = Math.min(aba.columnCount, MAX_COLUNAS);
    for (let r = 1; r <= totalLinhas; r++) {
      const linha = aba.getRow(r);
      const celulas: Celula[] = [];
      for (let c = 1; c <= totalColunas; c++) celulas.push(celulaParaValor(linha.getCell(c).value));
      matriz.push(celulas);
    }
    return { nome: aba.name, matriz };
  });
}

/**
 * Lê o arquivo e escolhe a aba que realmente tem a lista de itens (a primeira com itens
 * e todas as colunas obrigatórias achadas; senão a que tiver mais itens).
 */
export async function lerArquivoPlanilha(bytes: Uint8Array, nomeArquivo: string, ajuste?: Mapeamento): Promise<LeituraPlanilha> {
  const extensao = nomeArquivo.toLowerCase().split(".").pop() ?? "";

  if (ehExcelAntigo(bytes) || extensao === "xls") {
    throw new ErroLeituraPlanilha("Esse formato de Excel é antigo (.xls). Abra a planilha e salve como .xlsx ou .csv, e envie de novo.");
  }

  let abas: { nome: string | null; matriz: Matriz }[];
  if (ehZip(bytes) || extensao === "xlsx" || extensao === "xlsm") {
    try {
      abas = await matrizesDoXlsx(bytes);
    } catch {
      throw new ErroLeituraPlanilha("Não consegui abrir esse arquivo Excel. Confira se ele não está protegido por senha ou corrompido.");
    }
  } else if (["csv", "txt", "tsv"].includes(extensao) || !ehZip(bytes)) {
    abas = [{ nome: null, matriz: csvParaMatriz(decodificarTexto(bytes)) }];
  } else {
    throw new ErroLeituraPlanilha("Envie uma planilha Excel (.xlsx) ou um arquivo .csv.");
  }

  if (abas.length === 0 || abas.every((a) => a.matriz.length === 0)) {
    throw new ErroLeituraPlanilha("A planilha está vazia.");
  }

  const leituras = abas.map((a) => lerPlanilhaDeMatriz(a.matriz, a.nome, ajuste));
  const completa = leituras.find((l) => l.itens.length > 0 && l.faltando.length === 0);
  if (completa) return completa;
  return leituras.reduce((melhor, atual) => (atual.itens.length > melhor.itens.length ? atual : melhor), leituras[0]);
}
