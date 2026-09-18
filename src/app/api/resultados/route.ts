import { NextResponse } from "next/server";
import { requireCompany } from "@/lib/api-utils";
import { montarResultados, filtrosDaQueryString, buscarEditaisParaResultados } from "@/lib/resultados";

export async function GET(req: Request) {
  const { company, error } = await requireCompany();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const filtros = filtrosDaQueryString(searchParams);

  const editais = await buscarEditaisParaResultados(company!.id);
  const resultados = montarResultados(editais, filtros);

  return NextResponse.json({ resultados });
}
