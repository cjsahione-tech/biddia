import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id } = await params;

  const estudo = await prisma.estudoViabilidade.findFirst({
    where: { id, companyId: company!.id },
  });
  if (!estudo) return NextResponse.json({ error: "Estudo não encontrado" }, { status: 404 });

  return NextResponse.json({ estudo });
}

/** Exclui um estudo (rascunho ou simulação que não serve mais). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id } = await params;

  const estudo = await prisma.estudoViabilidade.findFirst({
    where: { id, companyId: company!.id },
  });
  if (!estudo) return NextResponse.json({ error: "Estudo não encontrado" }, { status: 404 });

  await prisma.estudoViabilidade.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
