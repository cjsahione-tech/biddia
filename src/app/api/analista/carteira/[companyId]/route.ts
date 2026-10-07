import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAnalista } from "@/lib/analista";
import { invalidarCachePlano } from "@/lib/plano";

const schema = z.discriminatedUnion("acao", [
  z.object({ acao: z.literal("desativar") }),
  z.object({ acao: z.literal("reativar") }),
  // Troca o "Plano mensal" do cliente por outro plano "Empresas do analista de licitação".
  z.object({ acao: z.literal("plano"), planId: z.string().min(1, "Escolha um plano") }),
]);

// Desativar: o cliente sai da carteira ativa, o Analista deixa de "entrar" nele e a cobrança
// adicional dele PARA (o período de cobrança aberto é encerrado hoje — o dia conta, ver
// src/lib/cobranca-carteira.ts). Nada é apagado: a empresa, os editais e o histórico de
// cobrança continuam guardados. Reativar abre um novo período de cobrança.
export async function PATCH(req: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const { user, error } = await requireAnalista();
  if (error) return error;
  const { companyId } = await params;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ação inválida" }, { status: 400 });

  const vinculo = await prisma.analistaCliente.findUnique({ where: { companyId } });
  if (!vinculo || vinculo.analistaId !== user!.id) {
    return NextResponse.json({ error: "Esta empresa não está na sua carteira" }, { status: 403 });
  }

  const agora = new Date();

  if (parsed.data.acao === "plano") {
    const plano = await prisma.plan.findFirst({
      where: { id: parsed.data.planId, publicoAlvo: "EMPRESA_ANALISTA", ativo: true },
    });
    if (!plano) return NextResponse.json({ error: "Plano mensal inválido ou indisponível" }, { status: 400 });
    await prisma.company.update({ where: { id: companyId }, data: { planId: plano.id } });
    // O cache de features por plano dura 60s — invalida para valer já.
    invalidarCachePlano(companyId);
    return NextResponse.json({ ok: true });
  }

  if (parsed.data.acao === "desativar") {
    if (!vinculo.ativo) return NextResponse.json({ ok: true });
    await prisma.$transaction([
      prisma.analistaCliente.update({ where: { id: vinculo.id }, data: { ativo: false, desativadoEm: agora } }),
      prisma.periodoCobrancaCliente.updateMany({
        where: { analistaClienteId: vinculo.id, fim: null },
        data: { fim: agora },
      }),
    ]);
    return NextResponse.json({ ok: true });
  }

  // reativar
  if (vinculo.ativo) return NextResponse.json({ ok: true });
  const plano = user!.planId ? await prisma.plan.findUnique({ where: { id: user!.planId } }) : null;
  if (plano?.maxEmpresas != null) {
    const atual = await prisma.analistaCliente.count({ where: { analistaId: user!.id, ativo: true } });
    if (atual >= plano.maxEmpresas) {
      return NextResponse.json(
        { error: `Sua carteira já está no limite de ${plano.maxEmpresas} cliente(s) do plano ${plano.nome}.` },
        { status: 409 }
      );
    }
  }
  await prisma.$transaction([
    prisma.analistaCliente.update({ where: { id: vinculo.id }, data: { ativo: true, desativadoEm: null } }),
    prisma.periodoCobrancaCliente.create({ data: { analistaClienteId: vinculo.id, inicio: agora } }),
  ]);
  return NextResponse.json({ ok: true });
}
