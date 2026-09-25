import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin";

const planoSchema = z.object({
  nome: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "Use só letras minúsculas, números e hífen"),
  publicoAlvo: z.enum(["EMPRESA", "ANALISTA"]),
  precoMensal: z.number().nonnegative(),
  precoAnual: z.number().nonnegative().nullable().optional(),
  maxEditaisAtivos: z.number().int().nonnegative().nullable().optional(),
  maxAnalisesPorMes: z.number().int().nonnegative().nullable().optional(),
  maxEmpresas: z.number().int().nonnegative().nullable().optional(),
  maxUsuarios: z.number().int().nonnegative().nullable().optional(),
  ativo: z.boolean().default(true),
  ordemExibicao: z.number().int(),
  featureIds: z.array(z.string()).default([]),
});

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const planos = await prisma.plan.findMany({
    orderBy: [{ publicoAlvo: "asc" }, { ordemExibicao: "asc" }],
    include: { features: { include: { feature: true } }, _count: { select: { companies: true } } },
  });
  return NextResponse.json({ planos });
}

export async function POST(req: Request) {
  const { error } = await requireAdmin();
  if (error) return error;

  const body = await req.json().catch(() => null);
  const parsed = planoSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  }
  const { featureIds, ...dados } = parsed.data;

  const existente = await prisma.plan.findUnique({ where: { slug: dados.slug } });
  if (existente) {
    return NextResponse.json({ error: "Já existe um plano com este slug" }, { status: 409 });
  }

  const plano = await prisma.plan.create({
    data: { ...dados, features: { create: featureIds.map((featureId) => ({ featureId })) } },
    include: { features: { include: { feature: true } } },
  });
  return NextResponse.json({ plano });
}
