import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id } = await params;

  const edital = await prisma.edital.findFirst({
    where: { id, companyId: company!.id },
    include: {
      analysis: true,
      proposal: true,
      documents: { orderBy: { createdAt: "asc" } },
      checklistItems: { orderBy: { createdAt: "asc" } },
      auditLogs: { orderBy: { createdAt: "desc" } },
      agentRuns: { orderBy: { startedAt: "desc" } },
      _count: { select: { documents: true, checklistItems: true } },
    },
  });

  if (!edital) return NextResponse.json({ error: "Edital não encontrado" }, { status: 404 });

  // Abrir o card é o próprio evento de "visto" — marca uma vez só (não reescreve
  // visualizadoEm em toda reabertura) e conta como atividade do usuário.
  if (!edital.visualizado) {
    const agora = new Date();
    const atualizado = await prisma.edital.update({
      where: { id },
      data: { visualizado: true, visualizadoEm: agora, ultimaMovimentacao: agora },
    });
    return NextResponse.json({ edital: { ...edital, ...atualizado } });
  }

  return NextResponse.json({ edital });
}

// Paleta fixa de cores de card, estilo etiqueta do Trello — string livre no banco, mas
// restrita aqui para o card sempre exibir uma cor coerente com o resto da interface.
const CORES_CARD = ["azul", "verde", "amarelo", "laranja", "vermelho", "roxo", "rosa", "cinza"] as const;

const editSchema = z.object({
  titulo: z.string().trim().min(1).max(300).optional(),
  corCard: z.enum(CORES_CARD).nullable().optional(),
  notasInternas: z.string().max(5000).nullable().optional(),
});

/** Edição "de card" — campos organizacionais do quadro Kanban, editáveis livremente
 * pelo usuário. Não mexe nos campos factuais que vêm do PNCP/PDF ou dos agentes. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = editSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

  const edital = await prisma.edital.findFirst({ where: { id, companyId: company!.id } });
  if (!edital) return NextResponse.json({ error: "Edital não encontrado" }, { status: 404 });

  const updated = await prisma.edital.update({
    where: { id },
    data: { ...parsed.data, ultimaMovimentacao: new Date() },
  });
  return NextResponse.json({ edital: updated });
}

/** "Excluir" não apaga mais nada de verdade — move o card pra Rascunho marcando o
 * motivo, porque a análise/proposta já custaram chamadas de IA reais e o usuário precisa
 * poder recuperar (arrastando de volta) em vez de perder tudo. Se o card já estava em
 * Rascunho por inatividade, isso só atualiza o motivo, sem duplicar nada. Sem
 * confirmação aqui: a tela já exige uma confirmação explícita antes de chamar isto. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id } = await params;

  const edital = await prisma.edital.findFirst({ where: { id, companyId: company!.id } });
  if (!edital) return NextResponse.json({ error: "Edital não encontrado" }, { status: 404 });

  await prisma.edital.update({
    where: { id },
    data: { etapaKanban: "RASCUNHO", motivoMovimentacao: "EXCLUSAO_MANUAL", movidoEm: new Date() },
  });
  return NextResponse.json({ ok: true });
}
