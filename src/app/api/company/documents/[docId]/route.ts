import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";
import { apagarAnexo } from "@/lib/storage";

const CATEGORIAS = [
  "FISCAL_TRABALHISTA_ECONOMICO_FINANCEIRA_JURIDICA",
  "QUALIFICACAO_TECNICA_EMPRESA",
  "QUALIFICACAO_EQUIPE_TECNICA",
  "GARANTIA_CONTRATO",
] as const;
const FORMAS = ["COPIA_SIMPLES", "AUTENTICADO", "ASSINATURA_DIGITAL"] as const;

const schema = z.object({
  categoria: z.enum(CATEGORIAS).nullable().optional(),
  forma: z.enum(FORMAS).optional(),
  dataEmissao: z.string().optional().nullable(),
  validade: z.string().optional().nullable(),
  // Consumido depois que o navegador já enviou o arquivo direto pro Storage via URL
  // assinada (ver [docId]/upload-url/route.ts) — mesmo fluxo do checklist.
  storagePath: z.string().min(1).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ docId: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { docId } = await params;

  const documento = await prisma.companyDocument.findFirst({ where: { id: docId, companyId: company!.id } });
  if (!documento) return NextResponse.json({ error: "Documento não encontrado" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  const { categoria, forma, dataEmissao, validade, storagePath } = parsed.data;

  const atualizado = await prisma.companyDocument.update({
    where: { id: docId },
    data: {
      ...(categoria !== undefined ? { categoria } : {}),
      ...(forma !== undefined ? { forma } : {}),
      ...(dataEmissao !== undefined ? { dataEmissao: dataEmissao ? new Date(dataEmissao) : null } : {}),
      ...(validade !== undefined ? { validade: validade ? new Date(validade) : null } : {}),
      ...(storagePath !== undefined ? { storagePath } : {}),
    },
  });

  return NextResponse.json({ documento: atualizado });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ docId: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { docId } = await params;

  const documento = await prisma.companyDocument.findFirst({ where: { id: docId, companyId: company!.id } });
  if (!documento) return NextResponse.json({ error: "Documento não encontrado" }, { status: 404 });

  await prisma.companyDocument.delete({ where: { id: docId } });
  if (documento.storagePath) await apagarAnexo(documento.storagePath).catch(() => null);

  return NextResponse.json({ ok: true });
}
