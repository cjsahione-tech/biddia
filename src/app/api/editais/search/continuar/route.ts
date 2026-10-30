import { after } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verificarCronSecret } from "@/lib/cron-auth";
import { executarEtapaDaCaptacao, type PedidoDeEtapa } from "@/lib/captacao";

// Próxima etapa de uma busca de editais (ver src/lib/captacao.ts). Só o próprio sistema chama esta rota (protegida pelo mesmo
// segredo dos agendamentos): ela responde 202 na hora e faz o trabalho em segundo plano, com os seus próprios 60s.
export const maxDuration = 60;

export async function POST(req: Request) {
  const naoAutorizado = verificarCronSecret(req);
  if (naoAutorizado) return naoAutorizado;

  const pedido = (await req.json().catch(() => null)) as PedidoDeEtapa | null;
  if (!pedido?.companyId || !pedido.runId || typeof pedido.etapa !== "number") {
    return NextResponse.json({ error: "Pedido inválido" }, { status: 400 });
  }

  // Só continua uma busca que ainda está em andamento (uma busca encerrada por tempo ou erro não volta sozinha).
  const run = await prisma.captacaoRun.findFirst({ where: { id: pedido.runId, companyId: pedido.companyId, status: "RUNNING" } });
  if (!run) return NextResponse.json({ ignorada: true }, { status: 202 });

  const origin = new URL(req.url).origin;
  after(() => executarEtapaDaCaptacao(pedido, origin));
  return NextResponse.json({ aceita: true, etapa: pedido.etapa }, { status: 202 });
}
