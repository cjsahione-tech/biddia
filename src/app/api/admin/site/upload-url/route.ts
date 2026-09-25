import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin";
import { caminhoSiteAsset, criarUrlUpload, criarUrlPublicaDeLongaDuracao, isStorageConfigured } from "@/lib/storage";

const TAMANHO_MAXIMO_IMAGEM = 5 * 1024 * 1024;

const schema = z.object({
  nomeArquivo: z.string().trim().min(1).max(200),
  tamanhoBytes: z.number().int().positive(),
});

/** Devolve a URL assinada de upload (pro navegador subir a imagem direto pro Storage) e
 * já também a URL de longa duração que vai pra SiteContent.heroImagemUrl depois do upload
 * concluído (ver AdminSiteClient.tsx: sobe o arquivo, depois salva essa 2ª URL no PATCH
 * /api/admin/site). */
export async function POST(req: Request) {
  const { error } = await requireAdmin();
  if (error) return error;

  if (!isStorageConfigured()) {
    return NextResponse.json({ error: "Upload indisponível no momento (armazenamento não configurado)." }, { status: 503 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

  if (parsed.data.tamanhoBytes > TAMANHO_MAXIMO_IMAGEM) {
    return NextResponse.json(
      { error: `Imagem muito grande. O limite é de ${(TAMANHO_MAXIMO_IMAGEM / 1024 / 1024).toFixed(0)}MB.` },
      { status: 400 }
    );
  }

  const path = caminhoSiteAsset(parsed.data.nomeArquivo);
  try {
    const { signedUrl, token } = await criarUrlUpload(path);
    const urlFinal = await criarUrlPublicaDeLongaDuracao(path);
    return NextResponse.json({ path, token, signedUrl, urlFinal });
  } catch (err) {
    console.error("Falha ao gerar URL de upload para asset da home:", err);
    return NextResponse.json({ error: "Não foi possível preparar o upload. Tente novamente." }, { status: 500 });
  }
}
