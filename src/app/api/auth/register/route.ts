import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { signSession, setSessionCookie } from "@/lib/auth";

const baseSchema = {
  name: z.string().min(2, "Informe seu nome completo"),
  email: z.string().email("E-mail inválido"),
  password: z.string().min(8, "A senha deve ter ao menos 8 caracteres"),
};

const schema = z.discriminatedUnion("tipoConta", [
  z.object({ tipoConta: z.literal("EMPRESA"), ...baseSchema }),
  z.object({
    tipoConta: z.literal("ANALISTA"),
    ...baseSchema,
    tipoDocumentoAnalista: z.enum(["CPF", "CNPJ"]),
    documentoAnalista: z.string().min(11, "Documento inválido"),
  }),
]);

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
      { status: 400 }
    );
  }

  const { name, email, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(
      { error: "Já existe uma conta com este e-mail" },
      { status: 409 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 10);

  let dadosAnalista: { tipoConta: "ANALISTA"; tipoDocumentoAnalista: "CPF" | "CNPJ"; documentoAnalista: string; planId?: string } | null =
    null;
  if (parsed.data.tipoConta === "ANALISTA") {
    // Plano padrão pro Analista recém-cadastrado — o admin pode trocar depois em
    // /admin/planos; sem isso ele ficaria sem nenhum teto de carteira aplicável.
    const planoPadrao = await prisma.plan.findFirst({
      where: { publicoAlvo: "ANALISTA", ativo: true },
      orderBy: { ordemExibicao: "asc" },
    });
    dadosAnalista = {
      tipoConta: "ANALISTA",
      tipoDocumentoAnalista: parsed.data.tipoDocumentoAnalista,
      documentoAnalista: parsed.data.documentoAnalista,
      ...(planoPadrao ? { planId: planoPadrao.id } : {}),
    };
  }

  const user = await prisma.user.create({
    data: dadosAnalista ? { name, email, passwordHash, ...dadosAnalista } : { name, email, passwordHash },
  });

  const token = signSession({ userId: user.id });
  await setSessionCookie(token);

  return NextResponse.json({ id: user.id, name: user.name, email: user.email, tipoConta: user.tipoConta });
}
