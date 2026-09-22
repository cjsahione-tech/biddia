import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";
import { gerarPlanilhaProposta } from "@/lib/proposal-planilha";

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

  const { buffer, nomeArquivo } = await gerarPlanilhaProposta(edital, edital.proposal, company!);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nomeArquivo}"`,
    },
  });
}
