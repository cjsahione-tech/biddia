import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-utils";

const companySchema = z.object({
  objetoSocial: z.string().min(5, "Descreva o objeto da empresa"),
  atendeServico: z.boolean().optional(),
  atendeBem: z.boolean().optional(),
  razaoSocial: z.string().min(2),
  cnpj: z.string().min(14, "CNPJ inválido"),
  logradouro: z.string().min(2),
  numero: z.string().min(1),
  complemento: z.string().optional().nullable(),
  bairro: z.string().min(2),
  cidade: z.string().min(2),
  uf: z.string().length(2),
  cep: z.string().min(8),
  banco: z.string().min(1),
  agencia: z.string().min(1),
  conta: z.string().min(1),
  socioNome: z.string().min(2),
  socioCpf: z.string().min(11),
  logoUrl: z.string().optional().nullable(),
  keywords: z.array(z.string().min(2)).optional().default([]),
  regimeTributarioPadrao: z.enum(["SIMPLES_NACIONAL", "LUCRO_PRESUMIDO", "LUCRO_REAL"]).optional().nullable(),
  anexoSimplesPadrao: z.enum(["I", "III", "IV", "V"]).optional().nullable(),
  rbt12Padrao: z.number().min(0).optional().nullable(),
});

function validarTipoAtuacao(data: { atendeServico?: boolean; atendeBem?: boolean }) {
  if (data.atendeServico === undefined && data.atendeBem === undefined) return true;
  return data.atendeServico !== false || data.atendeBem !== false;
}

export async function GET() {
  const { user, error } = await requireUser();
  if (error) return error;

  const company = await prisma.company.findUnique({
    where: { userId: user!.id },
    include: { keywords: true },
  });
  return NextResponse.json({ company });
}

export async function POST(req: Request) {
  const { user, error } = await requireUser();
  if (error) return error;

  const existing = await prisma.company.findUnique({ where: { userId: user!.id } });
  if (existing) {
    return NextResponse.json({ error: "Empresa já cadastrada" }, { status: 409 });
  }

  const body = await req.json().catch(() => null);
  const parsed = companySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  }
  if (!validarTipoAtuacao(parsed.data)) {
    return NextResponse.json(
      { error: "Selecione ao menos um tipo de atuação: serviço ou venda de bem/insumo" },
      { status: 400 }
    );
  }

  const { keywords, ...data } = parsed.data;

  const company = await prisma.company.create({
    data: {
      ...data,
      atendeServico: data.atendeServico ?? true,
      atendeBem: data.atendeBem ?? true,
      userId: user!.id,
      keywords: {
        create: Array.from(new Set(keywords.map((k) => k.trim().toLowerCase()))).map((term) => ({ term })),
      },
    },
    include: { keywords: true },
  });

  return NextResponse.json({ company });
}

export async function PUT(req: Request) {
  const { user, error } = await requireUser();
  if (error) return error;

  const existing = await prisma.company.findUnique({ where: { userId: user!.id } });
  if (!existing) {
    return NextResponse.json({ error: "Empresa ainda não cadastrada" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const parsed = companySchema.omit({ keywords: true }).partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  }
  if (!validarTipoAtuacao({ ...existing, ...parsed.data })) {
    return NextResponse.json(
      { error: "Selecione ao menos um tipo de atuação: serviço ou venda de bem/insumo" },
      { status: 400 }
    );
  }

  const company = await prisma.company.update({
    where: { userId: user!.id },
    data: parsed.data,
    include: { keywords: true },
  });

  return NextResponse.json({ company });
}
