# Licitax

Plataforma de agentes de IA para participação em licitações públicas brasileiras.
Next.js 16 (App Router) + Prisma + PostgreSQL, agentes construídos sobre a API do
PNCP (Portal Nacional de Contratações Públicas) e a API da Anthropic.

**Em produção:** https://licitax.vercel.app

## Agentes

1. **Comercial** — varre o PNCP com as palavras-chave da empresa, filtra por tipo de
   objeto (serviço/bem) e relevância (IA) antes de capturar qualquer edital.
2. **Analista** — lê o edital e resume objeto, obrigações, habilitação e riscos.
3. **Financeiro** — monta a proposta (itens/quantidades/valores) com base no valor de
   referência do PNCP; permite aplicar desconto e exportar planilha `.xlsx`.
4. **Advogado** — gera os anexos/declarações timbrados exigidos, em PDF.
5. **Secretário** — monta e acompanha o checklist de documentos de habilitação.
6. **Auditor** — audita cada etapa do pipeline e corrige o que falhar automaticamente.

## Rodando localmente

```bash
npm install
npx prisma generate
npm run dev
```

Requer um arquivo `.env` (veja `.env.example`) com `DATABASE_URL` (Postgres),
`JWT_SECRET` e `ANTHROPIC_API_KEY`.

## Publicando uma atualização

O deploy é feito direto (sem depender de repositório remoto):

```bash
VERCEL_TOKEN="seu-token-de-https://vercel.com/account/tokens" node scripts/deploy.js
```

Variáveis de ambiente do projeto (banco, JWT, chave de IA) já estão configuradas
na Vercel — só é preciso alterá-las lá se algum valor mudar.
