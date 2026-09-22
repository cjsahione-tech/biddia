import { prisma } from "@/lib/prisma";
import { askJSON, askText, MODELO_HAIKU, MODELO_SONNET } from "@/lib/anthropic";
import { executarAgente2 } from "@/lib/agents/agente2-analista";
import { corrigirAgente3ViaChat } from "@/lib/agents/agente3-financeiro";
import { executarAgente4 } from "@/lib/agents/agente4-advogado";
import { corrigirAgente5ViaChat } from "@/lib/agents/agente5-secretario";
import { executarAgente6 } from "@/lib/agents/agente6-auditor";
import { logAudit } from "@/lib/agents/run-tracker";
import { parseItens } from "@/lib/proposal";

// Uma aba de chat por agente que produz algo revisável pelo usuário — o Agente
// Comercial fica de fora porque atua na captação (fora do edital já criado), não numa
// aba deste edital.
export const AGENTES_CHAT = {
  "agente2-analista": { label: "Agente Analista" },
  "agente3-financeiro": { label: "Agente Financeiro" },
  "agente4-advogado": { label: "Agente Advogado" },
  "agente5-secretario": { label: "Agente Secretário" },
  "agente6-auditor": { label: "Agente Auditor" },
} as const;

export type AgentChatKey = keyof typeof AGENTES_CHAT;

export function isAgentChatKey(valor: string): valor is AgentChatKey {
  return Object.prototype.hasOwnProperty.call(AGENTES_CHAT, valor);
}

/**
 * Classifica a mensagem do usuário no chat de um agente: "correcao" quando ele pede,
 * de forma clara, para MUDAR algo que o agente já produziu (corrigir, refazer,
 * adicionar, remover, substituir); "conversa" para qualquer outro caso — pergunta,
 * pedido de explicação/opinião/sugestão, ou só um comentário, sem uma mudança concreta
 * sendo pedida agora. Na dúvida entre os dois, fica do lado seguro ("conversa"), que
 * nunca altera nada no banco — é sempre melhor pedir pro usuário confirmar do que
 * aplicar uma mudança que ele não pediu de fato.
 */
async function classificarMensagem(mensagem: string): Promise<"correcao" | "conversa"> {
  try {
    const { intencao } = await askJSON<{ intencao: "correcao" | "conversa" }>(
      `Classifique a mensagem de um usuário, enviada no chat com um agente de IA que já produziu um resultado
(uma análise, uma proposta financeira, um documento, um checklist ou uma auditoria) para uma licitação pública
brasileira. Responda com um destes dois valores:
- "correcao": o usuário está pedindo, de forma clara, para o agente MUDAR algo do que já foi produzido — corrigir
  um erro, refazer, adicionar, remover ou substituir algo.
- "conversa": qualquer outro caso — perguntas, pedidos de explicação, de opinião, de sugestão, ou apenas um
  comentário, sem uma mudança concreta sendo pedida agora.
Na dúvida entre os dois, responda "conversa".

Responda em JSON: { "intencao": "correcao" | "conversa" }`,
      mensagem,
      { model: MODELO_HAIKU, maxTokens: 50 }
    );
    return intencao === "correcao" ? "correcao" : "conversa";
  } catch (err) {
    console.error("Falha ao classificar mensagem do chat — tratando como conversa:", err);
    return "conversa";
  }
}

/**
 * Contexto (o que o agente já produziu para este edital) usado na resposta
 * conversacional — cada agente lê a própria "fonte da verdade" no banco, a mesma que a
 * aba correspondente já mostra na tela.
 */
async function montarContextoConversa(editalId: string, agentKey: AgentChatKey): Promise<string> {
  switch (agentKey) {
    case "agente2-analista": {
      const a = await prisma.analysis.findUnique({ where: { editalId } });
      if (!a) return "Você ainda não analisou este edital.";
      return `Resumo do objeto: ${a.resumoObjeto}
Obrigações da contratada: ${a.obrigacoesContratada}
Habilitação exigida: ${a.habilitacao}
Requisitos obrigatórios: ${a.requisitosObrigatorios}
Requisitos adicionais: ${a.requisitosAdicionais}
Riscos: ${a.riscos}
Parecer: ${a.parecer}`;
    }
    case "agente3-financeiro": {
      const p = await prisma.proposal.findUnique({ where: { editalId } });
      if (!p) return "Você ainda não montou a proposta financeira deste edital.";
      const itens = parseItens(p.itensJson)
        .map(
          (it) =>
            `- ${it.descricao} | ${it.unidade} | qtd ${it.quantidade} | valor unit. R$ ${it.valorUnitario} | total R$ ${it.valorTotal}`
        )
        .join("\n");
      return `Valor de referência do edital (PNCP): R$ ${p.valorGlobalReferencia}
Desconto aplicado: ${p.descontoPercentual}%
Suas observações: ${p.observacoes ?? "nenhuma"}
Itens da proposta:
${itens || "(nenhum item)"}`;
    }
    case "agente4-advogado": {
      const docs = await prisma.document.findMany({
        where: { editalId, tipo: "ANEXO_GERADO" },
        select: { nome: true },
      });
      if (docs.length === 0) {
        return "Você não encontrou nenhum modelo de declaração reproduzível no texto deste edital, então não gerou anexo nenhum.";
      }
      return `Anexos/declarações que você gerou:\n${docs.map((d) => `- ${d.nome}`).join("\n")}`;
    }
    case "agente5-secretario": {
      const itens = await prisma.checklistItem.findMany({
        where: { editalId },
        select: { documentoNome: true, obrigatorio: true, status: true, observacao: true },
      });
      if (itens.length === 0) return "Você ainda não montou o checklist de habilitação deste edital.";
      return `Checklist de habilitação:\n${itens
        .map(
          (i) =>
            `- ${i.documentoNome}${i.obrigatorio ? " (obrigatório)" : " (opcional)"} — status: ${i.status}${
              i.observacao ? ` — obs: ${i.observacao}` : ""
            }`
        )
        .join("\n")}`;
    }
    case "agente6-auditor": {
      const logs = await prisma.auditLog.findMany({
        where: { editalId },
        orderBy: { createdAt: "desc" },
        take: 10,
      });
      if (logs.length === 0) return "Você ainda não auditou este edital.";
      return `Suas últimas auditorias (mais recente primeiro):\n${logs
        .map((l) => `- [${l.severidade}] ${l.agente} — ${l.etapa}: ${l.mensagem}`)
        .join("\n")}`;
    }
  }
}

/**
 * Responde a uma mensagem de conversa (não uma correção): discute, explica, opina,
 * sugere — mas não altera nada no banco. Só uma correção de verdade (ver
 * processarCorrecaoChat) mexe no que o agente produziu.
 */
async function responderConversa(editalId: string, agentKey: AgentChatKey, mensagem: string): Promise<string> {
  const [contexto, historico] = await Promise.all([
    montarContextoConversa(editalId, agentKey),
    prisma.agentMessage.findMany({
      where: { editalId, agentKey },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  const historicoTexto = historico
    .reverse()
    .map((m) => `${m.role === "user" ? "Usuário" : "Você"}: ${m.conteudo}`)
    .join("\n");

  return askText(
    `Você é o ${AGENTES_CHAT[agentKey].label} de uma plataforma de IA que ajuda empresas brasileiras a participar de
licitações públicas (Bidd.IA). Você já produziu o resultado abaixo para este edital e agora está conversando com o
usuário sobre ele — pode explicar suas decisões, discutir ideias, dar sugestões e opiniões, tirar dúvidas. Responda
em português, de forma direta e natural, como uma conversa entre colegas de trabalho — sem repetir tudo que já foi
produzido, a menos que peçam. Se, no meio da conversa, perceber que o usuário está pedindo uma mudança concreta,
diga que pode aplicar e peça para ele confirmar numa mensagem clara — você está só conversando aqui, não aplique
nenhuma mudança sozinho.

=== O QUE VOCÊ JÁ PRODUZIU PARA ESTE EDITAL ===
${contexto}
${historicoTexto ? `\n=== CONVERSA ATÉ AGORA (mais antiga primeiro) ===\n${historicoTexto}` : ""}`,
    mensagem,
    { model: MODELO_SONNET, maxTokens: 1200 }
  );
}

/**
 * Aplica a correção pedida pelo usuário no chat de um agente. Cada agente já sabe
 * refazer seu próprio trabalho a partir do texto-fonte (Analista, Advogado) ou tem um
 * corretor dedicado mais barato que não repete a extração inteira (Financeiro,
 * Secretário). Devolve a mensagem de resposta a mostrar na conversa.
 */
async function processarCorrecaoChat(
  editalId: string,
  agentKey: AgentChatKey,
  notaCorrecao: string
): Promise<string> {
  switch (agentKey) {
    case "agente2-analista":
      await executarAgente2(editalId, { notaCorrecao });
      return "Reanalisei o edital considerando sua observação e atualizei o resumo, as obrigações, a habilitação, os riscos e o parecer.";

    case "agente3-financeiro":
      return corrigirAgente3ViaChat(editalId, notaCorrecao);

    case "agente4-advogado":
      await executarAgente4(editalId, { notaCorrecao });
      return "Regerei os anexos e declarações considerando sua observação.";

    case "agente5-secretario":
      return corrigirAgente5ViaChat(editalId, notaCorrecao);

    case "agente6-auditor": {
      const { severidade, acoes } = await executarAgente6(editalId);
      const resumo = acoes.length > 0 ? acoes.join(" ") : "Reauditei o pipeline e não encontrei pendências.";
      await logAudit(
        editalId,
        "Agente Auditor (HEAD)",
        "Correção via chat",
        severidade,
        `Observação do usuário: "${notaCorrecao}". ${resumo}`
      );
      return resumo;
    }
  }
}

/**
 * Processa qualquer mensagem enviada no chat de um agente: primeiro classifica se é
 * uma correção de verdade ou só uma mensagem de conversa, e só mexe no que o agente
 * produziu no primeiro caso — no segundo, responde na conversa (dúvidas, opiniões,
 * sugestões) sem alterar nada.
 */
export async function processarMensagemChat(
  editalId: string,
  agentKey: AgentChatKey,
  mensagem: string
): Promise<string> {
  const intencao = await classificarMensagem(mensagem);
  if (intencao === "conversa") {
    return responderConversa(editalId, agentKey, mensagem);
  }
  return processarCorrecaoChat(editalId, agentKey, mensagem);
}
