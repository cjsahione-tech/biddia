import { NextResponse, after } from "next/server";
import { requireCompany } from "@/lib/api-utils";
import { reavaliarEditaisDaEmpresa } from "@/lib/agents/auditoria-habilitacao";

// Chamada UMA vez no fim de um envio em lote de documentos: refaz a conferência dos editais abertos da
// empresa. (Enviar N arquivos disparando N conferências gastaria IA N vezes à toa.)
export const maxDuration = 60;

export async function POST(req: Request) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const origem = new URL(req.url).origin;
  after(async () => {
    await reavaliarEditaisDaEmpresa(company!.id, origem);
  });
  return NextResponse.json({ ok: true });
}
