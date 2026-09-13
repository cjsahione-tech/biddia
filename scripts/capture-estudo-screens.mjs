// Gera as capturas de tela reais usadas na seção "Estudo de Viabilidade" da landing page
// (src/app/page.tsx, pasta public/estudo-viabilidade/). Cria dois estudos de teste (um
// por ramo), conduz cada um pelas etapas via API, captura a tela de resultado e depois
// APAGA os dois estudos criados (por ID exato, nunca por companyId em lote).
//
// Uso: node scripts/capture-estudo-screens.mjs
// Pré-requisitos: servidor dev rodando em localhost:3000 (npm run dev). Roda só contra a
// conta de TESTE (nunca aponte isto para dados reais de um usuário de produção).
import "dotenv/config";
import jwt from "jsonwebtoken";
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = "http://localhost:3000";
const USER_ID = "cmtnhg5p300004sm06liktut9"; // maria@empresateste.com.br — conta de teste
const TEST_COMPANY_ID = "cmtnhj80c00024sm0tgnfxdub"; // nunca apagar nada fora deste id
const EDITAL_SERVICO = "cmtnjles5000v4stssj9etcpv"; // Ônibus de turismo — CONDERLAGOS
const EDITAL_PRODUTO = "cmtnjldyg00054stsd1s9n8md"; // Veículos — CAU (R$ 337.454,50)
const OUT_DIR = path.resolve("public/estudo-viabilidade");
const CROP = { x: 280, y: 0, width: 1000, height: 620 };

const TOKEN = jwt.sign({ userId: USER_ID }, process.env.JWT_SECRET, { expiresIn: "15m" });
const HEADERS = { "Content-Type": "application/json", Cookie: `licitax_session=${TOKEN}` };

fs.mkdirSync(OUT_DIR, { recursive: true });

async function api(method, url, body) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: HEADERS,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

async function montarEstudoServico() {
  const { estudo } = await api("POST", "/api/estudos", { ramo: "SERVICO" });
  await api("PATCH", `/api/estudos/${estudo.id}`, { editalId: EDITAL_SERVICO });
  const req = await api("POST", `/api/estudos/${estudo.id}/requisitos`);
  await api("PATCH", `/api/estudos/${estudo.id}/requisitos`, JSON.parse(req.estudo.requisitosJson));
  await api("PATCH", `/api/estudos/${estudo.id}/tributos`, { regimeTributario: "LUCRO_PRESUMIDO" });
  const custos = await api("GET", `/api/estudos/${estudo.id}/custos`);
  const cargos = custos.cargos.length
    ? custos.cargos
        .slice(0, 1)
        .map((c) => ({ ...c, quantidade: 1, salarioBase: 2000, percentualEncargos: 40, beneficiosValor: 200 }))
    : [{ nome: "Motorista habilitado", quantidade: 1, salarioBase: 2000, percentualEncargos: 40, beneficiosValor: 200, origemEdital: false }];
  await api("PATCH", `/api/estudos/${estudo.id}/custos`, {
    descontoPercentual: 10,
    duracaoContratoMeses: 12,
    cargos,
    custosOperacionais: [{ nome: "Combustível e manutenção", quantidade: null, valorUnitario: null, valorMensal: 500 }],
    confirmar: true,
  });
  await api("POST", `/api/estudos/${estudo.id}/calculo`, { margemMinimaAceitavel: 10 });
  return estudo.id;
}

async function montarEstudoProduto() {
  const { estudo } = await api("POST", "/api/estudos", { ramo: "PRODUTO" });
  await api("PATCH", `/api/estudos/${estudo.id}`, { editalId: EDITAL_PRODUTO });
  const req = await api("POST", `/api/estudos/${estudo.id}/requisitos`);
  await api("PATCH", `/api/estudos/${estudo.id}/requisitos`, JSON.parse(req.estudo.requisitosJson));
  await api("PATCH", `/api/estudos/${estudo.id}/tributos`, { regimeTributario: "LUCRO_PRESUMIDO" });
  const custos = await api("GET", `/api/estudos/${estudo.id}/custos`);
  const itens = custos.itens.map((_, i) => ({
    itemIndex: i,
    custos: {
      custoAquisicaoUnitario: 75000,
      freteLogistica: 1500,
      icmsStDifal: 2000,
      despesasComerciaisAdmin: 6,
      margemLucroDesejada: 12,
    },
  }));
  await api("PATCH", `/api/estudos/${estudo.id}/custos`, { itens, confirmar: true });
  await api("POST", `/api/estudos/${estudo.id}/calculo`, { margemMinimaAceitavel: 10 });
  return estudo.id;
}

async function shot(page, name, opts = {}) {
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file, clip: CROP, ...opts });
  console.log("saved", file);
}

async function capturarResultado(page, estudoId, prefixo) {
  await page.goto(`${BASE}/estudo-viabilidade/${estudoId}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.scrollBy(0, 900));
  await page.waitForTimeout(400);
  await shot(page, `${prefixo}-1`);
  await page.evaluate(() => window.scrollBy(0, 550));
  await page.waitForTimeout(300);
  await shot(page, `${prefixo}-2`);
}

async function apagarEstudo(estudoId) {
  const est = await api("GET", `/api/estudos/${estudoId}`);
  if (est.estudo.companyId !== TEST_COMPANY_ID) {
    throw new Error(`RECUSANDO apagar ${estudoId}: companyId ${est.estudo.companyId} != conta de teste`);
  }
  await api("DELETE", `/api/estudos/${estudoId}`);
  console.log("apagado (conta de teste, id exato):", estudoId);
}

const run = async () => {
  console.log("Montando estudo Serviço...");
  const idServico = await montarEstudoServico();
  console.log("Montando estudo Produto...");
  const idProduto = await montarEstudoProduto();

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies([
    { name: "licitax_session", value: TOKEN, url: BASE, httpOnly: true, sameSite: "Lax" },
  ]);
  const page = await context.newPage();

  await capturarResultado(page, idServico, "servico");
  await capturarResultado(page, idProduto, "produto");

  await browser.close();

  await apagarEstudo(idServico);
  await apagarEstudo(idProduto);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
