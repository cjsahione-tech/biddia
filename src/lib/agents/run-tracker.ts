import { prisma } from "@/lib/prisma";
import type { AuditSeverity } from "@prisma/client";

export async function withAgentRun<T>(
  editalId: string,
  agentKey: string,
  fn: () => Promise<T>
): Promise<T> {
  const run = await prisma.agentRun.create({
    data: { editalId, agentKey, status: "RUNNING" },
  });

  try {
    const result = await fn();
    await prisma.agentRun.update({
      where: { id: run.id },
      data: { status: "DONE", finishedAt: new Date() },
    });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    await prisma.agentRun.update({
      where: { id: run.id },
      data: { status: "ERROR", message, finishedAt: new Date() },
    });
    throw err;
  }
}

/**
 * Marca "última movimentação" agora — chamado a partir de AÇÕES DO USUÁRIO (abrir o
 * card, editar, mover no quadro, anexar documento, corrigir via chat), nunca de dentro
 * de uma execução automática de agente. Alimenta a expiração por inatividade de 48h da
 * coluna "Oportunidade" (verificada sob demanda em GET /api/editais) — se isso também
 * fosse tocado por execuções automáticas do pipeline, um card nunca expiraria mesmo sem
 * nenhuma atenção humana de verdade.
 */
export async function tocarEdital(editalId: string) {
  await prisma.edital.update({ where: { id: editalId }, data: { ultimaMovimentacao: new Date() } });
}

export async function logAudit(
  editalId: string,
  agente: string,
  etapa: string,
  severidade: AuditSeverity,
  mensagem: string,
  acaoTomada?: string
) {
  await prisma.auditLog.create({
    data: { editalId, agente, etapa, severidade, mensagem, acaoTomada },
  });
}
