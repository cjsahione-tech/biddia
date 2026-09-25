import { NextResponse } from "next/server";
import { requireCompany } from "@/lib/api-utils";
import { verificarLimiteUso } from "@/lib/plano";

// Só leitura, pra banner de aviso (nunca bloqueia) na aba Editais — ver DashboardClient.tsx.
export async function GET() {
  const { company, error } = await requireCompany();
  if (error) return error;

  const status = await verificarLimiteUso(company!.id);
  return NextResponse.json(status);
}
