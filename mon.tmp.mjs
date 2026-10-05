import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const id = "cmuvhj3cp00034se8a8g64t17";
for (let i = 0; i < 40; i++) {
  const runs = await prisma.agentRun.findMany({ where: { editalId: id }, orderBy: { startedAt: "asc" } });
  const resumo = runs.map(r => r.agentKey.replace(/^agente\d-/, "") + ":" + r.status).join(" ");
  if (runs.some(r => r.agentKey === "agente6-auditor" && r.status !== "RUNNING")) { console.log("FIM", resumo); break; }
  if (i % 3 === 0) console.log("..", resumo);
  await new Promise(r => setTimeout(r, 5000));
}
await prisma.$disconnect();
