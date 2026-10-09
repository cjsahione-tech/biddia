import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";
import { encerrarCaptacoesOrfas, iniciarCaptacao } from "@/lib/captacao";

// A busca roda em SEGUNDO PLANO (ver src/lib/captacao.ts): o POST responde na hora com o
// id da execução e a tela acompanha o progresso por GET (os cards aparecem no quadro à
// medida que são criados), em vez de ficar presa numa requisição longa que podia estourar
// o tempo e dar erro mesmo com parte dos editais já criada.
export const maxDuration = 60;

/** Última busca da empresa (ou a que está em andamento) — usado pela tela pra acompanhar. */
export async function GET() {
  const { company, error } = await requireCompany();
  if (error) return error;

  await encerrarCaptacoesOrfas(company!.id);
  const run = await prisma.captacaoRun.findFirst({
    where: { companyId: company!.id },
    orderBy: { startedAt: "desc" },
  });
  return NextResponse.json({ run });
}

/** Dispara o Agente Comercial em segundo plano. */
export async function POST(req: Request) {
  const { company, error } = await requireCompany();
  if (error) return error;

  const { run, jaEmAndamento } = await iniciarCaptacao(company!.id, new URL(req.url).origin);
  return NextResponse.json(jaEmAndamento ? { run, jaEmAndamento: true } : { run }, { status: 202 });
}
