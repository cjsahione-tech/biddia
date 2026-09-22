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

/**
 * Chama o modelo pedindo uma resposta em texto livre (não JSON) — usado pelo chat "de
 * conversa" de cada agente (ver src/lib/agents/agent-chat.ts), onde a resposta é uma
 * resposta natural para o usuário ler, não uma estrutura de dados para o app processar.
 */
export async function askText(
  system: string,
  userPrompt: string,
  opts?: { model?: string; maxTokens?: number }
): Promise<string> {
  const anthropic = getClient();

  const message = await anthropic.messages.create({
    model: opts?.model ?? MODELO_SONNET,
    max_tokens: opts?.maxTokens ?? 1500,
    system,
    messages: [{ role: "user", content: userPrompt }],
  });

  const block = message.content[0];
  if (block.type !== "text") throw new Error("Resposta inesperada do modelo");
  return block.text.trim();
}

export type FerramentaDef = { name: string; description: string; input_schema: Anthropic.Tool["input_schema"] };

export type ResultadoFerramenta = {
  resultadoTexto: string;
  arquivo?: { nome: string; contentType: string; base64: string };
};

export type ExecutarFerramenta = (name: string, input: Record<string, unknown>) => Promise<ResultadoFerramenta>;

const MAX_ITERACOES_FERRAMENTAS = 6;

/**
 * Conversa com o modelo permitindo que ele chame ferramentas (tool use) antes de
 * responder — usado pelo assistente geral "Bidd.IA" (src/app/api/assistente/route.ts),
 * diferente de askJSON/askText que são sempre single-turn sem tools. O `arquivo` que uma
 * ferramenta eventualmente produz NUNCA volta pro modelo em base64 (gastaria contexto à
 * toa) — só um resumo textual curto entra no tool_result; os arquivos de verdade são
 * coletados à parte e devolvidos junto da resposta final, pro chamador repassar ao
 * cliente HTTP.
 */
export async function conversarComFerramentas(
  system: string,
  historico: { role: "user" | "assistant"; content: string }[],
  ferramentas: FerramentaDef[],
  executar: ExecutarFerramenta,
  opts?: { model?: string; maxTokens?: number }
): Promise<{ texto: string; arquivos: { nome: string; contentType: string; base64: string }[] }> {
  const anthropic = getClient();
  const arquivos: { nome: string; contentType: string; base64: string }[] = [];

  const mensagens: Anthropic.MessageParam[] = historico.map((m) => ({ role: m.role, content: m.content }));

  for (let iteracao = 0; iteracao < MAX_ITERACOES_FERRAMENTAS; iteracao++) {
    const message = await anthropic.messages.create({
      model: opts?.model ?? MODELO_SONNET,
      max_tokens: opts?.maxTokens ?? 1500,
      system,
      tools: ferramentas,
      messages: mensagens,
    });

    if (message.stop_reason !== "tool_use") {
      const texto = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return { texto, arquivos };
    }

    mensagens.push({ role: "assistant", content: message.content });

    const blocosUso = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const resultados: Anthropic.ToolResultBlockParam[] = [];
    for (const bloco of blocosUso) {
      try {
        const resultado = await executar(bloco.name, bloco.input as Record<string, unknown>);
        if (resultado.arquivo) arquivos.push(resultado.arquivo);
        resultados.push({ type: "tool_result", tool_use_id: bloco.id, content: resultado.resultadoTexto });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erro desconhecido";
        resultados.push({ type: "tool_result", tool_use_id: bloco.id, content: `Erro: ${msg}`, is_error: true });
      }
    }
    mensagens.push({ role: "user", content: resultados });
  }

  return { texto: "Não consegui concluir sua solicitação — tente reformular ou dividir em passos menores.", arquivos };
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
