import { createHash } from "node:crypto";
import type { EtapaKanban, HabilitacaoStatus } from "@prisma/client";
import type { TipoErroIA } from "@/lib/ia-erros";

// Regras PURAS (sem banco nem IA) da auditoria de habilitação — separadas para poderem ser
// testadas sozinhas. Quem orquestra a leitura do edital e a conferência com a IA é
// src/lib/agents/auditoria-habilitacao.ts.

export type StatusHabilitacao = "HABILITADA" | "HABILITADA_RESSALVAS" | "NAO_HABILITADA";
export type SituacaoExigencia = "ATENDIDA" | "NAO_ENVIADA" | "VENCIDA" | "VERIFICAR" | "NAO_SE_APLICA";

/** Antes desta data os editais nunca são auditados automaticamente (sem "recuperar" o passado). */
export const AUDITORIA_HABILITACAO_DESDE = new Date("2026-10-08T00:00:00-03:00");

// ── Datas ───────────────────────────────────────────────────────────────────

const FUSO = "America/Sao_Paulo";

/** AAAA-MM-DD do dia em Brasília — a data que a pessoa enxerga. */
export function diaBrasilia(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: FUSO });
}

/** Validades vêm do banco como meia-noite UTC do dia escolhido (AAAA-MM-DD). */
function diaDaValidade(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function diferencaEmDias(deDia: string, ateDia: string): number {
  const a = Date.parse(`${deDia}T00:00:00Z`);
  const b = Date.parse(`${ateDia}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** Dias antes da sessão em que um documento vencendo gera aviso (pedido do usuário). */
export const DIAS_AVISO_VENCIMENTO = 7;

/**
 * Data usada para decidir se um documento está válido: abertura da sessão; sem ela, o
 * encerramento das propostas; sem nenhuma das duas, hoje.
 */
export function dataReferenciaDoEdital(e: {
  dataAberturaProposta: Date | null;
  dataEncerramentoProposta: Date | null;
}): Date {
  return e.dataAberturaProposta ?? e.dataEncerramentoProposta ?? new Date();
}

// ── Avaliação de uma exigência ──────────────────────────────────────────────

export type DocEmpresaParaAvaliar = { id: string; validade: Date | null };

export type AvaliacaoExigencia = {
  situacao: SituacaoExigencia;
  documentoEmpresaId: string | null;
  validade: Date | null;
  observacao: string;
  /** Documento que vence no máximo 7 dias ANTES da sessão — pede renovação e gera aviso. */
  venceAntesDaSessao: boolean;
};

/**
 * Uma exigência só conta como ATENDIDA quando existe documento enviado E ele está dentro da
 * validade na data da sessão. Na dúvida (a IA não tinha certeza de que o documento enviado é o
 * que o edital pede), vira VERIFICAR — nunca "atendida".
 */
export function avaliarExigencia(opts: {
  doc: DocEmpresaParaAvaliar | null;
  /** A conferência por IA tem certeza de que o documento corresponde ao que o edital pede? */
  certeza: boolean;
  dataReferencia: Date;
}): AvaliacaoExigencia {
  const { doc, certeza, dataReferencia } = opts;
  const ref = diaBrasilia(dataReferencia);

  if (!doc) {
    return certeza
      ? { situacao: "NAO_ENVIADA", documentoEmpresaId: null, validade: null, observacao: "Documento não enviado.", venceAntesDaSessao: false }
      : {
          situacao: "VERIFICAR",
          documentoEmpresaId: null,
          validade: null,
          observacao: "Não foi possível ter certeza se algum documento enviado atende a esta exigência — confira manualmente.",
          venceAntesDaSessao: false,
        };
  }

  if (doc.validade) {
    const val = diaDaValidade(doc.validade);
    if (val < ref) {
      const diasAntes = diferencaEmDias(val, ref);
      const dataBr = doc.validade.toLocaleDateString("pt-BR", { timeZone: "UTC" });
      return {
        situacao: "VENCIDA",
        documentoEmpresaId: doc.id,
        validade: doc.validade,
        observacao: `Documento vence em ${dataBr}, antes da data da sessão.`,
        venceAntesDaSessao: diasAntes <= DIAS_AVISO_VENCIMENTO,
      };
    }
  }

  if (!certeza) {
    return {
      situacao: "VERIFICAR",
      documentoEmpresaId: doc.id,
      validade: doc.validade,
      observacao: "Há um documento enviado, mas não foi possível ter certeza de que ele atende a esta exigência — confira manualmente.",
      venceAntesDaSessao: false,
    };
  }

  return { situacao: "ATENDIDA", documentoEmpresaId: doc.id, validade: doc.validade, observacao: "Documento enviado e válido na data da sessão.", venceAntesDaSessao: false };
}

// ── Resultado geral ─────────────────────────────────────────────────────────

export function calcularResultado(opts: { situacoes: SituacaoExigencia[]; leituraCompleta: boolean }): {
  total: number;
  atendidas: number;
  pendentes: number;
  percentual: number;
  status: StatusHabilitacao;
} {
  // "Não se aplica" (exigência de outro tipo de empresa) fica fora da conta.
  const consideradas = opts.situacoes.filter((s) => s !== "NAO_SE_APLICA");
  const total = consideradas.length;
  const atendidas = consideradas.filter((s) => s === "ATENDIDA").length;
  const razao = total === 0 ? 0 : atendidas / total;
  let status: StatusHabilitacao = razao >= 1 ? "HABILITADA" : razao >= 0.7 ? "HABILITADA_RESSALVAS" : "NAO_HABILITADA";
  // Se algum documento do processo não pôde ser lido por inteiro, nunca fica "Habilitada" sem ressalva.
  if (status === "HABILITADA" && !opts.leituraCompleta) status = "HABILITADA_RESSALVAS";
  return {
    total,
    atendidas,
    pendentes: total - atendidas,
    percentual: Math.round(razao * 1000) / 10,
    status,
  };
}

export const ROTULO_STATUS_HABILITACAO: Record<string, string> = {
  AGUARDANDO: "Aguardando auditoria",
  AUDITANDO: "Auditando…",
  HABILITADA: "Habilitada",
  HABILITADA_RESSALVAS: "Habilitada com ressalvas",
  NAO_HABILITADA: "Não habilitada",
  ERRO: "Auditoria com erro",
  NA_FILA: "Na fila",
  AGUARDANDO_IA: "Aguardando IA (será retomada)",
  ARQUIVO_ILEGIVEL: "Não consegui ler os arquivos",
  EDITAL_GRANDE: "Edital muito grande",
  TEMPO_ESGOTADO: "Tempo esgotado – tentando de novo",
};

/** Explicação em linguagem simples de cada selo (aparece ao passar o mouse). */
export const DICA_STATUS_HABILITACAO: Record<string, string> = {
  AGUARDANDO: "A auditoria de habilitação é feita automaticamente quando o edital entra em Qualificação.",
  AUDITANDO: "Lendo o edital e conferindo com a documentação da empresa. Costuma levar de 1 a 3 minutos.",
  HABILITADA: "Todos os documentos exigidos pelo edital estão enviados e válidos na data da sessão.",
  HABILITADA_RESSALVAS: "A maior parte dos documentos está em ordem, mas há pendências. Abra a aba Habilitação para ver o que falta.",
  NAO_HABILITADA: "Faltam documentos importantes. Abra a aba Habilitação para ver a lista do que enviar.",
  ERRO: "A auditoria não pôde ser concluída. Use \"Tentar novamente\" na aba Habilitação.",
  NA_FILA: "Há outras auditorias em andamento. Esta começa assim que uma vaga abrir.",
  AGUARDANDO_IA: "O serviço de IA está indisponível agora. A auditoria está guardada e será retomada sozinha — você não precisa fazer nada.",
  ARQUIVO_ILEGIVEL: "Os arquivos do edital não puderam ser baixados ou lidos. Abra a aba Habilitação para ver qual arquivo e o que fazer.",
  EDITAL_GRANDE: "O edital é muito grande e está sendo lido em partes; pode levar um pouco mais.",
  TEMPO_ESGOTADO: "A leitura passou do tempo previsto. O sistema continua de onde parou, sem precisar de ação sua.",
};

/** Selo quando as tentativas automáticas acabaram: nada de "tentando de novo" — o usuário decide. */
export function statusHabilitacaoDefinitivaDoErro(tipo: TipoErroIA): HabilitacaoStatus {
  switch (tipo) {
    case "ARQUIVO_ILEGIVEL":
    case "SEM_DOCUMENTO":
      return "ARQUIVO_ILEGIVEL";
    case "EDITAL_GRANDE":
      return "EDITAL_GRANDE";
    default:
      return "ERRO";
  }
}

/** Qual selo mostrar para cada tipo de erro (o texto técnico nunca vai para a tela). */
export function statusHabilitacaoDoErro(tipo: TipoErroIA): HabilitacaoStatus {
  switch (tipo) {
    case "SALDO_INSUFICIENTE":
    case "CHAVE_INVALIDA":
    case "LIMITE_TAXA":
    case "SOBRECARGA":
    case "SERVICO_IA":
    case "CONEXAO":
      return "AGUARDANDO_IA";
    case "TEMPO_ESGOTADO":
      return "TEMPO_ESGOTADO";
    case "ARQUIVO_ILEGIVEL":
    case "SEM_DOCUMENTO":
      return "ARQUIVO_ILEGIVEL";
    case "EDITAL_GRANDE":
      return "EDITAL_GRANDE";
    default:
      return "ERRO";
  }
}

// ── Texto em pedaços ────────────────────────────────────────────────────────

/** Corta o texto em pedaços de ~`tamanho` caracteres, quebrando em fim de linha e com uma
 * pequena sobreposição — uma exigência que cai na emenda aparece inteira em pelo menos um pedaço. */
export function dividirEmPedacos(texto: string, tamanho = 45_000, sobreposicao = 3_000): string[] {
  if (texto.length <= tamanho) return [texto];
  const pedacos: string[] = [];
  let inicio = 0;
  while (inicio < texto.length) {
    let fim = Math.min(texto.length, inicio + tamanho);
    if (fim < texto.length) {
      const quebra = texto.lastIndexOf("\n", fim);
      if (quebra > inicio + tamanho * 0.5) fim = quebra;
    }
    pedacos.push(texto.slice(inicio, fim));
    if (fim >= texto.length) break;
    inicio = Math.max(fim - sobreposicao, inicio + 1);
    const quebraInicio = texto.indexOf("\n", inicio);
    if (quebraInicio !== -1 && quebraInicio - inicio < sobreposicao) inicio = quebraInicio + 1;
  }
  return pedacos;
}

// ── Impressão digital da documentação ───────────────────────────────────────

/** Muda quando a empresa envia, substitui, altera validade ou remove um documento. */
export function fingerprintDocumentos(docs: { id: string; updatedAt: Date }[]): string {
  const base = [...docs]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((d) => `${d.id}:${d.updatedAt.getTime()}`)
    .join("|");
  return createHash("sha1").update(base).digest("hex");
}

/**
 * Impressão digital do EDITAL: documentos que entram na leitura (id, nome e origem) e as datas
 * que definem a validade dos documentos. Não usa campos que mudam ao baixar o arquivo — senão a
 * própria auditoria "mudaria" o edital. Junto com a impressão digital da documentação da
 * empresa, decide se um resultado salvo ainda vale (sem gastar IA de novo).
 */
export function fingerprintEdital(
  docs: { id: string; nome: string; origemUrl: string | null }[],
  datas: { dataAberturaProposta: Date | null; dataEncerramentoProposta: Date | null }
): string {
  const base = [
    ...[...docs].sort((a, b) => a.id.localeCompare(b.id)).map((d) => `${d.id}:${d.nome}:${d.origemUrl ?? ""}`),
    `abre:${datas.dataAberturaProposta?.getTime() ?? ""}`,
    `encerra:${datas.dataEncerramentoProposta?.getTime() ?? ""}`,
  ].join("|");
  return createHash("sha1").update(base).digest("hex");
}

// ── Quando auditar ──────────────────────────────────────────────────────────

/**
 * A auditoria só roda para editais que o analista decidiu disputar: a partir de "Qualificação".
 * Ficam de fora a Oportunidade (só ~2,5% chegam a Qualificação — auditar tudo gasta IA à toa),
 * o Rascunho e as etapas negativas (Sem propostas, Eliminada, Recusada).
 */
export const LISTA_ETAPAS_QUE_AUDITAM: EtapaKanban[] = [
  "QUALIFICACAO",
  "PRONTA_PARA_ENVIAR",
  "ENVIADA_PARA_DISPUTA",
  "CLASSIFICACAO",
  "ACEITA",
  "EM_CONTRATO",
  "FINALIZADA",
];
export const ETAPAS_QUE_AUDITAM: ReadonlySet<string> = new Set(LISTA_ETAPAS_QUE_AUDITAM);

export function etapaAudita(etapaKanban: string): boolean {
  return ETAPAS_QUE_AUDITAM.has(etapaKanban);
}

// ── Grupos da coluna Qualificação ───────────────────────────────────────────

export type GrupoHabilitacaoChave = "EM_AUDITORIA" | "HABILITADAS" | "NAO_HABILITADAS" | "COM_PROBLEMA" | "SEM_AUDITORIA";

/** Ordem em que os grupos aparecem na coluna Qualificação: o que está rodando primeiro, depois o resultado. */
export const GRUPOS_HABILITACAO: { chave: GrupoHabilitacaoChave; titulo: string; status: string[] }[] = [
  { chave: "EM_AUDITORIA", titulo: "Auditando / na fila", status: ["AUDITANDO", "NA_FILA", "AGUARDANDO_IA", "TEMPO_ESGOTADO", "EDITAL_GRANDE"] },
  { chave: "HABILITADAS", titulo: "Habilitadas", status: ["HABILITADA", "HABILITADA_RESSALVAS"] },
  { chave: "NAO_HABILITADAS", titulo: "Não habilitadas", status: ["NAO_HABILITADA"] },
  { chave: "COM_PROBLEMA", titulo: "Auditoria com problema", status: ["ERRO", "ARQUIVO_ILEGIVEL"] },
  { chave: "SEM_AUDITORIA", titulo: "Sem auditoria", status: ["AGUARDANDO"] },
];

/** Filtro do quadro: um selo exato ("ERRO") ou um grupo inteiro ("grupo:HABILITADAS"). */
export function passaFiltroHabilitacao(status: string, filtro: string | null): boolean {
  if (!filtro) return true;
  if (filtro.startsWith("grupo:")) return !!GRUPOS_HABILITACAO.find((g) => g.chave === filtro.slice(6))?.status.includes(status);
  return status === filtro;
}

/** Separa os cards por grupo (só devolve grupos com cards), mantendo a ordem de entrada dentro de cada um. */
export function agruparPorHabilitacao<T extends { habilitacaoStatus: string }>(cards: T[]): { chave: GrupoHabilitacaoChave; titulo: string; cards: T[] }[] {
  const grupos = GRUPOS_HABILITACAO.map((g) => ({ chave: g.chave, titulo: g.titulo, cards: cards.filter((c) => g.status.includes(c.habilitacaoStatus)) }));
  // Estado que ninguém previu não pode fazer um card sumir: cai em "Sem auditoria".
  const conhecidos = new Set(GRUPOS_HABILITACAO.flatMap((g) => g.status));
  const orfaos = cards.filter((c) => !conhecidos.has(c.habilitacaoStatus));
  if (orfaos.length > 0) grupos[grupos.length - 1].cards.push(...orfaos);
  return grupos.filter((g) => g.cards.length > 0);
}

// ── Custo estimado ──────────────────────────────────────────────────────────

// Custo médio medido em editais reais (US$ 0,10 a 0,21 por edital) e uma cotação de referência
// SÓ para dar uma ideia em reais nos avisos de confirmação — são estimativas, não cobrança.
export const CUSTO_MEDIO_AUDITORIA_USD = 0.15;
export const COTACAO_USD_BRL_ESTIMADA = 5.5;

export function custoEstimadoBrl(quantidadeAuditorias: number): number {
  return Math.round(quantidadeAuditorias * CUSTO_MEDIO_AUDITORIA_USD * COTACAO_USD_BRL_ESTIMADA * 100) / 100;
}

// Preços de lista (US$ por milhão de tokens): Haiku 4.5 e Sonnet 4.5.
const PRECO = { haiku: { entrada: 1, saida: 5 }, sonnet: { entrada: 3, saida: 15 } };

export function custoEstimadoUsd(u: { haikuEntrada: number; haikuSaida: number; sonnetEntrada: number; sonnetSaida: number }): number {
  const usd =
    (u.haikuEntrada * PRECO.haiku.entrada + u.haikuSaida * PRECO.haiku.saida + u.sonnetEntrada * PRECO.sonnet.entrada + u.sonnetSaida * PRECO.sonnet.saida) /
    1_000_000;
  return Math.round(usd * 10_000) / 10_000;
}

/** Custo estimado (US$) de um volume de tokens num modelo: "haiku" no nome do modelo = Haiku, senão Sonnet. */
export function custoPorModeloUsd(modelo: string, entrada: number, saida: number): number {
  const p = modelo.toLowerCase().includes("haiku") ? PRECO.haiku : PRECO.sonnet;
  return (entrada * p.entrada + saida * p.saida) / 1_000_000;
}

/** Epoch de um nome como "196986_editais_1786333361.zip" (para achar o envio mais recente). */
export function epochNoNome(nome: string): number {
  const m = nome.match(/_(\d{9,})\.\w+$/);
  return m ? Number(m[1]) : 0;
}

// ── Tipo de empresa pelo nome ───────────────────────────────────────────────

/**
 * O que dá para saber do tipo da empresa só pela razão social (LTDA, S/A, MEI, cooperativa...).
 * Serve para a IA decidir se uma exigência "só para cooperativas" vale ou não para a empresa.
 * Nome sem nenhuma indicação devolve null — a IA então responde "não sei" (vai para conferência
 * manual), nunca chuta.
 */
export function inferirNaturezaPelaRazaoSocial(razaoSocial: string): string | null {
  const nome = razaoSocial
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  const achados: string[] = [];
  if (/\bLTDA\b|\bLIMITADA\b/.test(nome)) achados.push("sociedade empresária limitada (LTDA)");
  if (/\bS\.?\s?\/?\s?A\.?(\s|$)|SOCIEDADE ANONIMA/.test(nome)) achados.push("sociedade anônima (S/A)");
  if (/\bEIRELI\b/.test(nome)) achados.push("empresa individual de responsabilidade limitada (EIRELI)");
  if (/\bMEI\b/.test(nome)) achados.push("microempreendedor individual (MEI)");
  if (/\bCOOPERATIVA\b|\bCOOP\b/.test(nome)) achados.push("cooperativa");
  if (/\b(ME|EPP)\b/.test(nome)) achados.push("microempresa/empresa de pequeno porte (ME/EPP)");
  if (/ASSOCIACAO|FUNDACAO/.test(nome)) achados.push("entidade sem fins lucrativos");
  return achados.length > 0 ? achados.join("; ") : null;
}
