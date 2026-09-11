import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";

const schema = z.object({ ids: z.array(z.string().min(1)).min(1).max(200) });

/** Exclui vários editais de uma vez (seleção múltipla no quadro Kanban). O filtro por
 * companyId garante que só apaga o que é da própria empresa, mesmo que a lista de ids
 * venha adulterada. Cascata do schema cuida de análise/proposta/anexos/checklist/
 * histórico de cada um. */
export async function POST(req: Request) {
  const { company, error } = await requireCompany();
  if (error) return error;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Lista de editais inválida" }, { status: 400 });

  const result = await prisma.edital.deleteMany({
    where: { id: { in: parsed.data.ids }, companyId: company!.id },
  });

  return NextResponse.json({ excluidos: result.count });
}
