import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";
import { gerarAnexoPropostaComercial } from "@/lib/agents/proposta-comercial";

// Geração de PDF+DOCX (com IA pra encontrar o modelo do edital) pode levar alguns
// segundos — mesmo teto das outras rotas de geração de documento desta plataforma.
export const maxDuration = 60;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id } = await params;

  const edital = await prisma.edital.findFirst({ where: { id, companyId: company!.id } });
  if (!edital) return NextResponse.json({ error: "Edital não encontrado" }, { status: 404 });

  try {
    const documentos = await gerarAnexoPropostaComercial(id);
    return NextResponse.json({ documentos });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Não foi possível gerar o anexo agora.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
