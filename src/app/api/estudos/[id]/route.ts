import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";
import { estudoInclude, carregarEstudoDaEmpresa } from "@/lib/estudo-server";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id } = await params;

  const estudo = await prisma.estudoViabilidade.findFirst({
    where: { id, companyId: company!.id },
    include: estudoInclude,
  });
  if (!estudo) return NextResponse.json({ error: "Estudo não encontrado" }, { status: 404 });

  return NextResponse.json({ estudo });
}

const patchSchema = z.object({
  editalId: z.string().min(1).nullable(),
});

/** Etapa 1: vincula (ou desvincula, com editalId: null) o edital de referência do
 * estudo. Confere que o edital pertence à mesma empresa antes de vincular. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id } = await params;

  const estudo = await carregarEstudoDaEmpresa(id, company!.id);
  if (!estudo) return NextResponse.json({ error: "Estudo não encontrado" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

  if (parsed.data.editalId) {
    const edital = await prisma.edital.findFirst({
      where: { id: parsed.data.editalId, companyId: company!.id },
      select: { id: true },
    });
    if (!edital) return NextResponse.json({ error: "Edital não encontrado" }, { status: 404 });
  }

  // Trocar o edital invalida os requisitos revisados de um edital diferente.
  const requisitosResetados =
    parsed.data.editalId !== estudo.editalId ? { requisitosJson: null, requisitosConfirmadoEm: null } : {};

  const updated = await prisma.estudoViabilidade.update({
    where: { id },
    data: { editalId: parsed.data.editalId, ...requisitosResetados },
    include: estudoInclude,
  });

  return NextResponse.json({ estudo: updated });
}

/** Exclui um estudo (rascunho ou simulação que não serve mais). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id } = await params;

  const estudo = await carregarEstudoDaEmpresa(id, company!.id);
  if (!estudo) return NextResponse.json({ error: "Estudo não encontrado" }, { status: 404 });

  await prisma.estudoViabilidade.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
