import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";

// Mesmo teto prático usado nos outros uploads da plataforma.
const TAMANHO_MAXIMO_ANEXO = 3.5 * 1024 * 1024;

const schema = z.object({
  status: z.enum(["FALTANTE", "ENVIADO", "VENCIDO", "OK"]).optional(),
  validade: z.string().optional().nullable(),
  observacao: z.string().optional().nullable(),
  anexoNome: z.string().trim().min(1).max(200).optional(),
  anexoBase64: z.string().min(1).optional(),
  removerAnexo: z.boolean().optional(),
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

  const item = await prisma.checklistItem.findFirst({ where: { id: itemId, editalId: id } });
  if (!item) return NextResponse.json({ error: "Item não encontrado" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

  let anexoDocId: string | null | undefined;
  let anexoNome: string | null | undefined;

  if (parsed.data.removerAnexo) {
    anexoDocId = null;
    anexoNome = null;
    if (item.anexoDocId) {
      await prisma.document.delete({ where: { id: item.anexoDocId } }).catch(() => null);
    }
  } else if (parsed.data.anexoBase64 && parsed.data.anexoNome) {
    const tamanhoBase64 = parsed.data.anexoBase64.length * 0.75;
    if (tamanhoBase64 > TAMANHO_MAXIMO_ANEXO) {
      return NextResponse.json(
        { error: `Anexo muito grande. O limite é de ${(TAMANHO_MAXIMO_ANEXO / 1024 / 1024).toFixed(1)}MB.` },
        { status: 400 }
      );
    }

    // Substitui o anexo anterior deste item, se houver — um item de checklist representa
    // um único documento, não um histórico de versões.
    if (item.anexoDocId) {
      await prisma.document.delete({ where: { id: item.anexoDocId } }).catch(() => null);
    }

    const doc = await prisma.document.create({
      data: {
        editalId: id,
        nome: parsed.data.anexoNome,
        tipo: "DOCUMENTO_USUARIO",
        categoria: "CHECKLIST",
        status: "DISPONIVEL",
        conteudoBase64: parsed.data.anexoBase64,
      },
      select: { id: true },
    });
    anexoDocId = doc.id;
    anexoNome = parsed.data.anexoNome;
  }

  const updated = await prisma.checklistItem.update({
    where: { id: itemId },
    data: {
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
      ...(parsed.data.validade !== undefined
        ? { validade: parsed.data.validade ? new Date(parsed.data.validade) : null }
        : {}),
      ...(parsed.data.observacao !== undefined ? { observacao: parsed.data.observacao } : {}),
      ...(anexoDocId !== undefined ? { anexoDocId } : {}),
      ...(anexoNome !== undefined ? { anexoNome } : {}),
    },
  });

  return NextResponse.json({ item: updated });
}
