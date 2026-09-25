// Seed inicial de Feature (catálogo granular de funções reais do produto) e Plan (3 planos
// Empresa + 1 plano Analista) — idempotente (upsert por chave/slug), seguro rodar mais de uma
// vez. Rodar com: node prisma/seed.mjs (usa a mesma DATABASE_URL do .env).
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const FEATURES = [
  { chave: "CAPTACAO_PNCP", label: "Captação automática — PNCP", categoria: "Captação", ordemExibicao: 1 },
  { chave: "CAPTACAO_LICITANET", label: "Captação automática — LicitaNet", categoria: "Captação", ordemExibicao: 2 },
  { chave: "CAPTACAO_COMPRASGOV", label: "Captação automática — Compras.gov.br", categoria: "Captação", ordemExibicao: 3 },
  { chave: "ANALISE_IA", label: "Aba Análise (Agente Analista)", categoria: "Agentes", ordemExibicao: 4 },
  { chave: "FINANCEIRO_BASICO", label: "Aba Financeiro — tabela de itens e desconto", categoria: "Agentes", ordemExibicao: 5 },
  { chave: "FINANCEIRO_LOTES_COLUNAS", label: "Financeiro — lotes, colunas variáveis e edição manual de preço", categoria: "Agentes", ordemExibicao: 6 },
  { chave: "FINANCEIRO_ANEXO_FINAL", label: "Financeiro — geração do anexo de proposta comercial (PDF/DOCX)", categoria: "Agentes", ordemExibicao: 7 },
  { chave: "ADVOGADO_ANEXOS", label: "Geração de anexos/declarações (Agente Advogado)", categoria: "Agentes", ordemExibicao: 8 },
  { chave: "SECRETARIO_CHECKLIST", label: "Aba Checklist (Agente Secretário)", categoria: "Agentes", ordemExibicao: 9 },
  { chave: "AUDITOR_REVISAO", label: "Aba Auditoria (Agente Auditor)", categoria: "Agentes", ordemExibicao: 10 },
  { chave: "AGENDA", label: "Aba Agenda", categoria: "Recursos", ordemExibicao: 11 },
  { chave: "RESULTADOS_DASHBOARD", label: "Aba Resultados", categoria: "Recursos", ordemExibicao: 12 },
  { chave: "ESTUDO_VIABILIDADE", label: "Aba Estudo de Viabilidade", categoria: "Recursos", ordemExibicao: 13 },
  { chave: "BIDD_IA_ASSISTENTE", label: "Aba Bidd.IA — assistente de conversa geral", categoria: "Recursos", ordemExibicao: 14 },
  { chave: "CARTEIRA_MULTI_EMPRESA", label: "Carteira de clientes (conta Analista)", categoria: "Carteira", ordemExibicao: 15 },
];

async function seedFeatures() {
  const porChave = {};
  for (const f of FEATURES) {
    const feature = await prisma.feature.upsert({
      where: { chave: f.chave },
      create: f,
      update: { label: f.label, categoria: f.categoria, ordemExibicao: f.ordemExibicao },
    });
    porChave[f.chave] = feature.id;
  }
  return porChave;
}

async function setPlanFeatures(planId, featureIds) {
  await prisma.planFeature.deleteMany({ where: { planId } });
  if (featureIds.length === 0) return;
  await prisma.planFeature.createMany({
    data: featureIds.map((featureId) => ({ planId, featureId })),
    skipDuplicates: true,
  });
}

async function main() {
  const featureIds = await seedFeatures();

  const essencial = await prisma.plan.upsert({
    where: { slug: "essencial" },
    create: {
      nome: "Essencial",
      slug: "essencial",
      publicoAlvo: "EMPRESA",
      precoMensal: 97,
      maxEditaisAtivos: 10,
      maxAnalisesPorMes: 15,
      maxEmpresas: 1,
      maxUsuarios: 1,
      ordemExibicao: 1,
    },
    update: {},
  });
  await setPlanFeatures(essencial.id, []);

  const profissional = await prisma.plan.upsert({
    where: { slug: "profissional" },
    create: {
      nome: "Profissional",
      slug: "profissional",
      publicoAlvo: "EMPRESA",
      precoMensal: 297,
      maxEditaisAtivos: 50,
      maxAnalisesPorMes: 80,
      maxEmpresas: 1,
      maxUsuarios: 3,
      ordemExibicao: 2,
    },
    update: {},
  });
  await setPlanFeatures(profissional.id, [
    featureIds.FINANCEIRO_LOTES_COLUNAS,
    featureIds.FINANCEIRO_ANEXO_FINAL,
    featureIds.CAPTACAO_COMPRASGOV,
  ]);

  const empresarial = await prisma.plan.upsert({
    where: { slug: "empresarial" },
    create: {
      nome: "Empresarial",
      slug: "empresarial",
      publicoAlvo: "EMPRESA",
      precoMensal: 697,
      maxEditaisAtivos: null,
      maxAnalisesPorMes: null,
      maxEmpresas: 10,
      maxUsuarios: null,
      ordemExibicao: 3,
    },
    update: {},
  });
  await setPlanFeatures(empresarial.id, [
    featureIds.FINANCEIRO_LOTES_COLUNAS,
    featureIds.FINANCEIRO_ANEXO_FINAL,
    featureIds.CAPTACAO_COMPRASGOV,
  ]);

  // Plano placeholder pra conta Analista — preço/limites ficam livres pra ajuste no admin.
  const analista = await prisma.plan.upsert({
    where: { slug: "analista" },
    create: {
      nome: "Analista",
      slug: "analista",
      publicoAlvo: "ANALISTA",
      precoMensal: 197,
      maxEmpresas: 5,
      ordemExibicao: 1,
    },
    update: {},
  });
  await setPlanFeatures(analista.id, [featureIds.CARTEIRA_MULTI_EMPRESA]);

  console.log("Seed concluído:", { essencial: essencial.id, profissional: profissional.id, empresarial: empresarial.id, analista: analista.id });
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
