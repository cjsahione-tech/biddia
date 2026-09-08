import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";
import { parseItens, aplicarDesconto } from "@/lib/proposal";

const MOEDA = "#,##0.00";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id } = await params;

  const edital = await prisma.edital.findFirst({
    where: { id, companyId: company!.id },
    include: { proposal: true },
  });
  if (!edital) return NextResponse.json({ error: "Edital não encontrado" }, { status: 404 });
  if (!edital.proposal) {
    return NextResponse.json({ error: "Este edital ainda não tem uma proposta financeira" }, { status: 404 });
  }

  const itens = aplicarDesconto(parseItens(edital.proposal.itensJson), edital.proposal.descontoPercentual);
  const somaSemDesconto = itens.reduce((acc, i) => acc + i.valorTotal, 0);
  const somaComDesconto = itens.reduce((acc, i) => acc + i.valorTotalComDesconto, 0);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Licitax";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Proposta");
  sheet.columns = [
    { width: 44 },
    { width: 10 },
    { width: 10 },
    { width: 16 },
    { width: 18 },
    { width: 16 },
    { width: 18 },
  ];

  sheet.mergeCells("A1:G1");
  sheet.getCell("A1").value = company!.razaoSocial;
  sheet.getCell("A1").font = { bold: true, size: 14 };

  sheet.mergeCells("A2:G2");
  sheet.getCell("A2").value = `Proposta comercial — ${edital.titulo}`;
  sheet.getCell("A2").font = { size: 11, color: { argb: "FF555555" } };

  sheet.mergeCells("A3:G3");
  sheet.getCell("A3").value = `${edital.orgaoNome} — ${edital.numeroControlePNCP}`;
  sheet.getCell("A3").font = { size: 10, color: { argb: "FF888888" } };

  sheet.addRow([]);

  const headerRow = sheet.addRow([
    "Descrição",
    "Unidade",
    "Quantidade",
    "Valor unitário",
    "Valor unit. c/ desconto",
    "Valor total",
    "Valor total c/ desconto",
  ]);
  headerRow.font = { bold: true };
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF2FF" } };
    cell.border = { bottom: { style: "thin", color: { argb: "FFCBD5E1" } } };
  });

  for (const item of itens) {
    const row = sheet.addRow([
      item.descricao,
      item.unidade,
      item.quantidade,
      item.valorUnitario,
      item.valorUnitarioComDesconto,
      item.valorTotal,
      item.valorTotalComDesconto,
    ]);
    row.getCell(4).numFmt = MOEDA;
    row.getCell(5).numFmt = MOEDA;
    row.getCell(6).numFmt = MOEDA;
    row.getCell(7).numFmt = MOEDA;
  }

  sheet.addRow([]);
  const descontoRow = sheet.addRow(["Desconto aplicado", `${edital.proposal.descontoPercentual}%`]);
  descontoRow.font = { bold: true };

  const totalSemRow = sheet.addRow(["Valor global sem desconto", "", "", "", "", somaSemDesconto]);
  totalSemRow.getCell(6).numFmt = MOEDA;
  totalSemRow.font = { bold: true };

  const totalComRow = sheet.addRow(["Valor global com desconto", "", "", "", "", "", somaComDesconto]);
  totalComRow.getCell(7).numFmt = MOEDA;
  totalComRow.font = { bold: true };
  totalComRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF2FF" } };
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const nomeArquivo = `Proposta - ${edital.titulo}`.replace(/[^a-zA-Z0-9-_ ]/g, "");

  return new NextResponse(Buffer.from(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nomeArquivo}.xlsx"`,
    },
  });
}
