// Gera src/lib/agents/regressao/fixtures.json a partir das auditorias JÁ concluídas no banco (SOMENTE LEITURA).
// Guarda só o que a regressão precisa (categoria/situação/certeza das exigências e a situação de leitura dos documentos):
// nada de dados da empresa. Uso: node scripts/gerar-fixtures-regressao.cjs
const fs = require("fs");
const path = require("path");
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
process.env.DATABASE_URL = env.match(/^DATABASE_URL="?([^"\r\n]+)"?/m)[1];
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

(async () => {
  const auds = await prisma.auditoriaHabilitacao.findMany({
    where: { estado: "CONCLUIDA" },
    orderBy: { iniciadaEm: "asc" },
    select: { editalId: true, leituraCompleta: true, documentosLidos: true, edital: { select: { titulo: true, habilitacaoStatus: true, habilitacaoPercentual: true } } },
  });
  const casos = [];
  for (const [i, a] of auds.entries()) {
    const ex = await prisma.exigenciaHabilitacao.findMany({ where: { editalId: a.editalId }, orderBy: { ordem: "asc" }, select: { categoria: true, situacao: true, certezaMapeamento: true } });
    let docs = [];
    try { docs = JSON.parse(a.documentosLidos || "[]"); } catch {}
    casos.push({
      chave: `E${String(i + 1).padStart(2, "0")}`,
      editalId: a.editalId,
      titulo: a.edital.titulo.slice(0, 60),
      statusGravado: a.edital.habilitacaoStatus,
      percentualGravado: a.edital.habilitacaoPercentual,
      leituraCompleta: a.leituraCompleta,
      documentos: docs.map((d) => ({ nome: d.nome, caracteres: d.caracteres, ok: d.ok, motivo: d.motivo ?? null })),
      exigencias: ex.map((e) => ({ categoria: e.categoria, situacao: e.situacao, certeza: e.certezaMapeamento })),
    });
  }
  const destino = path.join(__dirname, "..", "src", "lib", "agents", "regressao", "fixtures.json");
  fs.writeFileSync(destino, JSON.stringify({ geradoEm: new Date().toISOString().slice(0, 10), casos }, null, 1));
  console.log(`${casos.length} auditorias concluídas gravadas em ${path.relative(process.cwd(), destino)}`);
  await prisma.$disconnect();
})().catch((e) => { console.error(String(e.message).slice(0, 200)); process.exit(1); });
