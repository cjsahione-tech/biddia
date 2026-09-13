import { NextResponse } from "next/server";
import { requireCompany } from "@/lib/api-utils";
import { montarRelatorioEstudo } from "@/lib/estudo-server";

/** Etapa 6: dados consolidados de todas as etapas anteriores, para a tela-resumo. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id } = await params;

  const relatorio = await montarRelatorioEstudo(id, company!.id);
  if (!relatorio) return NextResponse.json({ error: "Estudo não encontrado" }, { status: 404 });

  return NextResponse.json(relatorio);
}
