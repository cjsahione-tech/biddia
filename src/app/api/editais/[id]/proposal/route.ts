import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";

const schema = z.object({
  descontoPercentual: z.number().min(0, "O desconto não pode ser negativo").max(100, "O desconto não pode passar de 100%"),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id } = await params;

  const edital = await prisma.edital.findFirst({ where: { id, companyId: company!.id } });
  if (!edital) return NextResponse.json({ error: "Edital não encontrado" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  }

  const existing = await prisma.proposal.findUnique({ where: { editalId: id } });
  if (!existing) {
    return NextResponse.json({ error: "Este edital ainda não tem uma proposta financeira" }, { status: 404 });
  }

  const proposal = await prisma.proposal.update({
    where: { editalId: id },
    data: { descontoPercentual: parsed.data.descontoPercentual },
  });

  return NextResponse.json({ proposal });
}
