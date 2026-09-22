import { NextResponse } from "next/server";
import { requireCompany } from "@/lib/api-utils";
import {
  montarResultados,
  filtrosDaQueryString,
  buscarEditaisParaResultados,
  montarSecoesRelatorioResultados,
  tituloRelatorioResultados,
} from "@/lib/resultados";
import { gerarPdfRelatorio } from "@/lib/agents/pdf";

export async function GET(req: Request) {
  const { company, error } = await requireCompany();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const filtros = filtrosDaQueryString(searchParams);

  const editais = await buscarEditaisParaResultados(company!.id);
  const r = montarResultados(editais, filtros);
  const secoes = montarSecoesRelatorioResultados(r, filtros);
  const { titulo, subtitulo } = tituloRelatorioResultados();

  const bytes = await gerarPdfRelatorio({ company: company!, titulo, subtitulo, secoes });

  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Dashboard de Resultados - ${company!.razaoSocial.replace(/[^a-zA-Z0-9-_ ]/g, "")}.pdf"`,
    },
  });
}
