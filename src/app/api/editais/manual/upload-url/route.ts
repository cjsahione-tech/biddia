import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCompany } from "@/lib/api-utils";
import { caminhoEditalManual, criarUrlUpload, isStorageConfigured } from "@/lib/storage";

// Teto de PDF na captação manual — cobre editais publicados como um único arquivo
// consolidado (edital + Termo de Referência + anexos). O arquivo vai direto do
// navegador pro Supabase Storage via URL assinada, nunca passando pelo corpo desta
// função serverless (que tem um teto físico de ~4,5MB na Vercel).
const TAMANHO_MAXIMO_ANEXO = 50 * 1024 * 1024;

const schema = z.object({
  nomeArquivo: z.string().trim().min(1).max(200),
  tamanhoBytes: z.number().int().positive(),
});

/** Devolve uma URL assinada pra subir o PDF antes mesmo de o edital existir — usa um id
 * de sessão avulso (não há editalId nesse momento) só pra dar um caminho único no
 * Storage; o registro do edital é criado depois, em POST /api/editais/manual, a partir
 * do `storagePath` devolvido aqui. */
export async function POST(req: Request) {
  const { company, error } = await requireCompany();
  if (error) return error;

  if (!isStorageConfigured()) {
    return NextResponse.json(
      { error: "Upload de PDF indisponível no momento (armazenamento não configurado)." },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

  if (parsed.data.tamanhoBytes > TAMANHO_MAXIMO_ANEXO) {
    return NextResponse.json(
      { error: `PDF muito grande. O limite é de ${(TAMANHO_MAXIMO_ANEXO / 1024 / 1024).toFixed(0)}MB.` },
      { status: 400 }
    );
  }

  const path = caminhoEditalManual(company!.id, randomUUID(), parsed.data.nomeArquivo);
  try {
    const { signedUrl, token } = await criarUrlUpload(path);
    return NextResponse.json({ path, token, signedUrl });
  } catch (err) {
    console.error("Falha ao gerar URL de upload para captação manual:", err);
    return NextResponse.json({ error: "Não foi possível preparar o upload. Tente novamente." }, { status: 500 });
  }
}
