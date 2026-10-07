import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin";
import { gerarSlug } from "@/lib/slug";

const planoSchema = z.object({
  nome: z.string().trim().min(1, "Informe o nome do plano"),
  // Opcional: em branco, é gerado sozinho a partir do nome (ex.: "Plano Ouro" -> "plano-ouro").
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]*$/, "O identificador (slug) aceita só letras minúsculas, números e hífen")
    .optional(),
  publicoAlvo: z.enum(["EMPRESA", "ANALISTA", "EMPRESA_ANALISTA"]),
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
  const { featureIds, slug: slugInformado, ...dados } = parsed.data;

  const base = slugInformado || gerarSlug(dados.nome);
  if (!base) {
    return NextResponse.json({ error: "Informe um nome com letras ou números para o plano" }, { status: 400 });
  }
  let slug = base;
  if (slugInformado) {
    // Slug digitado à mão: se já existe, avisa em vez de trocar por baixo dos panos.
    if (await prisma.plan.findUnique({ where: { slug } })) {
      return NextResponse.json({ error: "Já existe um plano com este identificador (slug)" }, { status: 409 });
    }
  } else {
    // Gerado a partir do nome: se já existe, acrescenta -2, -3... até ficar único.
    for (let n = 2; await prisma.plan.findUnique({ where: { slug } }); n++) slug = `${base}-${n}`;
  }

  const plano = await prisma.plan.create({
    data: { ...dados, slug, features: { create: featureIds.map((featureId) => ({ featureId })) } },
    include: { features: { include: { feature: true } } },
  });
  return NextResponse.json({ plano });
}
