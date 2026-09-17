import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";
import { apagarAnexo } from "@/lib/storage";

// Só vale pro caminho antigo (anexoBase64 no corpo da requisição) — arquivos grandes
// usam o fluxo de URL assinada (ver upload-url/route.ts), que não tem esse teto.
const TAMANHO_MAXIMO_ANEXO_BASE64 = 3.5 * 1024 * 1024;

const schema = z.object({
  status: z.enum(["FALTANTE", "ENVIADO", "VENCIDO", "OK"]).optional(),
  validade: z.string().optional().nullable(),
  observacao: z.string().optional().nullable(),
  anexoNome: z.string().trim().min(1).max(200).optional(),
  // Caminho pequeno (compatibilidade): arquivo inteiro em base64 no corpo.
  anexoBase64: z.string().min(1).optional(),
  // Caminho novo: arquivo já enviado direto pro Storage via URL assinada — só chega o
  // caminho onde ele ficou.
  anexoStoragePath: z.string().min(1).optional(),
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
  const anexoDocIdAnterior = item.anexoDocId;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

  let anexoDocId: string | null | undefined;
  let anexoNome: string | null | undefined;

  // Um item de checklist representa um único documento, não um histórico de versões —
  // sempre que um novo anexo substitui o anterior (ou é removido), limpa o registro (e,
  // se o anterior morava no Storage, o próprio arquivo) antes de seguir.
  async function substituirAnexoAnterior() {
    if (!anexoDocIdAnterior) return;
    const anterior = await prisma.document.findUnique({ where: { id: anexoDocIdAnterior } });
    await prisma.document.delete({ where: { id: anexoDocIdAnterior } }).catch(() => null);
    if (anterior?.storagePath) await apagarAnexo(anterior.storagePath).catch(() => null);
  }

  if (parsed.data.removerAnexo) {
    anexoDocId = null;
    anexoNome = null;
    await substituirAnexoAnterior();
  } else if (parsed.data.anexoStoragePath && parsed.data.anexoNome) {
    await substituirAnexoAnterior();
    const doc = await prisma.document.create({
      data: {
        editalId: id,
        nome: parsed.data.anexoNome,
        tipo: "DOCUMENTO_USUARIO",
        categoria: "CHECKLIST",
        status: "DISPONIVEL",
        storagePath: parsed.data.anexoStoragePath,
      },
      select: { id: true },
    });
    anexoDocId = doc.id;
    anexoNome = parsed.data.anexoNome;
  } else if (parsed.data.anexoBase64 && parsed.data.anexoNome) {
    const tamanhoBase64 = parsed.data.anexoBase64.length * 0.75;
    if (tamanhoBase64 > TAMANHO_MAXIMO_ANEXO_BASE64) {
      return NextResponse.json(
        { error: `Anexo muito grande para esse caminho. O limite é de ${(TAMANHO_MAXIMO_ANEXO_BASE64 / 1024 / 1024).toFixed(1)}MB.` },
        { status: 400 }
      );
    }

    await substituirAnexoAnterior();
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
