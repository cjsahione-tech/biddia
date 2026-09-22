import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { signResetToken } from "@/lib/auth";
import { enviarSms } from "@/lib/notifications/sms";

const schema = z.object({ email: z.string().email() });

// Resposta sempre genérica, faça o que fizer por baixo — não dá pra descobrir por aqui
// se um e-mail tem conta ou se tem número cadastrado (evita enumeração de contas).
const MENSAGEM_GENERICA = "Se o e-mail informado tiver uma conta com número cadastrado, você vai receber um SMS com o link de redefinição.";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "E-mail inválido" }, { status: 400 });

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    include: { company: true },
  });

  const numero = user?.company?.whatsapp;
  if (user && numero) {
    const token = signResetToken(user.id);
    const link = `${process.env.NEXT_PUBLIC_APP_URL}/redefinir-senha?token=${token}`;
    await enviarSms(numero, `Bidd.IA: seu link para redefinir a senha (válido por 15min): ${link}`);
  }

  return NextResponse.json({ message: MENSAGEM_GENERICA });
}
