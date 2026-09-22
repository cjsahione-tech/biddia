import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";
import { parseItens } from "@/lib/proposal";

const MOEDA = "#,##0.00";

/**
 * Modelo de planilha (.xlsx) para o usuário preencher e importar em
 * POST /api/editais/[id]/proposal/importar — mesmas 4 colunas que o import espera:
 * Descrição, Unidade, Quantidade, Valor unitário. Quando já existe uma proposta para o
 * edital, o modelo já vem preenchido com os itens atuais (fica mais fácil ajustar do
 * que digitar tudo de novo); sem proposta ainda, vem com uma linha de exemplo.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id } = await params;

  const edital = await prisma.edital.findFirst({
    where: { id, companyId: company!.id },
    include: { proposal: true },
  });
  if (!edital) return NextResponse.json({ error: "Edital não encontrado" }, { status: 404 });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Bidd.IA";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Proposta");
  sheet.columns = [{ width: 44 }, { width: 10 }, { width: 12 }, { width: 16 }];

  const headerRow = sheet.addRow(["Descrição", "Unidade", "Quantidade", "Valor unitário"]);
  headerRow.font = { bold: true };
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF2FF" } };
    cell.border = { bottom: { style: "thin", color: { argb: "FFCBD5E1" } } };
  });

  const itensAtuais = edital.proposal ? parseItens(edital.proposal.itensJson) : [];

  if (itensAtuais.length > 0) {
    for (const item of itensAtuais) {
      const row = sheet.addRow([item.descricao, item.unidade, item.quantidade, item.valorUnitario]);
      row.getCell(4).numFmt = MOEDA;
    }
  } else {
    const exemplo = sheet.addRow(["Exemplo: Serviço de manutenção preventiva", "un", 10, 150.5]);
    exemplo.font = { italic: true, color: { argb: "FF999999" } };
    exemplo.getCell(4).numFmt = MOEDA;
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const nomeArquivo = `Modelo para importar - ${edital.titulo}`.replace(/[^a-zA-Z0-9-_ ]/g, "");

  return new NextResponse(Buffer.from(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nomeArquivo}.xlsx"`,
    },
  });
}
