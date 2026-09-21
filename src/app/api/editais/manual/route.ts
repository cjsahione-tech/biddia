import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCompany } from "@/lib/api-utils";
import { capturarEditalManual } from "@/lib/agents/agente1-comercial";
import { dispararPipeline } from "@/lib/agents/pipeline";

// Extração do texto/dados do PDF + chamada de IA para estruturar os campos do edital
// acontecem antes de responder; o restante do pipeline (Analista, Financeiro,
// Advogado, Secretário, Auditor) é que roda em segundo plano depois da resposta.
export const maxDuration = 60;

// Caminho novo (PDFs grandes, até 50MB): o arquivo já foi enviado direto pro Storage via
// URL assinada (ver upload-url/route.ts) — só chega o caminho onde ele ficou. Caminho
// antigo (arquivoBase64) mantido pra compatibilidade, mas o cliente atual sempre usa o
// caminho novo.
const schema = z
  .object({
    nomeArquivo: z.string().min(1).max(200),
    arquivoBase64: z.string().min(1).optional(),
    storagePath: z.string().min(1).optional(),
  })
  .refine((d) => !!d.arquivoBase64 || !!d.storagePath, { message: "Envie um arquivo PDF válido." });

export async function POST(req: Request) {
  const { company, error } = await requireCompany();
  if (error) return error;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Envie um arquivo PDF válido." }, { status: 400 });
  }
  if (parsed.data.arquivoBase64 && !parsed.data.arquivoBase64.startsWith("data:application/pdf")) {
    return NextResponse.json({ error: "O arquivo precisa ser um PDF." }, { status: 400 });
  }

  let edital;
  try {
    edital = await capturarEditalManual(company!.id, parsed.data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Não foi possível processar o PDF enviado.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // A captação manual já nasce aprovada (o usuário escolheu este edital ao enviá-lo),
  // então o pipeline completo dispara na hora, sem precisar de um clique extra.
  dispararPipeline(edital.id, req);

  return NextResponse.json({ edital });
}
