import { NextResponse } from "next/server";
import { z } from "zod";
import { emailsAdmin, requireAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { apagarArquivos, isStorageConfigured, listarArquivosDoPrefixo } from "@/lib/storage";
import { STATUS_ASSINATURA, confirmacaoConfere, motivoParaNaoExcluir } from "@/lib/admin-usuarios";

// Apagar uma conta grande (muitos editais) leva alguns segundos.
export const maxDuration = 60;

const editSchema = z.object({
  statusAssinatura: z.enum(STATUS_ASSINATURA).optional(),
  // null = tirar o plano.
  planId: z.string().min(1).nullable().optional(),
  // null = voltar a valer o preço do plano.
  valorMensalPersonalizado: z.number().finite().nonnegative().max(1_000_000).nullable().optional(),
  emTesteAte: z.string().refine((v) => !Number.isNaN(new Date(v).getTime()), "Data inválida").nullable().optional(),
});

/** Edita a assinatura de uma conta: status, plano, valor combinado e fim do teste. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireAdmin();
  if (error) return error;
  const { id } = await params;

  const parsed = editSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  const { statusAssinatura, planId, valorMensalPersonalizado, emTesteAte } = parsed.data;

  const usuario = await prisma.user.findUnique({ where: { id }, select: { id: true, statusAssinatura: true, company: { select: { id: true } } } });
  if (!usuario) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  if (planId) {
    const plano = await prisma.plan.findUnique({ where: { id: planId }, select: { id: true } });
    if (!plano) return NextResponse.json({ error: "Plano não encontrado" }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id },
      data: {
        ...(statusAssinatura !== undefined
          ? { statusAssinatura, ...(statusAssinatura !== usuario.statusAssinatura ? { statusAssinaturaAtualizadoEm: new Date() } : {}) }
          : {}),
        ...(valorMensalPersonalizado !== undefined ? { valorMensalPersonalizado } : {}),
        ...(emTesteAte !== undefined ? { emTesteAte: emTesteAte ? new Date(emTesteAte) : null } : {}),
        // Analista (sem empresa) guarda o plano no próprio usuário; Empresa, na Company.
        ...(planId !== undefined && !usuario.company ? { planId } : {}),
      },
    });
    if (planId !== undefined && usuario.company) await tx.company.update({ where: { id: usuario.company.id }, data: { planId } });
  });

  return NextResponse.json({ ok: true });
}

/**
 * Exclui a conta e TODOS os dados dela: usuário, empresa, editais (com análises, propostas, checklists,
 * auditorias, documentos), base de documentos, estudos de viabilidade, histórico de consumo de IA e os
 * arquivos no Storage. Não tem volta. Exige o e-mail da conta digitado como confirmação e nunca apaga a
 * própria conta do administrador nem a de outro administrador.
 *
 * Conta de Analista: os clientes da carteira são contas independentes (login próprio) e NÃO são apagados —
 * só deixam de estar ligados ao analista.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user: admin, error } = await requireAdmin();
  if (error) return error;
  const { id } = await params;

  const corpo = (await req.json().catch(() => null)) as { confirmarEmail?: unknown } | null;
  const alvo = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, company: { select: { id: true } }, _count: { select: { carteiraClientes: true } } },
  });
  if (!alvo) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const barrado = motivoParaNaoExcluir(alvo, { id: admin!.id, email: admin!.email }, emailsAdmin());
  if (barrado) return NextResponse.json({ error: barrado }, { status: 403 });
  if (!confirmacaoConfere(corpo?.confirmarEmail, alvo.email)) {
    return NextResponse.json({ error: "Digite o e-mail da conta para confirmar a exclusão." }, { status: 400 });
  }

  // Lista os arquivos ANTES de apagar o banco; se o Storage falhar aqui, nada foi apagado ainda.
  let arquivos: string[] = [];
  if (alvo.company && isStorageConfigured()) {
    try {
      arquivos = await listarArquivosDoPrefixo(alvo.company.id);
    } catch (err) {
      console.error(`Não foi possível listar os arquivos da empresa ${alvo.company.id} no Storage:`, err);
      return NextResponse.json({ error: "Não foi possível acessar os arquivos da conta no armazenamento. Nada foi apagado; tente de novo." }, { status: 502 });
    }
  }

  const editaisApagados = alvo.company ? await prisma.edital.count({ where: { companyId: alvo.company.id } }) : 0;
  await prisma.$transaction(async (tx) => {
    // Histórico de consumo de IA não tem ligação com a empresa no banco (de propósito): apaga à parte.
    if (alvo.company) await tx.consumoIA.deleteMany({ where: { companyId: alvo.company.id } });
    // O resto sai em cascata: empresa, editais e tudo deles, documentos, estudos, palavras-chave, vínculos de carteira.
    await tx.user.delete({ where: { id } });
  }, { timeout: 50_000, maxWait: 10_000 });

  // Com o banco já limpo, remove os arquivos; se algum falhar, o dado da conta já não existe mais.
  let arquivosApagados = 0;
  let avisoArquivos: string | null = null;
  try {
    arquivosApagados = await apagarArquivos(arquivos);
  } catch (err) {
    console.error(`Conta ${id} apagada, mas houve falha ao remover arquivos do Storage:`, err);
    avisoArquivos = "A conta foi apagada, mas alguns arquivos no armazenamento não puderam ser removidos.";
  }

  return NextResponse.json({ ok: true, editaisApagados, arquivosApagados, clientesDesvinculados: alvo._count.carteiraClientes, aviso: avisoArquivos });
}
