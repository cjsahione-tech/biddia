// Gera as capturas de tela reais usadas no preview em hover dos cards de agente na
// landing page (src/app/page.tsx, pasta public/agentes/). Rode de novo sempre que o
// layout dessas telas mudar ou for necessário trocar o edital de exemplo.
//
// Uso: node scripts/capture-agent-screens.mjs
// Pré-requisitos: servidor dev rodando em localhost:3000 (npm run dev) e o usuário/edital
// de exemplo abaixo já existirem na conta de TESTE (nunca aponte isto para dados reais de
// um usuário de produção).
import "dotenv/config";
import jwt from "jsonwebtoken";
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = "http://localhost:3000";
const USER_ID = "cmtnhg5p300004sm06liktut9"; // maria@empresateste.com.br — conta de teste
const EDITAL_ID = "cmtnjles5000v4stssj9etcpv"; // edital já processado pelo pipeline completo
const OUT_DIR = path.resolve("public/agentes");
const CROP = { x: 280, y: 0, width: 1000, height: 620 };

const TOKEN = jwt.sign({ userId: USER_ID }, process.env.JWT_SECRET, { expiresIn: "10m" });

fs.mkdirSync(OUT_DIR, { recursive: true });

async function shot(page, name, opts = {}) {
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file, clip: CROP, ...opts });
  console.log("saved", file);
}

async function clickTab(page, label) {
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.waitForTimeout(500);
}

const run = async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addCookies([
    { name: "licitax_session", value: TOKEN, url: BASE, httpOnly: true, sameSite: "Lax" },
  ]);
  const page = await context.newPage();

  // Agente Comercial — quadro Kanban com editais reais captados
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await shot(page, "comercial-1");
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(300);
  await shot(page, "comercial-2");

  // Detalhe do edital processado — todas as abas
  await page.goto(`${BASE}/editais/${EDITAL_ID}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  // Agente Analista
  await clickTab(page, "Análise");
  await shot(page, "analista-1");
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(300);
  await shot(page, "analista-2");
  await page.mouse.wheel(0, -400);

  // Agente Financeiro
  await clickTab(page, "Financeiro");
  await page.waitForTimeout(500);
  await shot(page, "financeiro-1");
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(300);
  await shot(page, "financeiro-2");
  await page.mouse.wheel(0, -400);

  // Agente Advogado
  await clickTab(page, "Documentos");
  await page.waitForTimeout(500);
  await shot(page, "advogado-1");
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(300);
  await shot(page, "advogado-2");
  await page.mouse.wheel(0, -300);

  // Agente Secretário
  await clickTab(page, "Checklist");
  await page.waitForTimeout(500);
  await shot(page, "secretario-1");
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(300);
  await shot(page, "secretario-2");
  await page.mouse.wheel(0, -300);

  // Agente Auditor
  await clickTab(page, "Auditoria");
  await page.waitForTimeout(500);
  await shot(page, "auditor-1");
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(300);
  await shot(page, "auditor-2");

  await browser.close();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
