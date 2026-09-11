import { executarAgente2 } from "@/lib/agents/agente2-analista";
import { corrigirAgente3ViaChat } from "@/lib/agents/agente3-financeiro";
import { executarAgente4 } from "@/lib/agents/agente4-advogado";
import { corrigirAgente5ViaChat } from "@/lib/agents/agente5-secretario";
import { executarAgente6 } from "@/lib/agents/agente6-auditor";
import { logAudit } from "@/lib/agents/run-tracker";

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
 * Aplica a correção pedida pelo usuário no chat de um agente. Cada agente já sabe
 * refazer seu próprio trabalho a partir do texto-fonte (Analista, Advogado) ou tem um
 * corretor dedicado mais barato que não repete a extração inteira (Financeiro,
 * Secretário). Devolve a mensagem de resposta a mostrar na conversa.
 */
export async function processarCorrecaoChat(
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
