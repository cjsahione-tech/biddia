import type { ChecklistStatus, HabilitacaoCategoria } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { askJSON, MODELO_HAIKU } from "@/lib/anthropic";
import { withAgentRun, logAudit } from "@/lib/agents/run-tracker";

// Documentos de habilitação recorrentes em licitações públicas brasileiras (Lei 14.133/2021).
const CHECKLIST_BASE = [
  "Contrato Social / Estatuto consolidado",
  "Cartão CNPJ atualizado",
  "Certidão Negativa de Débitos Federais (Receita Federal/PGFN)",
  "Certidão Negativa de Débitos Estaduais",
  "Certidão Negativa de Débitos Municipais",
  "Certificado de Regularidade do FGTS (CRF)",
  "Certidão Negativa de Débitos Trabalhistas (CNDT)",
  "Balanço patrimonial / atestado de capacidade financeira",
  "Atestado(s) de Capacidade Técnica",
];

// Categoria fixa dos itens padrão acima — são os mesmos em toda licitação, não dependem
// do texto do edital, então não precisam passar pela IA de classificação.
const CATEGORIA_BASE: Record<string, HabilitacaoCategoria> = {
  "Contrato Social / Estatuto consolidado": "FISCAL_TRABALHISTA_ECONOMICO_FINANCEIRA_JURIDICA",
  "Cartão CNPJ atualizado": "FISCAL_TRABALHISTA_ECONOMICO_FINANCEIRA_JURIDICA",
  "Certidão Negativa de Débitos Federais (Receita Federal/PGFN)": "FISCAL_TRABALHISTA_ECONOMICO_FINANCEIRA_JURIDICA",
  "Certidão Negativa de Débitos Estaduais": "FISCAL_TRABALHISTA_ECONOMICO_FINANCEIRA_JURIDICA",
  "Certidão Negativa de Débitos Municipais": "FISCAL_TRABALHISTA_ECONOMICO_FINANCEIRA_JURIDICA",
  "Certificado de Regularidade do FGTS (CRF)": "FISCAL_TRABALHISTA_ECONOMICO_FINANCEIRA_JURIDICA",
  "Certidão Negativa de Débitos Trabalhistas (CNDT)": "FISCAL_TRABALHISTA_ECONOMICO_FINANCEIRA_JURIDICA",
  "Balanço patrimonial / atestado de capacidade financeira": "FISCAL_TRABALHISTA_ECONOMICO_FINANCEIRA_JURIDICA",
  "Atestado(s) de Capacidade Técnica": "QUALIFICACAO_TECNICA_EMPRESA",
};

/** Mapeia os CABEÇALHOS DE SEÇÃO que o próprio edital usa (ex: "Regularidade Fiscal,
 * Trabalhista, Econômico-Financeira e Jurídica", "Qualificação Técnica da Empresa") para
 * uma das 4 categorias fixas — bem mais barato e mais fiel do que classificar item por
 * item, porque respeita o agrupamento que o edital já fez em vez de reinventar um. Só
 * chega aqui quando o Agente Analista conseguiu identificar cabeçalhos de verdade. */
async function classificarCabecalhos(cabecalhos: string[]): Promise<Map<string, HabilitacaoCategoria>> {
  const mapa = new Map<string, HabilitacaoCategoria>();
  if (cabecalhos.length === 0) return mapa;

  const result = await askJSON<{
    classificacoes: { cabecalho: string; categoria: HabilitacaoCategoria | null }[];
  }>(
    `Classifique cada cabeçalho de seção de habilitação/qualificação de um edital de licitação pública brasileira
(Lei 14.133/2021) em UMA destas categorias:
- FISCAL_TRABALHISTA_ECONOMICO_FINANCEIRA_JURIDICA: regularidade fiscal (Receita Federal/Estadual/Municipal),
  trabalhista (FGTS, CNDT), econômico-financeira (balanço, índices) e/ou jurídica (contrato social, capacidade
  jurídica) — no edital, essas costumam vir todas juntas numa seção só; se o cabeçalho cobrir qualquer combinação
  delas, use esta categoria.
- QUALIFICACAO_TECNICA_EMPRESA: capacidade técnica/operacional da EMPRESA (atestados, registro em conselho de
  classe, licenças sanitárias/ambientais, estrutura, equipamentos)
- QUALIFICACAO_EQUIPE_TECNICA: qualificação dos PROFISSIONAIS/responsáveis técnicos nomeados pela empresa
- GARANTIA_CONTRATO: garantia de proposta ou garantia contratual

Responda "categoria": null só se o cabeçalho genuinamente não se encaixar em nenhuma (raro).

Responda em JSON:
{ "classificacoes": [ { "cabecalho": string (exatamente como veio na lista), "categoria": "FISCAL_TRABALHISTA_ECONOMICO_FINANCEIRA_JURIDICA" | "QUALIFICACAO_TECNICA_EMPRESA" | "QUALIFICACAO_EQUIPE_TECNICA" | "GARANTIA_CONTRATO" | null } ] }`,
    cabecalhos.map((c, i) => `${i + 1}. ${c}`).join("\n"),
    { model: MODELO_HAIKU, maxTokens: 1500 }
  );

  for (const c of result.classificacoes ?? []) {
    if (c.categoria) mapa.set(c.cabecalho, c.categoria);
  }
  return mapa;
}

/** Fallback para quando o Agente Analista não conseguiu identificar cabeçalhos de seção
 * claros (edital sem estrutura numerada, ou análise antiga anterior a essa mudança) —
 * classifica item por item, sem o contexto do agrupamento original do edital. */
async function classificarItensSemCabecalho(itens: string[]): Promise<Map<string, HabilitacaoCategoria>> {
  const mapa = new Map<string, HabilitacaoCategoria>();
  if (itens.length === 0) return mapa;

  const result = await askJSON<{
    classificacoes: { item: string; categoria: HabilitacaoCategoria | null }[];
  }>(
    `Classifique cada exigência de habilitação de uma licitação pública brasileira (Lei 14.133/2021) em UMA
destas categorias:
- FISCAL_TRABALHISTA_ECONOMICO_FINANCEIRA_JURIDICA: regularidade com Receita Federal/Estadual/Municipal, FGTS,
  débitos trabalhistas (CNDT), balanço patrimonial, índices contábeis, capital social, contrato social,
  regularidade jurídica da empresa
- QUALIFICACAO_TECNICA_EMPRESA: atestado de capacidade técnica da empresa, registro em conselho/entidade
  profissional, licenças (sanitária/ambiental), comprovação de aptidão do licitante
- QUALIFICACAO_EQUIPE_TECNICA: responsável técnico, registro profissional de membro da equipe,
  currículo/experiência de profissional nomeado
- GARANTIA_CONTRATO: garantia de proposta, garantia contratual, seguro-garantia, caução

Se um item não se encaixar claramente em nenhuma categoria, responda "categoria": null — não force uma categoria
errada só para preencher.

Responda em JSON:
{ "classificacoes": [ { "item": string (exatamente como veio na lista), "categoria": "FISCAL_TRABALHISTA_ECONOMICO_FINANCEIRA_JURIDICA" | "QUALIFICACAO_TECNICA_EMPRESA" | "QUALIFICACAO_EQUIPE_TECNICA" | "GARANTIA_CONTRATO" | null } ] }`,
    itens.map((item, i) => `${i + 1}. ${item}`).join("\n"),
    { model: MODELO_HAIKU, maxTokens: 2000 }
  );

  for (const c of result.classificacoes ?? []) {
    if (c.categoria) mapa.set(c.item, c.categoria);
  }
  return mapa;
}

export async function executarAgente5(editalId: string) {
  return withAgentRun(editalId, "agente5-secretario", async () => {
    const edital = await prisma.edital.findUniqueOrThrow({
      where: { id: editalId },
      include: { analysis: true, documents: true, checklistItems: true },
    });

    const existentes = new Set(edital.checklistItems.map((c) => c.documentoNome));

    // Formato novo: grupos {categoriaEdital, itens} que espelham a própria estrutura de
    // seções do edital (ver GrupoHabilitacao no Agente Analista). Análises antigas (de
    // antes dessa mudança) ainda têm o formato velho, uma lista plana de strings — nesse
    // caso trata como um grupo sem cabeçalho, que cai no classificador item a item.
    let grupos: { categoriaEdital: string | null; itens: string[] }[] = [];
    if (edital.analysis?.habilitacao) {
      try {
        const parsed = JSON.parse(edital.analysis.habilitacao) as unknown;
        if (Array.isArray(parsed) && parsed.every((g) => g && typeof g === "object" && "itens" in g)) {
          grupos = parsed as { categoriaEdital: string | null; itens: string[] }[];
        } else if (Array.isArray(parsed)) {
          grupos = [{ categoriaEdital: null, itens: parsed as string[] }];
        }
      } catch {
        grupos = [];
      }
    }

    const habilitacaoEdital = grupos.flatMap((g) => g.itens);
    const todosItens = Array.from(new Set([...CHECKLIST_BASE, ...habilitacaoEdital]));

    // Só classifica com IA os itens específicos do edital que ainda vão ser criados —
    // os padrão já têm categoria fixa (CATEGORIA_BASE) e itens que já existem não
    // precisam ser reclassificados a cada execução.
    const novoNoEdital = (nome: string) => !existentes.has(nome) && !CHECKLIST_BASE.includes(nome);

    // Cabeçalhos de verdade (o edital já organizou os itens por seção) — classifica os
    // POUCOS cabeçalhos distintos, não cada item, e aplica a mesma categoria a todo item
    // daquele grupo, respeitando o agrupamento original do edital.
    const cabecalhosComNovoItem = Array.from(
      new Set(grupos.filter((g) => g.categoriaEdital && g.itens.some(novoNoEdital)).map((g) => g.categoriaEdital!))
    );
    const categoriaPorCabecalho = await classificarCabecalhos(cabecalhosComNovoItem);

    const categoriaPorItem = new Map<string, HabilitacaoCategoria>();
    for (const g of grupos) {
      if (!g.categoriaEdital) continue;
      const categoria = categoriaPorCabecalho.get(g.categoriaEdital);
      if (!categoria) continue;
      for (const item of g.itens) categoriaPorItem.set(item, categoria);
    }

    // Itens sem cabeçalho de seção identificado (edital sem estrutura clara, ou análise
    // antiga) — único caso que ainda passa pelo classificador item a item.
    const itensSemCabecalho = grupos
      .filter((g) => !g.categoriaEdital)
      .flatMap((g) => g.itens)
      .filter((nome) => novoNoEdital(nome) && !categoriaPorItem.has(nome));
    const categoriasSemCabecalho = await classificarItensSemCabecalho(itensSemCabecalho);

    let criados = 0;
    for (const nome of todosItens) {
      if (existentes.has(nome)) continue;
      await prisma.checklistItem.create({
        data: {
          editalId,
          documentoNome: nome,
          obrigatorio: CHECKLIST_BASE.includes(nome),
          status: "FALTANTE",
          categoria: CATEGORIA_BASE[nome] ?? categoriaPorItem.get(nome) ?? categoriasSemCabecalho.get(nome) ?? null,
        },
      });
      criados++;
    }

    for (const doc of edital.documents) {
      if (!existentes.has(doc.nome)) {
        await prisma.checklistItem.create({
          data: {
            editalId,
            documentoNome: doc.nome,
            obrigatorio: true,
            status: "OK",
            observacao: "Gerado automaticamente pelo Agente Advogado",
          },
        });
        criados++;
      }
    }

    const hoje = new Date();
    const itensAtuais = await prisma.checklistItem.findMany({ where: { editalId } });
    let vencidos = 0;
    for (const item of itensAtuais) {
      if (item.validade && item.validade < hoje && item.status !== "VENCIDO") {
        await prisma.checklistItem.update({
          where: { id: item.id },
          data: { status: "VENCIDO" },
        });
        vencidos++;
      }
    }

    const faltantes = itensAtuais.filter((i) => i.status === "FALTANTE" && i.obrigatorio).length;

    await logAudit(
      editalId,
      "Agente Advogado",
      "Checklist de documentos",
      faltantes > 0 ? "ALERTA" : "OK",
      `${criados} item(ns) novo(s) no checklist. ${faltantes} documento(s) obrigatório(s) ainda pendente(s) de envio. ${vencidos} vencido(s).`
    );

    return { criados, faltantes, vencidos };
  });
}

type OperacaoChecklist =
  | { tipo: "adicionar"; nome: string; obrigatorio?: boolean }
  | { tipo: "remover"; nome: string }
  | { tipo: "atualizar"; nome: string; status?: ChecklistStatus; observacao?: string; obrigatorio?: boolean };

/** Correção via chat: interpreta o pedido do usuário sobre o checklist atual (adicionar
 * item esquecido, remover um que não se aplica, corrigir status/observação) e aplica
 * direto — não há extração de texto envolvida aqui, é edição de uma lista pequena. */
export async function corrigirAgente5ViaChat(editalId: string, notaCorrecao: string): Promise<string> {
  const itensAtuais = await prisma.checklistItem.findMany({ where: { editalId } });
  if (itensAtuais.length === 0) {
    await executarAgente5(editalId);
    return "Ainda não havia checklist para este edital — gerei o checklist base primeiro. Se ainda faltar algo, me diga de novo.";
  }

  const listaAtual = itensAtuais
    .map(
      (i) =>
        `- ${i.documentoNome} (obrigatório: ${i.obrigatorio ? "sim" : "não"}, status: ${i.status}${i.observacao ? `, obs: ${i.observacao}` : ""})`
    )
    .join("\n");

  const resultado = await askJSON<{ operacoes: OperacaoChecklist[]; resposta: string }>(
    `Você é o Agente Secretário, responsável pelo checklist de documentos de habilitação de uma licitação. O
usuário encontrou um problema na lista atual e pediu uma correção. Com base no pedido, decida quais operações
aplicar: "adicionar" um item novo, "remover" um item que não deveria estar lá, ou "atualizar" campos de um item
existente (casando pelo nome exatamente como está na lista atual). Só inclua operações realmente pedidas ou
implicadas pelo usuário — não invente mudanças que ele não pediu.

Responda em JSON:
{
  "operacoes": [
    { "tipo": "adicionar", "nome": string, "obrigatorio"?: boolean },
    { "tipo": "remover", "nome": string },
    { "tipo": "atualizar", "nome": string, "status"?: "OK" | "ENVIADO" | "VENCIDO" | "FALTANTE", "observacao"?: string, "obrigatorio"?: boolean }
  ],
  "resposta": string (uma frase curta confirmando o que foi feito, para mostrar ao usuário no chat)
}
Se não houver nenhuma mudança clara a fazer, devolva "operacoes": [] e explique o porquê em "resposta".`,
    `=== CHECKLIST ATUAL ===\n${listaAtual}\n\n=== PEDIDO DO USUÁRIO ===\n${notaCorrecao}`,
    { model: MODELO_HAIKU, maxTokens: 2000 }
  );

  for (const op of resultado.operacoes ?? []) {
    const alvo = itensAtuais.find((i) => i.documentoNome.toLowerCase() === op.nome.toLowerCase());
    if (op.tipo === "adicionar") {
      if (!alvo) {
        await prisma.checklistItem.create({
          data: { editalId, documentoNome: op.nome, obrigatorio: op.obrigatorio ?? true, status: "FALTANTE" },
        });
      }
    } else if (op.tipo === "remover") {
      if (alvo) await prisma.checklistItem.delete({ where: { id: alvo.id } });
    } else if (op.tipo === "atualizar" && alvo) {
      await prisma.checklistItem.update({
        where: { id: alvo.id },
        data: {
          ...(op.status ? { status: op.status } : {}),
          ...(op.observacao !== undefined ? { observacao: op.observacao } : {}),
          ...(op.obrigatorio !== undefined ? { obrigatorio: op.obrigatorio } : {}),
        },
      });
    }
  }

  await logAudit(
    editalId,
    "Agente Advogado",
    "Correção via chat",
    "OK",
    `Observação do usuário: "${notaCorrecao}". ${resultado.resposta}`
  );

  return resultado.resposta || "Ajustei o checklist conforme pedido.";
}
