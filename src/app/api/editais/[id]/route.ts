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

  const updated = await prisma.edital.update({ where: { id }, data: parsed.data });
  return NextResponse.json({ edital: updated });
}
