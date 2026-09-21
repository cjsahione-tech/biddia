import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";
import { caminhoDocumentoEmpresa, criarUrlUpload, isStorageConfigured } from "@/lib/storage";

// Mesmo teto do upload grande do checklist — o arquivo vai direto do navegador pro
// Supabase Storage via URL assinada, nunca passando pelo corpo desta função serverless.
const TAMANHO_MAXIMO_ANEXO = 25 * 1024 * 1024;

const schema = z.object({
  nomeArquivo: z.string().trim().min(1).max(200),
  tamanhoBytes: z.number().int().positive(),
});

export async function POST(req: Request, { params }: { params: Promise<{ docId: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { docId } = await params;

  if (!isStorageConfigured()) {
    return NextResponse.json(
      { error: "Upload de anexo indisponível no momento (armazenamento não configurado)." },
      { status: 503 }
    );
  }

  const documento = await prisma.companyDocument.findFirst({ where: { id: docId, companyId: company!.id } });
  if (!documento) return NextResponse.json({ error: "Documento não encontrado" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

  if (parsed.data.tamanhoBytes > TAMANHO_MAXIMO_ANEXO) {
    return NextResponse.json(
      { error: `Anexo muito grande. O limite é de ${(TAMANHO_MAXIMO_ANEXO / 1024 / 1024).toFixed(0)}MB.` },
      { status: 400 }
    );
  }

  const path = caminhoDocumentoEmpresa(company!.id, docId, parsed.data.nomeArquivo);
  try {
    const { signedUrl, token } = await criarUrlUpload(path);
    return NextResponse.json({ path, token, signedUrl });
  } catch (err) {
    console.error("Falha ao gerar URL de upload para o dossiê:", err);
    return NextResponse.json({ error: "Não foi possível preparar o upload. Tente novamente." }, { status: 500 });
  }
}
