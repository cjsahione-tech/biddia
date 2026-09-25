import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin";

const patchSchema = z.object({
  nome: z.string().min(1).optional(),
  publicoAlvo: z.enum(["EMPRESA", "ANALISTA"]).optional(),
  precoMensal: z.number().nonnegative().optional(),
  precoAnual: z.number().nonnegative().nullable().optional(),
  maxEditaisAtivos: z.number().int().nonnegative().nullable().optional(),
  maxAnalisesPorMes: z.number().int().nonnegative().nullable().optional(),
  maxEmpresas: z.number().int().nonnegative().nullable().optional(),
  maxUsuarios: z.number().int().nonnegative().nullable().optional(),
  ativo: z.boolean().optional(),
  ordemExibicao: z.number().int().optional(),
  featureIds: z.array(z.string()).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireAdmin();
  if (error) return error;
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  }
  const { featureIds, ...dados } = parsed.data;

  const plano = await prisma.plan.findUnique({ where: { id } });
  if (!plano) return NextResponse.json({ error: "Plano não encontrado" }, { status: 404 });

  const atualizado = await prisma.$transaction(async (tx) => {
    if (featureIds) {
      await tx.planFeature.deleteMany({ where: { planId: id } });
      if (featureIds.length > 0) {
        await tx.planFeature.createMany({ data: featureIds.map((featureId) => ({ planId: id, featureId })) });
      }
    }
    return tx.plan.update({
      where: { id },
      data: dados,
      include: { features: { include: { feature: true } } },
    });
  });

  return NextResponse.json({ plano: atualizado });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireAdmin();
  if (error) return error;
  const { id } = await params;

  const emUso = await prisma.company.count({ where: { planId: id } });
  if (emUso > 0) {
    return NextResponse.json(
      { error: `Este plano está atribuído a ${emUso} empresa(s) — desative em vez de excluir, ou mude essas empresas de plano primeiro.` },
      { status: 409 }
    );
  }

  await prisma.plan.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
