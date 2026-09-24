import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";

const schema = z.object({ lotesSelecionados: z.array(z.string()) });

/** Salva quais lotes a empresa decidiu disputar — a tabela de itens continua mostrando
 * todos os lotes, só o anexo final (gerar-anexo) e as somas exibidas usam os marcados. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id } = await params;

  const edital = await prisma.edital.findFirst({ where: { id, companyId: company!.id } });
  if (!edital) return NextResponse.json({ error: "Edital não encontrado" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

  const existing = await prisma.proposal.findUnique({ where: { editalId: id } });
  if (!existing) {
    return NextResponse.json({ error: "Este edital ainda não tem uma proposta financeira" }, { status: 404 });
  }

  const proposal = await prisma.proposal.update({
    where: { editalId: id },
    data: { lotesSelecionadosJson: JSON.stringify(parsed.data.lotesSelecionados) },
  });

  return NextResponse.json({ proposal });
}
