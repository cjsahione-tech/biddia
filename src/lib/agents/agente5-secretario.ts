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
  "Contrato Social / Estatuto consolidado": "ECONOMICO_FINANCEIRA_JURIDICA",
  "Cartão CNPJ atualizado": "ECONOMICO_FINANCEIRA_JURIDICA",
  "Certidão Negativa de Débitos Federais (Receita Federal/PGFN)": "FISCAL",
  "Certidão Negativa de Débitos Estaduais": "FISCAL",
  "Certidão Negativa de Débitos Municipais": "FISCAL",
  "Certificado de Regularidade do FGTS (CRF)": "TRABALHISTA",
  "Certidão Negativa de Débitos Trabalhistas (CNDT)": "TRABALHISTA",
  "Balanço patrimonial / atestado de capacidade financeira": "ECONOMICO_FINANCEIRA_JURIDICA",
  "Atestado(s) de Capacidade Técnica": "QUALIFICACAO_TECNICA_EMPRESA",
};

/** Classifica os itens de habilitação específicos DESTE edital (extraídos do texto pelo
 * Agente Analista) nas categorias da Lei 14.133/2021 — só entra uma categoria na lista se
 * o edital de fato exigir algo nela; itens que não se encaixam claramente ficam sem
 * categoria (viram "Outros" na tela) em vez de forçados num balde errado. */
async function classificarCategoriasHabilitacao(itens: string[]): Promise<Map<string, HabilitacaoCategoria>> {
  const mapa = new Map<string, HabilitacaoCategoria>();
  if (itens.length === 0) return mapa;

  const result = await askJSON<{
    classificacoes: { item: string; categoria: HabilitacaoCategoria | null }[];
  }>(
    `Classifique cada exigência de habilitação de uma licitação pública brasileira (Lei 14.133/2021) em UMA
destas categorias:
- FISCAL: regularidade com Receita Federal, Fazenda Estadual, Fazenda Municipal (tributos)
- TRABALHISTA: FGTS, débitos trabalhistas (CNDT), regularidade com empregados
- ECONOMICO_FINANCEIRA_JURIDICA: balanço patrimonial, índices contábeis, capital social, contrato social, regularidade jurídica da empresa
- QUALIFICACAO_TECNICA_EMPRESA: atestado de capacidade técnica da empresa, registro em conselho/entidade profissional, comprovação de aptidão do licitante
- QUALIFICACAO_EQUIPE_TECNICA: responsável técnico, registro profissional de membro da equipe, currículo/experiência de profissional nomeado
- GARANTIA_CONTRATO: garantia de proposta, garantia contratual, seguro-garantia, caução

Se um item não se encaixar claramente em nenhuma categoria, responda "categoria": null — não force uma categoria
errada só para preencher.

Responda em JSON:
{ "classificacoes": [ { "item": string (exatamente como veio na lista), "categoria": "FISCAL" | "TRABALHISTA" | "ECONOMICO_FINANCEIRA_JURIDICA" | "QUALIFICACAO_TECNICA_EMPRESA" | "QUALIFICACAO_EQUIPE_TECNICA" | "GARANTIA_CONTRATO" | null } ] }`,
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

    let habilitacaoEdital: string[] = [];
    if (edital.analysis?.habilitacao) {
      try {
        habilitacaoEdital = JSON.parse(edital.analysis.habilitacao) as string[];
      } catch {
        habilitacaoEdital = [];
      }
    }

    const todosItens = Array.from(new Set([...CHECKLIST_BASE, ...habilitacaoEdital]));

    // Só classifica com IA os itens específicos do edital que ainda vão ser criados —
    // os padrão já têm categoria fixa (CATEGORIA_BASE) e itens que já existem não
    // precisam ser reclassificados a cada execução.
    const novosEspecificos = todosItens.filter(
      (nome) => !existentes.has(nome) && !CHECKLIST_BASE.includes(nome)
    );
    const categoriasEspecificas = await classificarCategoriasHabilitacao(novosEspecificos);

    let criados = 0;
    for (const nome of todosItens) {
      if (existentes.has(nome)) continue;
      await prisma.checklistItem.create({
        data: {
          editalId,
          documentoNome: nome,
          obrigatorio: CHECKLIST_BASE.includes(nome),
          status: "FALTANTE",
          categoria: CATEGORIA_BASE[nome] ?? categoriasEspecificas.get(nome) ?? null,
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
