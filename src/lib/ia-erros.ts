// Classificação dos erros que aparecem quando um agente chama a IA (ou gera PDF) —
// separa o que vale a pena tentar de novo (instabilidade passageira: sobrecarga, limite de
// taxa, queda de conexão, resposta cortada/malformada) do que NÃO adianta repetir (bug
// determinístico, ex: caractere que o PDF não consegue codificar), e traduz cada caso numa
// mensagem que diz o que está acontecendo, em vez de um genérico "tente de novo".

import { ehErroDeArmazenamentoIndisponivel } from "@/lib/armazenamento-estado";

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
  // Erro já tipado: saldo/chave nunca se resolvem repetindo na hora (o disjuntor cuida disso).
  if (err instanceof ErroTipado) return TIPOS_TRANSIENTES.has(err.tipo) && err.tipo !== "SALDO_INSUFICIENTE" && err.tipo !== "CHAVE_INVALIDA";
  const status = statusHttp(err);
  if (status !== null) return status === 408 || status === 409 || status === 429 || status >= 500;

  const msg = mensagemDoErro(err).toLowerCase();
  if (/winansi|cannot encode/.test(msg)) return false; // bug determinístico, repetir não resolve
  return /overloaded|sobrecarreg|rate.?limit|timeout|timed out|etimedout|econnreset|econnrefused|fetch failed|terminated|socket|network|connection|interpretar a resposta da ia|resposta da ia|json|aborted/.test(
    msg
  );
}

// ── Classificação por tipo ──────────────────────────────────────────────────
// A tela nunca mostra a mensagem crua da API (traz request_id, JSON, nome de conta...): cada
// erro vira um TIPO, com um texto amigável para o analista, um texto específico para o
// administrador (só quando há algo que ele precisa fazer) e o detalhe técnico, que fica só
// num campo interno do banco.

export type TipoErroIA =
  | "SALDO_INSUFICIENTE"
  | "CHAVE_INVALIDA"
  | "LIMITE_TAXA"
  | "SOBRECARGA"
  | "SERVICO_IA"
  | "CONEXAO"
  | "TEMPO_ESGOTADO"
  | "RESPOSTA_INVALIDA"
  | "ARQUIVO_ILEGIVEL"
  | "SEM_DOCUMENTO"
  | "EDITAL_GRANDE"
  | "SEM_EXIGENCIAS"
  | "ARMAZENAMENTO_INDISPONIVEL" // o Storage de arquivos está bloqueado/fora do ar: não é culpa do arquivo
  // Casos que repetir não resolve: só uma pessoa resolve ("Precisa de ação humana").
  | "PDF_PROTEGIDO" // PDF com senha ou corrompido
  | "EDITAL_REMOVIDO" // o órgão apagou a contratação do portal
  | "LOGIN_OU_CAPTCHA" // o portal devolveu uma página de login/captcha no lugar do arquivo
  | "ESCANEADO_ILEGIVEL" // documento escaneado sem condições de leitura
  | "CUSTO_EXCEDIDO" // a auditoria passou do teto de custo por edital
  | "DESCONHECIDO";

/** Erro que já nasce com tipo (usado pela auditoria para os casos de edital/arquivo). */
export class ErroTipado extends Error {
  constructor(
    public tipo: TipoErroIA,
    mensagem: string
  ) {
    super(mensagem);
    this.name = "ErroTipado";
  }
}

export type ErroClassificado = {
  tipo: TipoErroIA;
  /** Passa sozinho numa nova tentativa mais tarde? (limite, sobrecarga, conexão, tempo...) */
  transiente: boolean;
  /** A IA inteira está indisponível (saldo/chave): abre o disjuntor e pausa as chamadas. */
  pausaIA: boolean;
  /** Texto seguro para o analista. */
  mensagemUsuario: string;
  /** Texto para o administrador (null = não há nada específico que ele precise fazer). */
  mensagemAdmin: string | null;
  /** Detalhe cru — só para o campo interno do banco/log, nunca para a tela. */
  detalheTecnico: string;
};

const MSG_USUARIO: Record<TipoErroIA, string> = {
  SALDO_INSUFICIENTE: "A análise por IA está temporariamente indisponível. Sua auditoria foi guardada e será retomada automaticamente.",
  CHAVE_INVALIDA: "A análise por IA está indisponível por um problema de configuração. A equipe responsável já foi avisada; a auditoria será retomada quando for resolvido.",
  LIMITE_TAXA: "O serviço de IA está muito ocupado agora. A auditoria será retomada automaticamente em instantes.",
  SOBRECARGA: "O serviço de IA está instável no momento. A auditoria será retomada automaticamente.",
  SERVICO_IA: "O serviço de IA está instável no momento. A auditoria será retomada automaticamente.",
  CONEXAO: "Houve uma falha de conexão passageira. A auditoria será retomada automaticamente.",
  TEMPO_ESGOTADO: "A auditoria demorou mais que o previsto e será retomada de onde parou.",
  RESPOSTA_INVALIDA: "A IA devolveu uma resposta fora do formato esperado. Vamos tentar de novo automaticamente.",
  ARQUIVO_ILEGIVEL: "Não consegui ler os arquivos deste edital. Abra o edital, confira se os documentos baixam e, se precisar, envie o PDF manualmente.",
  SEM_DOCUMENTO: "Este edital não tem documentos para ler. Envie o PDF do edital na tela de Editais.",
  EDITAL_GRANDE: "Este edital é muito grande e está sendo lido em partes. Pode levar um pouco mais.",
  SEM_EXIGENCIAS: "Não encontrei exigências de habilitação nos documentos lidos. Confira se o arquivo do edital está completo.",
  ARMAZENAMENTO_INDISPONIVEL:
    "O armazenamento de arquivos está temporariamente indisponível, então não consegui abrir os documentos agora. Sua auditoria foi guardada e será retomada automaticamente — nenhum resultado foi dado por engano.",
  PDF_PROTEGIDO: "O arquivo do edital está protegido por senha ou corrompido, então não consigo abri-lo. Envie uma cópia sem senha (ou baixe de novo no portal) para continuar.",
  EDITAL_REMOVIDO: "O órgão apagou esta contratação do portal (geralmente para republicá-la com outro número). Procure a versão republicada ou envie o edital em PDF para continuar.",
  LOGIN_OU_CAPTCHA: "O portal do órgão pediu login ou verificação (captcha) no lugar do arquivo, e o sistema não consegue passar por isso. Baixe o edital no portal e envie o PDF para continuar.",
  ESCANEADO_ILEGIVEL: "O edital é um documento escaneado e a imagem está ruim demais para eu ler com segurança. Envie uma versão mais nítida (ou em PDF com texto) para continuar.",
  CUSTO_EXCEDIDO: "A leitura deste edital passou do limite de custo previsto por edital, então parei para não gastar à toa. Se quiser mesmo assim, libere a leitura completa (custo extra).",
  DESCONHECIDO: "Ocorreu um problema inesperado na auditoria. Vamos tentar de novo automaticamente.",
};

/** Botões que a tela oferece para cada caso em que só uma pessoa resolve. */
export type AcaoHumana = "enviar_arquivo" | "tentar_de_novo" | "liberar_leitura";

const ACOES_HUMANAS: Partial<Record<TipoErroIA, AcaoHumana[]>> = {
  PDF_PROTEGIDO: ["enviar_arquivo", "tentar_de_novo"],
  EDITAL_REMOVIDO: ["enviar_arquivo"],
  LOGIN_OU_CAPTCHA: ["enviar_arquivo", "tentar_de_novo"],
  ESCANEADO_ILEGIVEL: ["enviar_arquivo", "tentar_de_novo"],
  CUSTO_EXCEDIDO: ["liberar_leitura", "enviar_arquivo"],
};

/** Esse tipo de erro pede uma pessoa (não adianta tentar sozinho)? */
export function pedeAcaoHumana(tipo: TipoErroIA | null | undefined): boolean {
  return !!tipo && tipo in ACOES_HUMANAS;
}

export function acoesHumanasDoTipo(tipo: TipoErroIA | null | undefined): AcaoHumana[] {
  return (tipo && ACOES_HUMANAS[tipo]) || [];
}

const MSG_ADMIN: Partial<Record<TipoErroIA, string>> = {
  SALDO_INSUFICIENTE: "Saldo da API Anthropic insuficiente. Recarregue em console.anthropic.com → Plans & Billing.",
  CHAVE_INVALIDA: "A chave da API Anthropic foi recusada (401/403). Confira a variável ANTHROPIC_API_KEY na Vercel.",
};

/** Texto padrão (amigável) de um tipo de erro — também usado para linhas antigas do banco. */
export function mensagemAmigavelDoTipo(tipo: TipoErroIA): string {
  return MSG_USUARIO[tipo];
}

/** Texto enquanto a nova tentativa automática está agendada (o usuário não precisa fazer nada). */
export function mensagemDeRetentativaDoTipo(tipo: TipoErroIA): string {
  if (tipo === "ARQUIVO_ILEGIVEL") {
    return "Não consegui baixar os arquivos do edital agora (o portal de origem não respondeu). Vou tentar de novo automaticamente.";
  }
  return MSG_USUARIO[tipo];
}

/** Texto quando as tentativas automáticas acabaram: o usuário decide (botão "Tentar novamente"). */
export function mensagemDefinitivaDoTipo(tipo: TipoErroIA): string {
  switch (tipo) {
    case "TEMPO_ESGOTADO":
      return "A auditoria não terminou no tempo previsto, mesmo após novas tentativas. Clique em “Tentar novamente”.";
    case "LIMITE_TAXA":
    case "SOBRECARGA":
    case "SERVICO_IA":
    case "CONEXAO":
      return "O serviço de IA continua instável. Tente novamente em alguns minutos.";
    case "RESPOSTA_INVALIDA":
      return "A IA não conseguiu interpretar este edital, mesmo após novas tentativas. Tente novamente; se persistir, avise o suporte.";
    default:
      return MSG_USUARIO[tipo];
  }
}

/** Erros com tipo que valem uma nova tentativa automática. */
const TIPOS_TRANSIENTES = new Set<TipoErroIA>(["LIMITE_TAXA", "SOBRECARGA", "SERVICO_IA", "CONEXAO", "TEMPO_ESGOTADO", "RESPOSTA_INVALIDA", "SALDO_INSUFICIENTE", "CHAVE_INVALIDA"]);

export function tipoDoErro(err: unknown): TipoErroIA {
  if (err instanceof ErroTipado) return err.tipo;
  if (ehErroDeArmazenamentoIndisponivel(err)) return "ARMAZENAMENTO_INDISPONIVEL";
  return tipoDaMensagem(mensagemDoErro(err), statusHttp(err));
}

function tipoDaMensagem(msg: string, status: number | null): TipoErroIA {
  const m = msg.toLowerCase();
  // Saldo: a API responde 400 "Your credit balance is too low to access the Anthropic API".
  if (/credit balance|too low to access|purchase credits|plans & billing/.test(m)) return "SALDO_INSUFICIENTE";
  if (status === 401 || status === 403 || /invalid x-api-key|authentication_error|permission_error|api_key não configurada/.test(m)) return "CHAVE_INVALIDA";
  if (status === 413 || /prompt is too long|request_too_large|request too large/.test(m)) return "EDITAL_GRANDE";
  if (status === 429 || /rate.?limit/.test(m)) return "LIMITE_TAXA";
  if (status === 529 || /overloaded|sobrecarreg/.test(m)) return "SOBRECARGA";
  if (status === 408) return "TEMPO_ESGOTADO";
  if (status !== null && status >= 500) return "SERVICO_IA";
  if (/interpretar a resposta da ia|resposta da ia|json|resposta inesperada/.test(m)) return "RESPOSTA_INVALIDA";
  if (/timeout|timed out|etimedout|aborted|terminated/.test(m)) return "TEMPO_ESGOTADO";
  if (/econnreset|econnrefused|fetch failed|network|socket|connection/.test(m)) return "CONEXAO";
  return "DESCONHECIDO";
}

export function classificarErro(err: unknown): ErroClassificado {
  const tipo = tipoDoErro(err);
  const status = statusHttp(err);
  const detalhe = `${status !== null ? `[HTTP ${status}] ` : ""}${mensagemDoErro(err)}`.slice(0, 1500);
  return {
    tipo,
    transiente: TIPOS_TRANSIENTES.has(tipo),
    pausaIA: tipo === "SALDO_INSUFICIENTE" || tipo === "CHAVE_INVALIDA",
    mensagemUsuario: MSG_USUARIO[tipo],
    mensagemAdmin: MSG_ADMIN[tipo] ?? null,
    detalheTecnico: detalhe,
  };
}

/**
 * Linhas gravadas ANTES da classificação têm só o texto cru em `mensagem` (às vezes com o
 * request_id da API). Reconhece o tipo pelo texto para nunca mostrar esse conteúdo.
 */
export function tipoDeMensagemAntiga(mensagem: string | null | undefined): TipoErroIA {
  if (!mensagem) return "DESCONHECIDO";
  const m = mensagem.toLowerCase();
  if (/não foi possível ler nenhum documento/.test(m)) return "ARQUIVO_ILEGIVEL";
  if (/não tem nenhum documento/.test(m)) return "SEM_DOCUMENTO";
  if (/grande demais/.test(m)) return "EDITAL_GRANDE";
  if (/nenhuma exigência/.test(m)) return "SEM_EXIGENCIAS";
  return tipoDaMensagem(mensagem, null);
}

/** Traduz o erro técnico numa explicação curta do que está impedindo a ação. */
export function descreverErro(err: unknown): string {
  const status = statusHttp(err);
  const msg = mensagemDoErro(err);
  const m = msg.toLowerCase();

  if (tipoDoErro(err) === "SALDO_INSUFICIENTE") {
    return "o serviço de IA está temporariamente indisponível (será retomado automaticamente)";
  }
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
  // Mensagem crua só passa se parecer texto nosso (curta, sem JSON nem request_id da API).
  if (msg.length > 200 || /[{}]|request_id|req_[a-z0-9]{6,}/i.test(msg)) return "ocorreu um problema inesperado";
  return msg;
}

/** Roda `fn` até `tentativas` vezes, esperando um pouco mais a cada falha — mas só repete
 * se o erro for passageiro (ver ehErroTransiente); erro determinístico sobe na hora. */
export async function comRetry<T>(
  fn: () => Promise<T>,
  opts?: {
    tentativas?: number;
    esperaMs?: number;
    aoFalhar?: (err: unknown, tentativa: number) => void | Promise<void>;
    /** Se este sinal já foi acionado (prazo estourou), não repete: a falha sobe na hora. */
    sinal?: AbortSignal;
  }
): Promise<T> {
  const tentativas = opts?.tentativas ?? 3;
  const esperaMs = opts?.esperaMs ?? 1500;
  let ultimoErro: unknown;
  for (let t = 1; t <= tentativas; t++) {
    try {
      return await fn();
    } catch (err) {
      ultimoErro = err;
      if (t === tentativas || !ehErroTransiente(err) || opts?.sinal?.aborted) throw err;
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
