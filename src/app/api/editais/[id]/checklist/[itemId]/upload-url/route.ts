import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";
import { caminhoAnexo, criarUrlUpload, isStorageConfigured } from "@/lib/storage";

// Teto real de anexo — bem maior que o antigo limite de corpo de requisição, porque o
// arquivo agora vai direto do navegador pro Supabase Storage via URL assinada, nunca
// passando pelo corpo desta função serverless. 25MB cobre contrato social escaneado,
// alvará de vigilância sanitária etc. com folga.
const TAMANHO_MAXIMO_ANEXO = 25 * 1024 * 1024;

const schema = z.object({
  nomeArquivo: z.string().trim().min(1).max(200),
  tamanhoBytes: z.number().int().positive(),
});

/** Devolve uma URL assinada pra o navegador enviar o anexo DIRETO pro Storage — só
 * gera a URL depois de confirmar que o item de checklist é mesmo da empresa logada. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id, itemId } = await params;

  if (!isStorageConfigured()) {
    return NextResponse.json(
      { error: "Upload de anexo indisponível no momento (armazenamento não configurado)." },
      { status: 503 }
    );
  }

  const edital = await prisma.edital.findFirst({ where: { id, companyId: company!.id } });
  if (!edital) return NextResponse.json({ error: "Edital não encontrado" }, { status: 404 });

  const item = await prisma.checklistItem.findFirst({ where: { id: itemId, editalId: id } });
  if (!item) return NextResponse.json({ error: "Item não encontrado" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

  if (parsed.data.tamanhoBytes > TAMANHO_MAXIMO_ANEXO) {
    return NextResponse.json(
      { error: `Anexo muito grande. O limite é de ${(TAMANHO_MAXIMO_ANEXO / 1024 / 1024).toFixed(0)}MB.` },
      { status: 400 }
    );
  }

  const path = caminhoAnexo(company!.id, id, itemId, parsed.data.nomeArquivo);
  try {
    const { signedUrl, token } = await criarUrlUpload(path);
    return NextResponse.json({ path, token, signedUrl });
  } catch (err) {
    console.error("Falha ao gerar URL de upload:", err);
    return NextResponse.json({ error: "Não foi possível preparar o upload. Tente novamente." }, { status: 500 });
  }
}
