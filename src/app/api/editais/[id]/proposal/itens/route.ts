import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";
import { parseItens, round2 } from "@/lib/proposal";

const schema = z.object({
  indice: z.number().int().min(0),
  valorUnitario: z.number().nonnegative(),
});

/** Edição inline do valor unitário de UM item — independente do desconto percentual
 * global (que continua aplicando sobre o valorUnitario atual, editado ou não). Marca o
 * item como editadoManualmente pra distinguir na tela de valor extraído pela IA. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id } = await params;

  const edital = await prisma.edital.findFirst({ where: { id, companyId: company!.id } });
  if (!edital) return NextResponse.json({ error: "Edital não encontrado" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

  const proposal = await prisma.proposal.findUnique({ where: { editalId: id } });
  if (!proposal) return NextResponse.json({ error: "Este edital ainda não tem uma proposta financeira" }, { status: 404 });

  const itens = parseItens(proposal.itensJson);
  const { indice, valorUnitario } = parsed.data;
  if (indice >= itens.length) return NextResponse.json({ error: "Item não encontrado" }, { status: 400 });

  itens[indice] = {
    ...itens[indice],
    valorUnitario,
    valorTotal: round2(itens[indice].quantidade * valorUnitario),
    editadoManualmente: true,
  };

  const updated = await prisma.proposal.update({
    where: { editalId: id },
    data: { itensJson: JSON.stringify(itens) },
  });

  return NextResponse.json({ proposal: updated });
}
