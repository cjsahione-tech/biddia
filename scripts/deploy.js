// Publica o projeto atual na Vercel (deploy direto, sem depender do GitHub).
// Uso: VERCEL_TOKEN="..." node scripts/deploy.js
//
// O token é lido apenas da variável de ambiente — nunca fica salvo em arquivo.
// Gere um token em https://vercel.com/account/tokens

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const TOKEN = process.env.VERCEL_TOKEN;
if (!TOKEN) {
  console.error("Defina VERCEL_TOKEN antes de rodar este script.");
  process.exit(1);
}

const ROOT = path.join(__dirname, "..");
const files = execSync("git ls-files", { cwd: ROOT, encoding: "utf-8" })
  .split("\n")
  .map((f) => f.trim())
  .filter(Boolean);

console.log(`Preparando ${files.length} arquivos...`);

const payloadFiles = files.map((f) => {
  const buf = fs.readFileSync(path.join(ROOT, f));
  return { file: f.replace(/\\/g, "/"), data: buf.toString("base64"), encoding: "base64" };
});

async function main() {
  const res = await fetch("https://api.vercel.com/v13/deployments", {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "licitax",
      target: "production",
      files: payloadFiles,
      projectSettings: { framework: "nextjs" },
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    console.error("Falha no deploy:", res.status, JSON.stringify(data, null, 1));
    process.exit(1);
  }
  console.log("Deploy iniciado:", data.id);
  console.log("Acompanhe em: https://vercel.com/dashboard");
  console.log("URL final: https://licitax.vercel.app (assim que o build terminar)");
}

main();
