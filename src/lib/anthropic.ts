import Anthropic from "@anthropic-ai/sdk";

// Modelos usados pelos agentes.
// - SONNET: raciocínio/exatidão que não pode escorregar (proposta financeira).
// - HAIKU: tarefas objetivas de leitura/redação (análise, anexos, classificação da
//   busca, revisão). É bem mais rápido e — importante — usa uma cota de tokens/minuto
//   separada da do Sonnet, então rodar esses agentes em Haiku deixa a cota do Sonnet
//   inteira para o Agente Financeiro, sem os 3 se atropelarem e caírem em rate limit.
export const MODELO_SONNET = "claude-sonnet-4-5";
export const MODELO_HAIKU = "claude-haiku-4-5";

let client: Anthropic | null = null;

export function isAIConfigured() {
  return !!process.env.ANTHROPIC_API_KEY;
}

function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY não configurada. Adicione sua chave no arquivo .env para ativar os agentes de IA."
    );
  }
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

/**
 * Chama o modelo pedindo uma resposta estritamente em JSON e faz o parse.
 * Usado pelos agentes analista, financeiro, advogado e auditor.
 */
export async function askJSON<T>(
  system: string,
  userPrompt: string,
  opts?: { model?: string; maxTokens?: number }
): Promise<T> {
  const anthropic = getClient();

  const message = await anthropic.messages.create({
    model: opts?.model ?? MODELO_SONNET,
    max_tokens: opts?.maxTokens ?? 4000,
    system: `${system}\n\nResponda ESTRITAMENTE com um objeto JSON válido, sem markdown, sem texto antes ou depois.`,
    messages: [{ role: "user", content: userPrompt }],
  });

  const block = message.content[0];
  if (block.type !== "text") throw new Error("Resposta inesperada do modelo");

  let raw = block.text.trim();
  if (raw.startsWith("```")) {
    raw = raw.replace(/^```(json)?/, "").replace(/```$/, "").trim();
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error("Não foi possível interpretar a resposta da IA como JSON.");
  }
}
