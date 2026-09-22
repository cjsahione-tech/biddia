import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { normalizarWhatsapp } from "@/lib/whatsapp";
import { enviarSms } from "@/lib/notifications/sms";

const schema = z.object({ telefone: z.string().min(8) });

const VALIDADE_CODIGO_MS = 10 * 60_000;

// Resposta sempre genérica, faça o que fizer por baixo — não dá pra descobrir por aqui
// se um número tem conta (evita enumeração de contas).
const MENSAGEM_GENERICA = "Se esse número tiver uma conta, você vai receber um código por SMS em instantes.";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Telefone inválido" }, { status: 400 });

  const numero = normalizarWhatsapp(parsed.data.telefone);
  const company = await prisma.company.findFirst({ where: { whatsapp: numero }, include: { user: true } });

  if (company?.user) {
    const codigo = String(Math.floor(100000 + Math.random() * 900000));
    const resetCodeHash = await bcrypt.hash(codigo, 10);
    await prisma.user.update({
      where: { id: company.user.id },
      data: { resetCodeHash, resetCodeExpiresAt: new Date(Date.now() + VALIDADE_CODIGO_MS), resetCodeAttempts: 0 },
    });
    // Aguarda o envio terminar antes de responder — é o que mantém a entrega "imediata"
    // do ponto de vista do usuário, sem depender de processamento em segundo plano.
    await enviarSms(numero, `Bidd.IA: seu código para redefinir a senha é ${codigo}. Válido por 10 minutos.`);
  }

  return NextResponse.json({ message: MENSAGEM_GENERICA });
}
