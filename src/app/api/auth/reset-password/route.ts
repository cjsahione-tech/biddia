import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { normalizarWhatsapp } from "@/lib/whatsapp";

const schema = z.object({
  telefone: z.string().min(8),
  codigo: z.string().min(6).max(6),
  novaSenha: z.string().min(8, "A senha deve ter ao menos 8 caracteres"),
});

const MAX_TENTATIVAS = 5;
const ERRO_GENERICO = "Código inválido ou expirado. Solicite um novo.";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  }

  const numero = normalizarWhatsapp(parsed.data.telefone);
  const company = await prisma.company.findFirst({ where: { whatsapp: numero }, include: { user: true } });
  const user = company?.user;

  if (!user || !user.resetCodeHash || !user.resetCodeExpiresAt || user.resetCodeExpiresAt < new Date()) {
    return NextResponse.json({ error: ERRO_GENERICO }, { status: 400 });
  }

  if (user.resetCodeAttempts >= MAX_TENTATIVAS) {
    // Já estourou o limite de tentativas — invalida o código, obriga a pedir um novo.
    await prisma.user.update({ where: { id: user.id }, data: { resetCodeHash: null, resetCodeExpiresAt: null } });
    return NextResponse.json({ error: ERRO_GENERICO }, { status: 400 });
  }

  const valido = await bcrypt.compare(parsed.data.codigo, user.resetCodeHash);
  if (!valido) {
    await prisma.user.update({ where: { id: user.id }, data: { resetCodeAttempts: { increment: 1 } } });
    return NextResponse.json({ error: ERRO_GENERICO }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(parsed.data.novaSenha, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, resetCodeHash: null, resetCodeExpiresAt: null, resetCodeAttempts: 0 },
  });

  return NextResponse.json({ ok: true });
}
