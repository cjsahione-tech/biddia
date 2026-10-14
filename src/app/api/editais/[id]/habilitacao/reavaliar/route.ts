import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";
import { reavaliarEditaisDaEmpresa } from "@/lib/agents/auditoria-habilitacao";

// Chamada pela aba Habilitação depois que o analista anexa um documento a uma pendência: refaz a
// conferência DESTE edital agora, mesmo que a sessão já tenha passado (a reavaliação automática
// geral só cuida de editais abertos). Espera terminar para a aba já recarregar com o resultado.
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id } = await params;

  const edital = await prisma.edital.findFirst({ where: { id, companyId: company!.id }, select: { id: true } });
  if (!edital) return NextResponse.json({ error: "Edital não encontrado" }, { status: 404 });

  await reavaliarEditaisDaEmpresa(company!.id, new URL(req.url).origin, { editalId: id });
  return NextResponse.json({ ok: true });
}
