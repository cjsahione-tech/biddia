# Bidd.IA

Plataforma de agentes de IA para participação em licitações públicas brasileiras.
Next.js 16 (App Router) + Prisma + PostgreSQL (Supabase), agentes construídos sobre a API do
PNCP (Portal Nacional de Contratações Públicas) e a API da Anthropic.

**Em produção:** https://www.bidd.ia.br (também https://licitax.vercel.app)

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
`JWT_SECRET` e `ANTHROPIC_API_KEY`. **Atenção:** o `.env` local costuma apontar para o banco de produção.

## Testes

```bash
npm test                 # todos os testes (inclui a regressão da auditoria)
npm run test:regressao   # só a regressão fixa da auditoria de habilitação (mostra a tabela esperado × obtido)
npx tsc --noEmit && npx eslint src
```

A cada envio de código o GitHub roda tipos, lint e todos os testes (`.github/workflows/testes.yml`).
A regressão da auditoria usa uma fotografia das auditorias já concluídas
(`src/lib/agents/regressao/fixtures.json`); para atualizá-la: `node scripts/gerar-fixtures-regressao.cjs`
(somente leitura do banco).

## Publicando

O projeto está ligado ao GitHub: **cada envio para a branch `master` publica em produção** na Vercel, e cada outra
branch gera uma **prévia** (endereço próprio, protegido por login da Vercel). Prévias usam o mesmo banco de produção.

Variáveis de ambiente (banco, JWT, chave de IA, Supabase, `CRON_SECRET`, `ADMIN_EMAILS`) ficam na Vercel.

## Banco de dados

Mudanças de estrutura são sempre **aditivas** (novas colunas, tabelas ou valores de lista) e aplicadas à mão, com o SQL
revisado antes. O `prisma/schema.prisma` é a referência; `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script`
mostra o que falta aplicar (use a conexão direta, porta 5432).

## Auditoria de habilitação — como ela não falha em silêncio

- Lê edital, termo de referência, anexo de preços e planilhas (**documentos principais**); anexos da empresa são **de apoio**.
- Documento escaneado: leitura por imagem em lotes de 10 páginas, teto de 60 páginas por edital ("Liberar leitura completa" amplia, com custo extra).
- Falha passageira: até 4 novas tentativas (1, 5, 15 min e 1 h). O progresso (pedaços do edital já lidos) é guardado e retomado.
- Só uma pessoa resolve (PDF com senha, edital apagado, login/captcha, escaneado ilegível, custo acima do teto): estado **Precisa de ação**, com mensagem e botões.
- Resultado "bom" com sinais de leitura incompleta: **Revisar manualmente** (nunca "Habilitada" sem base).
- Teto de custo: US$ 1,50 por edital (US$ 5,00 se liberado). Painel do admin: **Saúde das auditorias**.

### Vigia (agendador)

`/api/cron/vigia-auditorias` retoma auditorias paradas e corrige selos presos. A Vercel (plano gratuito) só permite um cron por
dia (`vercel.json`); para rodar a cada 5 minutos use `.github/workflows/vigia-auditorias.yml` criando, em
GitHub → Settings → Secrets → Actions, os segredos `APP_URL` e `CRON_SECRET` (o mesmo valor da Vercel).
