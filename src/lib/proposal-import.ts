import ExcelJS from "exceljs";
import { round2, type ItemProposta } from "@/lib/proposal";

export type ResultadoImportacaoPlanilha = {
  itens: ItemProposta[];
  avisos: string[];
};

/**
 * Converte a primeira aba de uma planilha .xlsx nos itens da proposta financeira,
 * prontos para SUBSTITUIR a proposta que o Agente Financeiro montou. Espera o mesmo
 * formato do modelo baixável em GET /api/editais/[id]/proposal/modelo: linha 1 é
 * cabeçalho, e a partir da linha 2 cada linha é um item com as colunas, nesta ordem:
 * Descrição, Unidade, Quantidade, Valor unitário. O valor total de cada item é sempre
 * recalculado aqui (quantidade × valor unitário), nunca lido de uma coluna da planilha
 * — evita levar adiante um total que o usuário deixou desatualizado na própria planilha.
 */
export async function importarPlanilhaProposta(bytes: Uint8Array): Promise<ResultadoImportacaoPlanilha> {
  const workbook = new ExcelJS.Workbook();
  // exceljs traz sua própria cópia de @types/node (mais antiga), então o `Buffer` do
  // seu `.d.ts` não bate nominalmente com o `Buffer` resolvido pelo tsconfig do
  // projeto — mesmo sendo o mesmo Buffer em runtime. `as any` é o escape apropriado
  // aqui, não um cast pra um tipo genuinamente incompatível.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await workbook.xlsx.load(Buffer.from(bytes) as any);

  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("A planilha não tem nenhuma aba.");

  const itens: ItemProposta[] = [];
  const avisos: string[] = [];

  sheet.eachRow((row, numeroLinha) => {
    if (numeroLinha === 1) return; // linha de cabeçalho

    const descricao = String(row.getCell(1).value ?? "").trim();
    const unidade = String(row.getCell(2).value ?? "").trim();
    const quantidade = paraNumero(row.getCell(3).value);
    const valorUnitario = paraNumero(row.getCell(4).value);

    const linhaVazia = !descricao && !unidade && quantidade == null && valorUnitario == null;
    if (linhaVazia) return;

    if (!descricao) {
      avisos.push(`Linha ${numeroLinha}: sem descrição — ignorada.`);
      return;
    }
    if (quantidade == null || valorUnitario == null) {
      avisos.push(`Linha ${numeroLinha} ("${descricao}"): quantidade ou valor unitário inválido — ignorada.`);
      return;
    }

    itens.push({
      numero: null,
      descricao,
      unidade: unidade || "un",
      quantidade,
      valorUnitario,
      valorTotal: round2(quantidade * valorUnitario),
      lote: null,
      editadoManualmente: false,
    });
  });

  return { itens, avisos };
}

/**
 * Aceita tanto número já numérico (célula formatada como número/fórmula) quanto texto
 * no formato brasileiro (ex: "1.234,56" ou "R$ 1.234,56") — mesma tolerância que os
 * agentes de IA já aplicam ao ler valores do texto do edital.
 */
function paraNumero(valor: ExcelJS.CellValue): number | null {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;

  if (valor && typeof valor === "object" && "result" in valor) {
    // Célula com fórmula: usa o resultado já calculado pelo Excel, não a fórmula em si.
    return paraNumero((valor as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
  }

  if (typeof valor === "string") {
    const texto = valor.trim();
    if (!texto) return null;
    const limpo = texto
      .replace(/[R$\s]/g, "")
      .replace(/\.(?=\d{3}(\D|$))/g, "") // remove separador de milhar (ponto)
      .replace(",", "."); // vírgula decimal → ponto
    const n = Number(limpo);
    return Number.isFinite(n) ? n : null;
  }

  return null;
}
