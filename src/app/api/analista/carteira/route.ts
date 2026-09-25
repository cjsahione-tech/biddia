import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/api-utils";
import { companySchema } from "@/app/api/company/route";
import { nomeSegmentoLicitaNet } from "@/lib/licitanet-segmentos";

async function requireAnalista() {
  const { user, error } = await requireUser();
  if (error) return { user: null, error };
  if (user!.tipoConta !== "ANALISTA") {
    return { user: null, error: NextResponse.json({ error: "Só contas de Analista têm carteira" }, { status: 403 }) };
  }
  return { user, error: null };
}

export async function GET() {
  const { user, error } = await requireAnalista();
  if (error) return error;

  const [carteira, plano] = await Promise.all([
    prisma.analistaCliente.findMany({
      where: { analistaId: user!.id },
      include: { company: { select: { id: true, razaoSocial: true, cnpj: true, cidade: true, uf: true } } },
      orderBy: { createdAt: "desc" },
    }),
    user!.planId ? prisma.plan.findUnique({ where: { id: user!.planId } }) : null,
  ]);

  return NextResponse.json({ carteira, plano });
}

const criarClienteSchema = companySchema.extend({
  emailCliente: z.string().email("E-mail do cliente inválido"),
  senhaCliente: z.string().min(8, "A senha do cliente deve ter ao menos 8 caracteres"),
  tarifaMensal: z.number().nonnegative(),
});

export async function POST(req: Request) {
  const { user, error } = await requireAnalista();
  if (error) return error;

  const body = await req.json().catch(() => null);
  const parsed = criarClienteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  }

  // Teto de carteira do plano do Analista — nunca bloqueia silenciosamente, mensagem clara
  // oferecendo upgrade (mesmo espírito de verificarLimiteUso, mas este SIM bloqueia: é o
  // único limite desta entrega que trava, conforme combinado no plano).
  const plano = user!.planId ? await prisma.plan.findUnique({ where: { id: user!.planId } }) : null;
  if (plano?.maxEmpresas != null) {
    const atual = await prisma.analistaCliente.count({ where: { analistaId: user!.id } });
    if (atual >= plano.maxEmpresas) {
      return NextResponse.json(
        { error: `Sua carteira já está no limite de ${plano.maxEmpresas} cliente(s) do plano ${plano.nome}. Faça upgrade para adicionar mais.` },
        { status: 409 }
      );
    }
  }

  const { emailCliente, senhaCliente, tarifaMensal, keywords, licitanetSegmentoId, ...dadosCompany } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email: emailCliente } });
  if (existing) {
    return NextResponse.json({ error: "Já existe uma conta com este e-mail" }, { status: 409 });
  }

  let segmento: { licitanetSegmentoId: number | null; licitanetSegmentoNome: string | null } | undefined;
  if (licitanetSegmentoId != null) {
    const nome = nomeSegmentoLicitaNet(licitanetSegmentoId);
    if (!nome) return NextResponse.json({ error: "Segmento LicitaNet inválido" }, { status: 400 });
    segmento = { licitanetSegmentoId, licitanetSegmentoNome: nome };
  }

  const passwordHash = await bcrypt.hash(senhaCliente, 10);

  const { company } = await prisma.$transaction(async (tx) => {
    const clienteUser = await tx.user.create({
      data: { name: dadosCompany.razaoSocial, email: emailCliente, passwordHash, tipoConta: "EMPRESA" },
    });
    const company = await tx.company.create({
      data: {
        ...dadosCompany,
        ...segmento,
        atendeServico: dadosCompany.atendeServico ?? true,
        atendeBem: dadosCompany.atendeBem ?? true,
        userId: clienteUser.id,
        keywords: {
          create: Array.from(new Set((keywords ?? []).map((k) => k.trim().toLowerCase()))).map((term) => ({ term })),
        },
      },
    });
    await tx.analistaCliente.create({
      data: { analistaId: user!.id, companyId: company.id, tarifaMensal },
    });
    return { company };
  });

  return NextResponse.json({ company });
}
