import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";

const schema = z.object({
  status: z.enum(["FALTANTE", "ENVIADO", "VENCIDO", "OK"]).optional(),
  validade: z.string().optional().nullable(),
  observacao: z.string().optional().nullable(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id, itemId } = await params;

  const edital = await prisma.edital.findFirst({ where: { id, companyId: company!.id } });
  if (!edital) return NextResponse.json({ error: "Edital não encontrado" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

  const item = await prisma.checklistItem.update({
    where: { id: itemId },
    data: {
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
      ...(parsed.data.validade !== undefined
        ? { validade: parsed.data.validade ? new Date(parsed.data.validade) : null }
        : {}),
      ...(parsed.data.observacao !== undefined ? { observacao: parsed.data.observacao } : {}),
    },
  });

  return NextResponse.json({ item });
}
