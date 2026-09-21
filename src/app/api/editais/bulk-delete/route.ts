import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";

const schema = z.object({ ids: z.array(z.string().min(1)).min(1).max(200) });

/** Exclui vários editais de uma vez (seleção múltipla no quadro Kanban) — igual à
 * exclusão individual (ver editais/[id]/route.ts DELETE), move todos pra Rascunho em vez
 * de apagar de verdade. O filtro por companyId garante que só afeta o que é da própria
 * empresa, mesmo que a lista de ids venha adulterada. */
export async function POST(req: Request) {
  const { company, error } = await requireCompany();
  if (error) return error;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Lista de editais inválida" }, { status: 400 });

  const result = await prisma.edital.updateMany({
    where: { id: { in: parsed.data.ids }, companyId: company!.id },
    data: { etapaKanban: "RASCUNHO", motivoMovimentacao: "EXCLUSAO_MANUAL", movidoEm: new Date() },
  });

  return NextResponse.json({ excluidos: result.count });
}
