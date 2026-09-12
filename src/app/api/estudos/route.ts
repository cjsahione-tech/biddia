import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";

const schema = z.object({
  ramo: z.enum(["SERVICO", "PRODUTO"]),
});

/** Lista os estudos de viabilidade da empresa, mais recentes primeiro. */
export async function GET() {
  const { company, error } = await requireCompany();
  if (error) return error;

  const estudos = await prisma.estudoViabilidade.findMany({
    where: { companyId: company!.id },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({ estudos });
}

/** Cria um novo estudo de viabilidade a partir do ramo escolhido (Etapa 0). */
export async function POST(req: Request) {
  const { company, error } = await requireCompany();
  if (error) return error;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Ramo inválido" }, { status: 400 });

  const estudo = await prisma.estudoViabilidade.create({
    data: { companyId: company!.id, ramo: parsed.data.ramo },
  });

  return NextResponse.json({ estudo });
}
