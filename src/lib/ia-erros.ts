// Classificação dos erros que aparecem quando um agente chama a IA (ou gera PDF) —
// separa o que vale a pena tentar de novo (instabilidade passageira: sobrecarga, limite de
// taxa, queda de conexão, resposta cortada/malformada) do que NÃO adianta repetir (bug
// determinístico, ex: caractere que o PDF não consegue codificar), e traduz cada caso numa
// mensagem que diz o que está acontecendo, em vez de um genérico "tente de novo".

export function mensagemDoErro(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : "erro desconhecido";
}

function statusHttp(err: unknown): number | null {
  const s = (err as { status?: unknown } | null)?.status;
  return typeof s === "number" ? s : null;
}

/** Erros que costumam passar sozinhos numa nova tentativa. */
export function ehErroTransiente(err: unknown): boolean {
  const status = statusHttp(err);
  if (status !== null) return status === 408 || status === 409 || status === 429 || status >= 500;

  const msg = mensagemDoErro(err).toLowerCase();
  if (/winansi|cannot encode/.test(msg)) return false; // bug determinístico, repetir não resolve
  return /overloaded|sobrecarreg|rate.?limit|timeout|timed out|etimedout|econnreset|econnrefused|fetch failed|terminated|socket|network|connection|interpretar a resposta da ia|resposta da ia|json|aborted/.test(
    msg
  );
}

/** Traduz o erro técnico numa explicação curta do que está impedindo a ação. */
export function descreverErro(err: unknown): string {
  const status = statusHttp(err);
  const msg = mensagemDoErro(err);
  const m = msg.toLowerCase();

  if (/winansi|cannot encode/.test(m)) {
    return "o texto do edital tem um símbolo que o gerador de PDF não conseguiu escrever";
  }
  if (status === 429 || /rate.?limit/.test(m)) {
    return "o limite de uso do serviço de IA foi atingido neste minuto — aguarde cerca de 1 minuto e peça de novo";
  }
  if (status === 529 || /overloaded|sobrecarreg/.test(m)) {
    return "o serviço de IA está sobrecarregado no momento (mesmo após várias tentativas automáticas)";
  }
  if (status !== null && status >= 500) {
    return `o serviço de IA respondeu com erro interno (${status}) mesmo após várias tentativas`;
  }
  if (status === 401 || status === 403) {
    return "a chave de acesso ao serviço de IA foi recusada — avise o suporte";
  }
  if (/interpretar a resposta da ia|json/.test(m)) {
    return "a IA devolveu uma resposta incompleta ou fora do formato esperado, mesmo após novas tentativas — o texto do edital pode ser muito longo ou confuso para esta tarefa";
  }
  if (/timeout|timed out|aborted|terminated/.test(m)) {
    return "a operação demorou mais que o limite de tempo";
  }
  if (/econnreset|fetch failed|network|socket|connection/.test(m)) {
    return "houve uma falha de conexão com o serviço de IA";
  }
  return msg;
}

/** Roda `fn` até `tentativas` vezes, esperando um pouco mais a cada falha — mas só repete
 * se o erro for passageiro (ver ehErroTransiente); erro determinístico sobe na hora. */
export async function comRetry<T>(
  fn: () => Promise<T>,
  opts?: { tentativas?: number; esperaMs?: number; aoFalhar?: (err: unknown, tentativa: number) => void | Promise<void> }
): Promise<T> {
  const tentativas = opts?.tentativas ?? 3;
  const esperaMs = opts?.esperaMs ?? 1500;
  let ultimoErro: unknown;
  for (let t = 1; t <= tentativas; t++) {
    try {
      return await fn();
    } catch (err) {
      ultimoErro = err;
      if (t === tentativas || !ehErroTransiente(err)) throw err;
      await opts?.aoFalhar?.(err, t);
      await new Promise((r) => setTimeout(r, esperaMs * t));
    }
  }
  throw ultimoErro;
}

/** Extrai o primeiro objeto/array JSON de um texto, tolerando cerca de markdown e texto
 * solto antes/depois — o modelo às vezes ignora "responda só JSON". */
export function extrairJSON(texto: string): unknown {
  let raw = texto.trim();
  if (raw.startsWith("```")) raw = raw.replace(/^```(json)?/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(raw);
  } catch {
    const ini = raw.search(/[{[]/);
    if (ini === -1) throw new Error("Não foi possível interpretar a resposta da IA como JSON.");
    const abre = raw[ini];
    const fecha = abre === "{" ? "}" : "]";
    const fim = raw.lastIndexOf(fecha);
    if (fim <= ini) throw new Error("Não foi possível interpretar a resposta da IA como JSON.");
    try {
      return JSON.parse(raw.slice(ini, fim + 1));
    } catch {
      throw new Error("Não foi possível interpretar a resposta da IA como JSON.");
    }
  }
}
