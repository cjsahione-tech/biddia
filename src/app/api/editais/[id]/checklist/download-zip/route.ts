import { NextResponse } from "next/server";
import { requireCompany } from "@/lib/api-utils";
import { gerarChecklistZip } from "@/lib/checklist-zip";

export const maxDuration = 30;

/** Monta um .zip com todos os documentos já anexados ao checklist, organizados em uma
 * pasta por categoria de habilitação (Fiscal, Trabalhista, etc.) — itens sem categoria
 * reconhecida caem numa pasta "Outros" em vez de serem descartados. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id } = await params;

  const resultado = await gerarChecklistZip(id, company!.id);
  if ("erro" in resultado) {
    return NextResponse.json({ error: resultado.erro }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(resultado.buffer), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${resultado.nomeArquivo}"`,
    },
  });
}
