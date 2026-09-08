import Anthropic from "@anthropic-ai/sdk";

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
    model: opts?.model ?? "claude-sonnet-4-5",
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
