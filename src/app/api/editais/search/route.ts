import { NextResponse } from "next/server";
import { requireCompany } from "@/lib/api-utils";
import { executarAgente1 } from "@/lib/agents/agente1-comercial";

// Cada edital novo pode baixar até 5 arquivos (edital, TR, até 3 anexos de preços) —
// mantém explícito o teto real da Vercel para não parecer configurável além dele.
export const maxDuration = 60;

/** Dispara o Agente Comercial para varrer o PNCP com as palavras-chave da empresa. */
export async function POST() {
  const { company, error } = await requireCompany();
  if (error) return error;

  try {
    const resultado = await executarAgente1(company!.id);
    return NextResponse.json(resultado);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao buscar editais";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
