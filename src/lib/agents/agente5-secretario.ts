import type { ChecklistStatus } from "@prisma/client";
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

    let criados = 0;
    for (const nome of todosItens) {
      if (existentes.has(nome)) continue;
      await prisma.checklistItem.create({
        data: {
          editalId,
          documentoNome: nome,
          obrigatorio: CHECKLIST_BASE.includes(nome),
          status: "FALTANTE",
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
      "Agente Secretário",
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
    "Agente Secretário",
    "Correção via chat",
    "OK",
    `Observação do usuário: "${notaCorrecao}". ${resultado.resposta}`
  );

  return resultado.resposta || "Ajustei o checklist conforme pedido.";
}
