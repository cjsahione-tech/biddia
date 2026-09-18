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

// Tetos de segurança para o OCR via visão (ver transcreverPdfViaVisao): acima disso, o
// tempo/custo de mandar o PDF inteiro como imagens por página deixa de valer a pena
// dentro do orçamento de 60s da função serverless — o documento segue sem OCR em vez de
// arriscar estourar o tempo do pipeline inteiro. 32MB/100 páginas é o teto da própria API
// da Anthropic para documentos; ficamos bem abaixo disso de propósito.
export const OCR_VISAO_LIMITE_PAGINAS = 25;
export const OCR_VISAO_LIMITE_BYTES = 15 * 1024 * 1024;

/**
 * Transcreve o texto de um PDF sem camada de texto selecionável (edital escaneado)
 * mandando o arquivo para o modelo como um bloco "document" — Claude lê cada página como
 * imagem nativamente, então isso funciona como OCR sem precisar de nenhuma biblioteca de
 * OCR à parte (evita dependências nativas tipo Tesseract, problemáticas em serverless).
 * Devolve texto puro (não JSON), pensado para entrar no mesmo pipeline de corte/blocos
 * que já existe para PDFs com texto selecionável de verdade — os agentes Analista,
 * Financeiro e Advogado passam a enxergar o mesmo texto de qualquer forma.
 */
export async function transcreverPdfViaVisao(base64: string, opts?: { maxTokens?: number }): Promise<string | null> {
  const anthropic = getClient();
  try {
    const message = await anthropic.messages.create({
      model: MODELO_HAIKU,
      max_tokens: opts?.maxTokens ?? 8000,
      messages: [
        {
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
            {
              type: "text",
              text: `Este PDF é um documento escaneado (sem texto selecionável) — transcreva TODO o texto visível nele,
na ordem em que aparece, página por página. Preserve números, tabelas (como texto separado por espaços/pipes
alinhados) e a estrutura de seções/itens tal como aparecem no documento. Não resuma, não comente, não traduza —
apenas transcreva literalmente o que está escrito e visível nas imagens das páginas. Se algum trecho estiver
ilegível, marque com "[ilegível]" e siga em frente. Responda SOMENTE com o texto transcrito, sem nenhum comentário
seu antes ou depois.`,
            },
          ],
        },
      ],
    });

    const block = message.content[0];
    if (block.type !== "text") return null;
    return block.text.trim() || null;
  } catch (err) {
    console.error("Falha ao transcrever PDF via visão (OCR):", err);
    return null;
  }
}
