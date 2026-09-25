import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin";

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const content = await prisma.siteContent.findFirst({ orderBy: { updatedAt: "desc" } });
  return NextResponse.json({ content });
}

const schema = z.object({
  heroTitulo: z.string().min(1),
  heroSubtitulo: z.string().min(1),
  heroImagemUrl: z.string().url().nullable().optional(),
  agentesSecaoTitulo: z.string().min(1),
  agentesSecaoDescricao: z.string().min(1),
  estudoSecaoTitulo: z.string().min(1),
  estudoSecaoDescricao: z.string().min(1),
});

// Singleton: sempre atualiza a linha mais recente (ou cria a primeira) — nunca acumula
// histórico de versões, a home pública só lê a mais recente.
export async function PATCH(req: Request) {
  const { error } = await requireAdmin();
  if (error) return error;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  }

  const existente = await prisma.siteContent.findFirst({ orderBy: { updatedAt: "desc" } });
  const content = existente
    ? await prisma.siteContent.update({ where: { id: existente.id }, data: parsed.data })
    : await prisma.siteContent.create({ data: parsed.data });

  return NextResponse.json({ content });
}
