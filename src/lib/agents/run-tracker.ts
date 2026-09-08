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
