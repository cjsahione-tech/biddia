import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const id = "cmuvhj3cp00034se8a8g64t17";
const t0 = new Date(Date.now() - 3*60000);
for (let i = 0; i < 40; i++) {
  const runs = await prisma.agentRun.findMany({ where: { editalId: id, startedAt: { gt: t0 } }, orderBy: { startedAt: "asc" } });
  if (runs.some(r => r.agentKey === "agente6-auditor" && r.status !== "RUNNING")) {
    console.log("FIM", runs.map(r => r.agentKey.replace(/^agente\d-/, "") + ":" + r.status + "@" + r.startedAt.toISOString().slice(14,19)).join(" "));
    break;
  }
  await new Promise(r => setTimeout(r, 3000));
}
const logs = await prisma.auditLog.findMany({ where: { editalId: id, createdAt: { gt: t0 }, severidade: { not: "OK" } }, orderBy: { createdAt: "asc" } });
for (const l of logs) console.log(l.severidade, l.agente, "|", l.mensagem.slice(0, 110));
await prisma.$disconnect();
