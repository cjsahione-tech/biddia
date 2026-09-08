import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";

export async function GET() {
  const { company, error } = await requireCompany();
  if (error) return error;

  const keywords = await prisma.keyword.findMany({
    where: { companyId: company!.id },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ keywords });
}

const schema = z.object({ term: z.string().min(2).max(60) });

export async function POST(req: Request) {
  const { company, error } = await requireCompany();
  if (error) return error;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Palavra-chave inválida" }, { status: 400 });
  }

  const term = parsed.data.term.trim().toLowerCase();

  const keyword = await prisma.keyword
    .create({ data: { companyId: company!.id, term } })
    .catch(() => null);

  if (!keyword) {
    return NextResponse.json({ error: "Palavra-chave já cadastrada" }, { status: 409 });
  }

  return NextResponse.json({ keyword });
}

export async function DELETE(req: Request) {
  const { company, error } = await requireCompany();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id é obrigatório" }, { status: 400 });

  await prisma.keyword.deleteMany({ where: { id, companyId: company!.id } });
  return NextResponse.json({ ok: true });
}
