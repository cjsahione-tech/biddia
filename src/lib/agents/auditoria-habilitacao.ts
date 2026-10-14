import { createHash } from "node:crypto";
import type { Document as DocumentRow, HabilitacaoStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { askJSON, MODELO_HAIKU, MODELO_SONNET, verificarIADisponivel, type UsoTokens } from "@/lib/anthropic";
import { classificarErro, ErroTipado, mensagemDeRetentativaDoTipo, mensagemDefinitivaDoTipo } from "@/lib/ia-erros";
import { PAUSA_MS } from "@/lib/controle-ia";
import { statusHabilitacaoDefinitivaDoErro, statusHabilitacaoDoErro } from "@/lib/habilitacao";
import { mapComLimite } from "@/lib/concorrencia";
import { logAudit } from "@/lib/agents/run-tracker";
import { baixarEPersistirDocumento } from "@/lib/agents/document-download";
import { colocarNaFila, haVaga, iniciarProximasDaFila } from "@/lib/agents/auditoria-fila";
import { densidadeDeHabilitacao, selecionarTrechosDeHabilitacao } from "@/lib/habilitacao-trechos";
import { BATIMENTO_VIVO_MS, decidirAposFalha, MAX_CONTINUACOES_NA_CADEIA, MAX_PASSOS_LEITURA, MAX_PASSOS_SEM_AVANCO } from "@/lib/auditoria-politica";
import { obterTextoBrutoDocumento } from "@/lib/agents/pdf-extract";
import { MARCA_ILEGIVEL } from "@/lib/agents/arquivos-compactados";
import { dispararAuditoriaHabilitacao } from "@/lib/agents/auditoria-dispatch";
import { notificarPrazosVencendo } from "@/lib/notifications";
import { escolherMelhorDocumento } from "@/lib/documentos-empresa";
import {
  CATALOGO_DOCUMENTOS,
  CATEGORIAS_CATALOGO,
  chaveEfetivaDoDocumento,
  equivalentesDe,
  itemPorChave,
} from "@/lib/catalogo-documentos";
import {
  avaliarExigencia,
  calcularResultado,
  custoEstimadoUsd,
  dataReferenciaDoEdital,
  dividirEmPedacos,
  inferirNaturezaPelaRazaoSocial,
  epochNoNome,
  fingerprintDocumentos,
  fingerprintEdital,
  etapaAudita,
  type SituacaoExigencia,
} from "@/lib/habilitacao";

// Auditoria de habilitação: lê TUDO que o processo tem (edital, termo de referência, anexos —
// inclusive dentro de ZIPs), levanta cada documento de habilitação exigido, confere com a
// documentação da empresa (tela Documentos) e grava o resultado e a lista de exigências.
//
// Roda sozinha quando o edital entra em Qualificação (ver auditoria-gatilho.ts) — nunca na
// captação, para não gastar IA com editais que talvez nunca sejam disputados — e refaz a
// conferência quando a documentação da empresa muda (ver reavaliarEditaisDaEmpresa).
//
// Cabe em execuções de 60s da Vercel: o edital é lido em pedaços, quatro por vez; se não der
// tempo, o progresso fica salvo e uma nova execução continua de onde parou (até 3 execuções).

// Tempos (a Vercel corta a função em 60s): cada execução trabalha até ORCAMENTO_MS e só começa
// um passo novo se sobrar a "folga" dele (uma chamada da IA leva de 10 a 25s).
const ORCAMENTO_MS = 46_000;
const MARGEM_FINAL_MS = 6_000; // reservada para salvar o progresso e disparar a continuação
const FOLGA_PREPARO_MS = 14_000; // começar a baixar/ler mais um arquivo
const LIMITE_ARQUIVO_MS = 22_000; // teto para baixar OU extrair um arquivo
const FOLGA_NOVO_PEDACO_MS = 16_000; // começar mais um pedaço (Haiku)
const FOLGA_NOVO_LOTE_MS = 24_000; // começar mais um lote de conferência (Sonnet)
const PEDACOS_EM_PARALELO = 4;
const LIMITE_PEDACOS_GRANDE = 8; // acima disso o edital é "muito grande" (lido em várias partes)
const FALHAS_ATE_DESISTIR_DO_ARQUIVO = 2; // tentativas (passos) antes de seguir sem um arquivo
const NOME_AGENTE = "Auditor de Habilitação";

type Bruta = {
  categoria: string;
  documento: string;
  chave: string | null;
  origem: string;
  localizacao: string | null;
  condicao: string | null;
  // Só vale para certo tipo de empresa/situação (ex.: "apenas cooperativas").
  aplicavelSe: string | null;
};

type MotivoArquivo = "download" | "demorou" | "formato";

// Progresso salvo no banco: cada execução retoma de onde a anterior parou. Campos novos são
// opcionais para continuar lendo registros gravados antes desta versão.
type Progresso = {
  chunksTotal: number;
  feitos: number[];
  brutas: Bruta[];
  /** Impressão digital do conjunto de pedaços: se mudar, a leitura recomeça. */
  plano?: string;
  passos?: number;
  semAvanco?: number;
  /** Arquivos que falharam (por id): quantas vezes e por quê. */
  falhas?: Record<string, { n: number; motivo: MotivoArquivo }>;
  /** Resultado da conferência por lote (índice → exigências conferidas). */
  lotes?: Record<string, Final[]>;
};

type Pedaco = { docNome: string; indice: number; total: number; texto: string; densidade: number };

const IDS_CATEGORIA = CATEGORIAS_CATALOGO.map((c) => c.id);

// ── Documentos do processo ──────────────────────────────────────────────────

/**
 * Quais documentos do processo são lidos. Todos — exceto as versões ANTERIORES de um mesmo
 * edital do LicitaNet (o órgão reenvia o edital ao retificar; só o envio mais recente vale).
 */
export function selecionarDocumentos<T extends { nome: string; tipo: string; categoria: string | null; createdAt: Date }>(
  docs: T[]
): { lidos: T[]; ignorados: T[] } {
  const editaisLicitaNet = docs.filter((d) => d.tipo === "DOCUMENTO_LICITANET" && d.categoria === "EDITAL");
  let maisRecente: T | null = null;
  for (const d of editaisLicitaNet) {
    if (!maisRecente) maisRecente = d;
    else {
      const [a, b] = [epochNoNome(d.nome), epochNoNome(maisRecente.nome)];
      if (a > b || (a === b && d.createdAt > maisRecente.createdAt)) maisRecente = d;
    }
  }
  const ignorados = editaisLicitaNet.filter((d) => d !== maisRecente);
  return { lidos: docs.filter((d) => !ignorados.includes(d)), ignorados };
}

// ── Extração (Haiku) ────────────────────────────────────────────────────────

const LISTA_CATALOGO_PROMPT = CATALOGO_DOCUMENTOS.map((i) => `- ${i.chave}: ${i.nome} [${i.aplicacao === "PS" ? "P+S" : i.aplicacao}]`).join("\n");
const LISTA_CATEGORIAS_PROMPT = CATEGORIAS_CATALOGO.map((c) => `- ${c.id}: ${c.titulo}`).join("\n");

function promptExtracao(): string {
  return `Você lê um TRECHO de um documento de licitação pública brasileira (edital, termo de referência ou anexo) e
levanta TODA exigência de DOCUMENTO DE HABILITAÇÃO que o LICITANTE precisa apresentar para ser habilitado:
habilitação jurídica, regularidade fiscal, regularidade trabalhista, qualificação econômico-financeira,
qualificação técnica (empresa e equipe), certificados e atestados, declarações exigidas, garantia de proposta.

NÃO inclua: itens da proposta de preços (planilha, proposta comercial), obrigações de execução do contrato,
documentos que o próprio órgão emite, nem regras gerais sem documento a apresentar. Se o trecho não tem
nenhuma exigência de documento de habilitação, devolva a lista vazia. NÃO invente nada: só o que está escrito.
Se o mesmo documento aparece mais de uma vez no trecho, liste uma vez.

Categorias (campo "categoria" — use exatamente um destes ids):
${LISTA_CATEGORIAS_PROMPT}

Catálogo de documentos conhecidos (campo "chave": o id do item SOMENTE se o documento exigido É esse mesmo
documento. Não use um item parecido, da mesma categoria ou "quase igual" — nesse caso use null):
${LISTA_CATALOGO_PROMPT}

Campos de cada exigência:
- "categoria": id da categoria.
- "documento": o documento exigido, descrito de forma curta e fiel ao edital.
- "chave": id do catálogo ou null.
- "arquivo": o nome do arquivo de onde veio, tirado da linha "===== ARQUIVO: nome =====" mais próxima acima, ou null.
- "localizacao": onde está no texto — item/cláusula (ex.: "item 8.2.1") e a página (as marcas "[Pág. N]" do texto
  indicam a página; ex.: "item 8.2.1, pág. 14"). null se não constar. NUNCA cite "trecho" nem números de trecho
  (isso é só a divisão interna da leitura).
- "condicao": condição ou requisito que o documento precisa cumprir, quando o texto disser (ex.: "índices de
  liquidez maiores que 1,00", "atestado de pelo menos 50% do quantitativo", "emitido nos últimos 90 dias"),
  senão null.
- "aplicavelSe": se a exigência só vale para um tipo específico de empresa ou situação (ex.: "apenas cooperativas",
  "somente empresa estrangeira", "empresário individual", "sociedades simples", "ME/EPP optante pelo Simples",
  "consórcios"), descreva em poucas palavras; se vale para todos os licitantes, null.

Responda em JSON: { "exigencias": [ { "categoria": string, "documento": string, "chave": string | null, "arquivo": string | null, "localizacao": string | null, "condicao": string | null, "aplicavelSe": string | null } ] }`;
}

async function extrairDoPedaco(pedaco: Pedaco, uso: UsoTokens, sinal?: AbortSignal): Promise<Bruta[]> {
  const r = await askJSON<{
    exigencias?: { categoria?: string; documento?: string; chave?: string | null; arquivo?: string | null; localizacao?: string | null; condicao?: string | null; aplicavelSe?: string | null }[];
  }>(
    promptExtracao(),
    `Documento: ${pedaco.docNome} (trecho ${pedaco.indice + 1} de ${pedaco.total})\n\n${pedaco.texto}`,
    { model: MODELO_HAIKU, maxTokens: 6000, uso, sinal }
  );

  const brutas: Bruta[] = [];
  for (const e of r.exigencias ?? []) {
    const documento = e.documento?.trim();
    if (!documento) continue;
    const categoria = e.categoria && IDS_CATEGORIA.includes(e.categoria as never) ? e.categoria : "outros";
    brutas.push({
      categoria,
      documento,
      chave: e.chave && itemPorChave(e.chave) ? e.chave : null,
      origem: e.arquivo?.trim() || pedaco.docNome,
      localizacao: e.localizacao?.trim() || null,
      condicao: e.condicao?.trim() || null,
      aplicavelSe: e.aplicavelSe?.trim() || null,
    });
  }
  return brutas;
}

// ── Conferência (Sonnet) ────────────────────────────────────────────────────

type DocEmpresa = {
  id: string;
  tipo: string;
  nome: string;
  catalogoChave: string | null;
  validade: Date | null;
  createdAt?: Date;
  updatedAt: Date;
};

type Final = {
  categoria: string;
  documento: string;
  chave: string | null;
  origem: string;
  localizacao: string | null;
  condicao: string | null;
  aplicavelSe: string | null;
  /** false = a exigência não vale para esta empresa (com certeza); true/null = vale ou não dá para saber. */
  aplica: boolean | null;
  docEmpresaId: string | null;
  certeza: boolean;
  acaoSugerida: string | null;
};

async function carregarDocsDaEmpresa(companyId: string): Promise<DocEmpresa[]> {
  return prisma.companyDocument.findMany({
    where: { companyId },
    select: { id: true, tipo: true, nome: true, catalogoChave: true, validade: true, createdAt: true, updatedAt: true },
    orderBy: { createdAt: "desc" },
  });
}

async function carregarFatosDaEmpresa(companyId: string): Promise<FatosEmpresa> {
  const c = await prisma.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { razaoSocial: true, regimeTributarioPadrao: true, atendeBem: true, atendeServico: true },
  });
  return { razaoSocial: c.razaoSocial, natureza: inferirNaturezaPelaRazaoSocial(c.razaoSocial), regime: c.regimeTributarioPadrao, atendeBem: c.atendeBem, atendeServico: c.atendeServico };
}

/**
 * Documento da empresa por item do catálogo. Com vários no mesmo item (atestados, certificados...),
 * vale o que ainda está válido na data da sessão (o mais recente deles); senão, o mais recente.
 */
function indexarPorChave(docs: DocEmpresa[], dataReferencia?: Date): Map<string, DocEmpresa> {
  const grupos = new Map<string, DocEmpresa[]>();
  for (const d of docs) {
    const chave = chaveEfetivaDoDocumento(d);
    if (chave) grupos.set(chave, [...(grupos.get(chave) ?? []), d]);
  }
  const mapa = new Map<string, DocEmpresa>();
  for (const [chave, lista] of grupos) {
    const escolhido = escolherMelhorDocumento(lista, dataReferencia);
    if (escolhido) mapa.set(chave, escolhido);
  }
  return mapa;
}

function removerDuplicadas(brutas: Bruta[]): Bruta[] {
  const vistos = new Set<string>();
  const out: Bruta[] = [];
  for (const b of brutas) {
    const k = `${b.chave ?? "-"}|${b.documento.toLowerCase().replace(/\s+/g, " ")}`;
    if (vistos.has(k)) continue;
    vistos.add(k);
    out.push(b);
  }
  return out;
}

// Exigências por chamada à IA: lotes pequenos rodam em paralelo e cada um responde em poucos
// segundos (uma chamada só, com tudo, passava dos 60s da Vercel em editais com dezenas de itens).
const EXIGENCIAS_POR_LOTE = 18;

/**
 * Conferência final (Sonnet). A IA NÃO reescreve os textos: devolve só um mapa compacto —
 * quais exigências são o mesmo documento (se juntam), o item do catálogo, qual documento da
 * empresa atende, se tem certeza e uma ação sugerida curta. Os textos (documento, origem,
 * localização, condição) vêm do levantamento, preservados.
 */
type FatosEmpresa = { razaoSocial: string; natureza: string | null; regime: string | null; atendeBem: boolean; atendeServico: boolean };

type ContextoConferencia = { sistema: string; listaDocs: string; idsValidos: Set<string> };

/** Prompt e lista de documentos da empresa — iguais para todos os lotes de uma conferência. */
function contextoDeConferencia(docs: DocEmpresa[], empresa: FatosEmpresa): ContextoConferencia {
  const porChave = indexarPorChave(docs);
  const personalizados = docs.filter((d) => !chaveEfetivaDoDocumento(d));

  const listaDocs = [
    ...Array.from(porChave.entries()).map(([chave, d]) => `- ${d.id} | item do catálogo: ${chave} | arquivo: ${d.nome}`),
    ...personalizados.map((d) => `- ${d.id} | personalizado: ${d.tipo} | arquivo: ${d.nome}`),
  ].join("\n");

  const sistema = `Você é o conferente final de habilitação de uma licitação pública brasileira. Recebe exigências de
documentos de habilitação levantadas do edital/termo de referência (numeradas E1, E2...) e a lista de documentos
que a EMPRESA tem. Devolva um mapa COMPACTO — não reescreva os textos das exigências.

Regras:
1. AGRUPE as exigências que são o MESMO documento (ex.: repetida no edital e no termo de referência): coloque os
   números juntos em "ids". Documentos diferentes NUNCA se agrupam. Toda exigência recebida deve aparecer em
   exatamente um grupo.
2. "chave": o item do catálogo SOMENTE se o documento exigido É esse mesmo documento (confirme ou corrija a
   sugestão). Não use item parecido, da mesma categoria ou "quase igual" — nesse caso null (ex.: "Registro
   Comercial" NÃO é o Cartão CNPJ; "comprovante de opção pelo Simples" NÃO é a certidão de tributos federais):
${LISTA_CATALOGO_PROMPT}
3. "docEmpresaId": o id (da lista de documentos da empresa) do documento que atende, ou null se a empresa não tem
   nada que atenda. Prefira o documento do mesmo item do catálogo. Um documento PERSONALIZADO só atende se o nome
   indicar claramente o documento exigido.
4. "certeza": true só se você tem CERTEZA de que entendeu qual DOCUMENTO é exigido e de que o documento escolhido
   (ou a ausência dele) está certo. Em dúvida sobre o documento — exigência vaga ("documento equivalente"), nome
   ambíguo — false. Condições numéricas ou de conteúdo do documento (índices, percentuais, prazos de emissão) NÃO
   são dúvida: são só informativas e não mudam a certeza.
5. "acao": uma frase curta (até 15 palavras), em português simples, do que a empresa deve fazer, ou null se já
   está atendida.
6. "aplica": algumas exigências dizem "aplicavelSe" (só valem para um tipo de empresa/situação). Com base nos dados
   da empresa abaixo, responda "sim" se a exigência VALE para esta empresa (ex.: "sociedades empresárias" e a empresa
   é uma LTDA), "nao" se tem certeza de que NÃO vale (ex.: "apenas cooperativas" e a empresa é uma LTDA), ou
   "nao_sei" se os dados não permitem saber (ex.: "ME/EPP" sem o porte informado). Sem "aplicavelSe", responda "sim".

DADOS DA EMPRESA: razão social "${empresa.razaoSocial}"; tipo de empresa pelo nome: ${empresa.natureza ?? "não dá para saber pelo nome"}; regime tributário padrão: ${empresa.regime ?? "não informado"};
atua com ${[empresa.atendeBem ? "venda de produtos" : null, empresa.atendeServico ? "prestação de serviços" : null].filter(Boolean).join(" e ") || "não informado"}.

Responda em JSON: { "grupos": [ { "ids": ["E1","E7"], "chave": string | null, "docEmpresaId": string | null, "certeza": boolean, "aplica": "sim" | "nao" | "nao_sei", "acao": string | null } ] }`;

  const idsValidos = new Set(docs.map((d) => d.id));
  return { sistema, listaDocs, idsValidos };
}

/** Divide as exigências em lotes (ordem fixa: o mesmo conjunto gera sempre os mesmos lotes). */
export function montarLotes(brutas: Bruta[]): Bruta[][] {
  // Ordena por categoria para que repetições caiam no mesmo lote.
  const ordenadas = [...brutas].sort((x, y) => x.categoria.localeCompare(y.categoria) || x.documento.localeCompare(y.documento));
  const lotes: Bruta[][] = [];
  for (let i = 0; i < ordenadas.length; i += EXIGENCIAS_POR_LOTE) lotes.push(ordenadas.slice(i, i + EXIGENCIAS_POR_LOTE));

  return lotes;
}

/** Confere UM lote de exigências com a IA (Sonnet). */
async function conferirLote(lote: Bruta[], ctx: ContextoConferencia, uso: UsoTokens, sinal?: AbortSignal): Promise<Final[]> {
  const { sistema, listaDocs, idsValidos } = ctx;
  const entrada = lote
    .map(
      (b, i) =>
        `E${i + 1} | categoria: ${b.categoria} | documento: ${b.documento} | chave sugerida: ${b.chave ?? "nenhuma"} | local: ${b.localizacao ?? "—"} | condição: ${b.condicao ?? "—"} | aplicavelSe: ${b.aplicavelSe ?? "—"}`
    )
    .join("\n");
  const r = await askJSON<{
    grupos?: { ids?: string[]; chave?: string | null; docEmpresaId?: string | null; certeza?: boolean; aplica?: string; acao?: string | null }[];
  }>(
    sistema,
    `=== EXIGÊNCIAS LEVANTADAS ===\n${entrada}\n\n=== DOCUMENTOS DA EMPRESA ===\n${listaDocs || "(a empresa ainda não enviou nenhum documento)"}`,
    { model: MODELO_SONNET, maxTokens: 4000, uso, sinal }
  );

  const finais: Final[] = [];
  const usadas = new Set<number>();
  for (const g of r.grupos ?? []) {
    const idx = (g.ids ?? [])
      .map((id) => Number(String(id).replace(/\D/g, "")) - 1)
      .filter((n) => Number.isInteger(n) && n >= 0 && n < lote.length && !usadas.has(n));
    if (idx.length === 0) continue;
    idx.forEach((n) => usadas.add(n));
    const base = lote[idx[0]];
    const locais = Array.from(new Set(idx.map((n) => lote[n].localizacao).filter((x): x is string => !!x)));
    const origens = Array.from(new Set(idx.map((n) => lote[n].origem)));
    const condicoes = Array.from(new Set(idx.map((n) => lote[n].condicao).filter((x): x is string => !!x)));
    finais.push({
      categoria: base.categoria,
      documento: base.documento,
      chave: g.chave && itemPorChave(g.chave) ? g.chave : base.chave,
      origem: origens.join("; "),
      localizacao: locais.length > 0 ? locais.join("; ") : null,
      condicao: condicoes.length > 0 ? condicoes.join("; ") : null,
      aplicavelSe: idx.map((n) => lote[n].aplicavelSe).find((x): x is string => !!x) ?? null,
      // false = não vale (com certeza); true = vale; null = não dá para saber. Só vale a resposta da
      // IA quando a exigência realmente é condicional ao tipo de empresa; senão, vale para todos.
      aplica: !idx.some((n) => lote[n].aplicavelSe) ? true : g.aplica === "nao" ? false : g.aplica === "sim" ? true : null,
      // Só aceita id que de fato existe na documentação desta empresa (nunca confia na IA).
      docEmpresaId: g.docEmpresaId && idsValidos.has(g.docEmpresaId) ? g.docEmpresaId : null,
      certeza: g.certeza === true,
      acaoSugerida: g.acao?.trim() || null,
    });
  }
  // Exigência que a IA esqueceu de devolver NÃO some: entra como "verificar manualmente".
  lote.forEach((b, n) => {
    if (usadas.has(n)) return;
    finais.push({
      categoria: b.categoria,
      documento: b.documento,
      chave: b.chave,
      origem: b.origem,
      localizacao: b.localizacao,
      condicao: b.condicao,
      aplicavelSe: b.aplicavelSe,
      aplica: null,
      docEmpresaId: null,
      certeza: false,
      acaoSugerida: null,
    });
  });
  return finais;
}

async function conferirComIA(brutas: Bruta[], docs: DocEmpresa[], uso: UsoTokens, empresa: FatosEmpresa, sinal?: AbortSignal): Promise<Final[]> {
  if (brutas.length === 0) return [];
  const ctx = contextoDeConferencia(docs, empresa);
  const resultados = await mapComLimite(montarLotes(brutas), 4, (lote) => conferirLote(lote, ctx, uso, sinal));
  return resultados.flat();
}

// ── Avaliação e gravação ────────────────────────────────────────────────────

type LinhaAvaliada = {
  ordem: number;
  categoria: string;
  documento: string;
  catalogoChave: string | null;
  origem: string;
  localizacao: string | null;
  condicao: string | null;
  aplicavelSe: string | null;
  situacao: SituacaoExigencia;
  documentoEmpresaId: string | null;
  validade: Date | null;
  certezaMapeamento: boolean;
  observacao: string;
  acaoSugerida: string | null;
  venceAntesDaSessao: boolean;
};

const ACAO_PADRAO: Record<SituacaoExigencia, string> = {
  ATENDIDA: "",
  NAO_ENVIADA: "Reunir o documento e enviá-lo na tela Documentos.",
  VENCIDA: "Renovar o documento e enviar a versão atualizada na tela Documentos.",
  VERIFICAR: "Conferir manualmente se algum documento da empresa atende a esta exigência.",
  NAO_SE_APLICA: "",
};

/** Decide a situação de cada exigência. Determinístico: a IA só diz qual documento e se tem certeza. */
export function avaliarTodas(
  finais: Pick<Final, "categoria" | "documento" | "chave" | "origem" | "localizacao" | "condicao" | "aplicavelSe" | "aplica" | "docEmpresaId" | "certeza" | "acaoSugerida">[],
  docs: DocEmpresa[],
  dataReferencia: Date
): LinhaAvaliada[] {
  const porChave = indexarPorChave(docs, dataReferencia);
  const porId = new Map(docs.map((d) => [d.id, d]));

  return finais.map((f, i) => {
    // Exigência de outro tipo de empresa (ex.: "para cooperativa"): fora da conta.
    if (f.aplica === false) {
      return {
        ordem: i,
        categoria: f.categoria,
        documento: f.documento,
        catalogoChave: f.chave,
        origem: f.origem,
        localizacao: f.localizacao,
        condicao: f.condicao,
        aplicavelSe: f.aplicavelSe,
        situacao: "NAO_SE_APLICA" as SituacaoExigencia,
        documentoEmpresaId: null,
        validade: null,
        certezaMapeamento: true,
        observacao: `Não se aplica a esta empresa${f.aplicavelSe ? ` (vale ${f.aplicavelSe.toLowerCase()})` : ""}.`,
        acaoSugerida: null,
        venceAntesDaSessao: false,
      };
    }
    let doc: DocEmpresa | null = null;
    let certeza = f.certeza;
    let nota = "";
    // Exigência que só vale para certo tipo de empresa e não dá para ter certeza de que NÃO vale
    // para esta: nunca é creditada sozinha — vai para conferência manual.
    if (f.aplicavelSe && f.aplica !== true) {
      certeza = false;
      nota = ` Esta exigência só vale para: ${f.aplicavelSe} — confirme se se aplica à empresa.`;
    }

    if (f.chave) {
      // Item do catálogo: o documento enviado nesse item é o que vale (não depende da IA).
      doc = porChave.get(f.chave) ?? null;
      if (!doc) {
        // Enviado na "versão" de produto/serviço do mesmo documento? Só serve com conferência humana.
        for (const eq of equivalentesDe(f.chave)) {
          const alt = porChave.get(eq);
          if (alt) {
            doc = alt;
            certeza = false;
            nota += ` O documento foi enviado como "${itemPorChave(eq)?.nome}" — confira se serve para esta exigência.`;
            break;
          }
        }
      }
    }
    // A IA só pode indicar um documento PERSONALIZADO ("Outros"). Um documento de outro item do
    // catálogo nunca atende esta exigência por indicação da IA — só vale no próprio item.
    if (!doc && f.docEmpresaId) {
      const indicado = porId.get(f.docEmpresaId);
      if (indicado && !chaveEfetivaDoDocumento(indicado)) doc = indicado;
    }

    const av = avaliarExigencia({
      doc: doc ? { id: doc.id, validade: doc.validade } : null,
      certeza,
      dataReferencia,
    });

    // Sem item do catálogo e sem documento achado, "não enviada" só vale quando a IA tem certeza.
    return {
      ordem: i,
      categoria: f.categoria,
      documento: f.documento,
      catalogoChave: f.chave,
      origem: f.origem,
      localizacao: f.localizacao,
      condicao: f.condicao,
      aplicavelSe: f.aplicavelSe,
      situacao: av.situacao,
      documentoEmpresaId: av.documentoEmpresaId,
      validade: av.validade,
      certezaMapeamento: certeza,
      observacao: av.observacao + nota,
      acaoSugerida: av.situacao === "ATENDIDA" ? null : (f.acaoSugerida ?? ACAO_PADRAO[av.situacao]),
      venceAntesDaSessao: av.venceAntesDaSessao,
    };
  });
}

async function gravarResultado(opts: {
  editalId: string;
  linhas: LinhaAvaliada[];
  dataReferencia: Date;
  leituraCompleta: boolean;
  docsLidos?: { nome: string; caracteres: number; ok: boolean }[];
  docsEmpresa: DocEmpresa[];
  mensagem?: string | null;
  /** Só na leitura completa: impressão digital do edital lido (ver fingerprintEdital). */
  editalFingerprint?: string;
  /**
   * Reavaliação por documento novo: se a documentação da empresa mudou enquanto este resultado era
   * calculado, ele já está velho — não grava (a reavaliação mais nova é quem vale).
   */
  descartarSeDocumentosMudaram?: { companyId: string };
  uso?: { haikuEntrada: number; haikuSaida: number; sonnetEntrada: number; sonnetSaida: number };
}) {
  const { editalId, linhas, dataReferencia, leituraCompleta, docsEmpresa } = opts;
  const r = calcularResultado({ situacoes: linhas.map((l) => l.situacao), leituraCompleta });

  // Preserva o aviso de vencimento já enviado para a mesma exigência (não repete a mensagem).
  const anteriores = await prisma.exigenciaHabilitacao.findMany({
    where: { editalId, alertadoEm: { not: null } },
    select: { documento: true, documentoEmpresaId: true, alertadoEm: true },
  });
  const alertadas = new Map(anteriores.map((a) => [`${a.documento}|${a.documentoEmpresaId}`, a.alertadoEm]));

  const dadosAuditoria: Prisma.AuditoriaHabilitacaoUpdateInput = {
    estado: "CONCLUIDA",
    mensagem: opts.mensagem ?? null,
    erroTipo: null,
    detalheTecnico: null,
    proximaTentativaEm: null,
    tentativasAutomaticas: 0,
    dataReferencia,
    totalExigencias: r.total,
    atendidas: r.atendidas,
    pendentes: r.pendentes,
    leituraCompleta,
    docsFingerprint: fingerprintDocumentos(docsEmpresa),
    ...(opts.editalFingerprint ? { editalFingerprint: opts.editalFingerprint } : {}),
    concluidaEm: new Date(),
    progresso: null,
    ...(opts.docsLidos ? { documentosLidos: JSON.stringify(opts.docsLidos) } : {}),
    ...(opts.uso ? { ...opts.uso, custoUsd: custoEstimadoUsd(opts.uso) } : {}),
  };

  // Trava por edital: duas gravações ao mesmo tempo (ex.: o analista anexa vários documentos seguidos e
  // cada envio dispara uma reavaliação) se atropelavam — cada uma apagava e recriava a lista, e o edital
  // ficava com as exigências duplicadas. Com a trava, uma espera a outra terminar.
  const gravado = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${editalId}))`;
      if (opts.descartarSeDocumentosMudaram) {
        const atuais = await tx.companyDocument.findMany({
          where: { companyId: opts.descartarSeDocumentosMudaram.companyId },
          select: { id: true, updatedAt: true },
        });
        if (fingerprintDocumentos(atuais) !== fingerprintDocumentos(docsEmpresa)) return false;
      }
      await tx.exigenciaHabilitacao.deleteMany({ where: { editalId } });
      await tx.exigenciaHabilitacao.createMany({
        data: linhas.map((l) => ({
          editalId,
          ...l,
          alertadoEm: alertadas.get(`${l.documento}|${l.documentoEmpresaId}`) ?? null,
        })),
      });
      await tx.auditoriaHabilitacao.update({ where: { editalId }, data: dadosAuditoria });
      await tx.edital.update({
        where: { id: editalId },
        data: { habilitacaoStatus: r.status, habilitacaoPercentual: r.percentual, habilitacaoAuditadaEm: new Date() },
      });
      return true;
    },
    { timeout: 20_000, maxWait: 15_000 }
  );

  return { ...r, gravado };
}

/** Avisa (e-mail/WhatsApp, uma vez por exigência) os documentos que vencem até 7 dias antes da sessão. */
async function avisarVencimentosProximos(editalId: string, dataReferencia: Date) {
  try {
    const linhas = await prisma.exigenciaHabilitacao.findMany({
      where: { editalId, venceAntesDaSessao: true, alertadoEm: null },
    });
    if (linhas.length === 0) return;
    const edital = await prisma.edital.findUnique({
      where: { id: editalId },
      select: { titulo: true, company: { select: { razaoSocial: true, whatsapp: true, user: { select: { email: true } } } } },
    });
    if (!edital) return;

    const sessaoBr = dataReferencia.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const hoje = Date.now();
    await notificarPrazosVencendo(
      { email: edital.company.user.email, whatsapp: edital.company.whatsapp, razaoSocial: edital.company.razaoSocial },
      linhas.map((l) => ({
        documentoNome: l.documento,
        editalTitulo: `${edital.titulo.slice(0, 80)} — sessão em ${sessaoBr}`,
        diasRestantes: l.validade ? Math.ceil((l.validade.getTime() - hoje) / 86_400_000) : 0,
      }))
    );
    await prisma.exigenciaHabilitacao.updateMany({ where: { id: { in: linhas.map((l) => l.id) } }, data: { alertadoEm: new Date() } });
  } catch (err) {
    console.error(`Falha ao avisar vencimentos próximos do edital ${editalId}:`, err);
  }
}

// ── Orquestração ────────────────────────────────────────────────────────────
//
// Regras de ouro:
//  - UMA execução nunca passa de ~46s de trabalho (a Vercel corta em 60s): cada passo checa o
//    relógio, a IA recebe um "sinal de parar" no prazo, e o progresso é salvo a cada avanço;
//  - o que não coube numa execução continua na seguinte (encadeada até MAX_CONTINUACOES_NA_CADEIA;
//    depois a fila retoma numa cadeia nova), sempre de onde parou — nada é refeito;
//  - TODA auditoria termina num estado final: concluída, erro com motivo, guardada por falta de
//    saldo, ou re-agendada. Nunca fica "rodando" para sempre (o vigia cobre o que escapar).

export type ResultadoExecucao = "concluida" | "continua" | "erro";

type OpcoesExecucao = {
  continuacao?: number;
  modo?: "completo" | "reconferir";
  origem?: string;
  /** Instante em que a requisição da Vercel começou (o relógio de 60s conta daqui). */
  inicio?: number;
};

const ESGOTOU = Symbol("esgotou");

/** Espera `promessa` por no máximo `ms`; se passar, devolve ESGOTOU (a promessa segue por conta própria). */
async function comPrazo<T>(promessa: Promise<T>, ms: number): Promise<T | typeof ESGOTOU> {
  promessa.catch(() => {}); // se perder a corrida e falhar depois, não vira erro solto
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<typeof ESGOTOU>((resolve) => {
    timer = setTimeout(() => resolve(ESGOTOU), Math.max(0, ms));
  });
  try {
    return await Promise.race([promessa, limite]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Roda `fn` sobre os itens, `paralelo` por vez, mas só começa um item novo enquanto
 * `podeComecar()` disser que ainda há tempo. Se um item falhar, para de começar novos e
 * relança o primeiro erro depois que os que já estavam em andamento terminarem.
 */
async function rodarComPrazo<T>(itens: T[], paralelo: number, podeComecar: () => boolean, fn: (item: T) => Promise<void>): Promise<void> {
  let proximo = 0;
  let erro: unknown = null;
  async function trabalhador() {
    while (proximo < itens.length && erro === null && podeComecar()) {
      const item = itens[proximo++];
      try {
        await fn(item);
      } catch (e) {
        if (erro === null) erro = e;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(paralelo, itens.length) }, trabalhador));
  if (erro !== null) throw erro;
}

export async function executarAuditoriaHabilitacao(editalId: string, opts: OpcoesExecucao = {}): Promise<ResultadoExecucao> {
  const continuacao = opts.continuacao ?? 0;
  const fimDoTrabalho = (opts.inicio ?? Date.now()) + ORCAMENTO_MS;
  const restante = () => fimDoTrabalho - Date.now();

  // A IA recebe este sinal: perto do fim do prazo as chamadas em andamento são interrompidas
  // (em vez de a função ser cortada no meio, sem salvar nada).
  const parar = new AbortController();
  const timer = setTimeout(() => parar.abort(), Math.max(1_000, restante() - MARGEM_FINAL_MS));

  let resultado: ResultadoExecucao = "erro";
  try {
    resultado = await rodar(editalId, { ...opts, continuacao }, restante, parar.signal);
    return resultado;
  } catch (err) {
    await registrarFalha(editalId, err, opts.modo === "reconferir");
    return "erro";
  } finally {
    clearTimeout(timer);
    // Terminou de vez: abre a vaga para a próxima da fila. Só quando a cadeia ainda aceita mais
    // um salto entre funções (limite da Vercel).
    if (resultado !== "continua" && continuacao < MAX_CONTINUACOES_NA_CADEIA) {
      await iniciarProximasDaFila({ origem: opts.origem }).catch(() => 0);
    }
  }
}

/** Assume a execução (estado "rodando"). false = já existe outra execução viva para este edital. */
async function assumirExecucao(editalId: string): Promise<boolean> {
  const dados = {
    estado: "RODANDO" as const,
    mensagem: null,
    erroTipo: null,
    detalheTecnico: null,
    proximaTentativaEm: null,
    tentativas: { increment: 1 },
  };
  const r = await prisma.auditoriaHabilitacao.updateMany({
    where: { editalId, NOT: { estado: "RODANDO", updatedAt: { gte: new Date(Date.now() - BATIMENTO_VIVO_MS) } } },
    data: dados,
  });
  if (r.count === 0) {
    if (await prisma.auditoriaHabilitacao.findUnique({ where: { editalId }, select: { id: true } })) return false;
    await prisma.auditoriaHabilitacao.create({ data: { editalId, estado: "RODANDO", tentativas: 1, solicitadaEm: new Date() } });
  }
  await prisma.edital.update({ where: { id: editalId }, data: { habilitacaoStatus: "AUDITANDO" } });
  return true;
}

async function rodar(
  editalId: string,
  opts: OpcoesExecucao & { continuacao: number },
  restante: () => number,
  sinal: AbortSignal
): Promise<ResultadoExecucao> {
  const { continuacao } = opts;
  const reconferindo = opts.modo === "reconferir";

  const edital = await prisma.edital.findUniqueOrThrow({
    where: { id: editalId },
    select: { id: true, companyId: true, titulo: true, dataAberturaProposta: true, dataEncerramentoProposta: true },
  });
  const dataReferencia = dataReferenciaDoEdital(edital);

  if (continuacao === 0) {
    // Disjuntor: sem saldo/chave nem começa — a auditoria fica guardada, sem gastar tentativa.
    await verificarIADisponivel();
    if (!reconferindo) {
      // Fila: no máximo LIMITE_AUDITORIAS_SIMULTANEAS rodando juntas.
      if (!(await haVaga(editalId))) {
        await colocarNaFila(editalId);
        return "continua";
      }
      if (!(await assumirExecucao(editalId))) return "continua"; // já há uma execução viva
    }
  } else {
    // Continuação: sinal de vida (o vigia só interrompe quem fica parado por muito tempo).
    await prisma.auditoriaHabilitacao.update({ where: { editalId }, data: { estado: "RODANDO" } });
  }

  const atual = await prisma.auditoriaHabilitacao.findUniqueOrThrow({ where: { editalId } });
  const uso = {
    haiku: { entrada: atual.haikuEntrada, saida: atual.haikuSaida } as UsoTokens,
    sonnet: { entrada: atual.sonnetEntrada, saida: atual.sonnetSaida } as UsoTokens,
  };
  const usoTotal = () => ({
    haikuEntrada: uso.haiku.entrada,
    haikuSaida: uso.haiku.saida,
    sonnetEntrada: uso.sonnet.entrada,
    sonnetSaida: uso.sonnet.saida,
  });

  // ── Só refazer a conferência (documentação da empresa mudou) — sem reler o edital ──
  if (reconferindo) {
    const linhas = await prisma.exigenciaHabilitacao.findMany({ where: { editalId }, orderBy: { ordem: "asc" } });
    if (linhas.length === 0) {
      // Nada para reconferir ainda: faz a auditoria completa.
      return rodar(editalId, { ...opts, modo: "completo", continuacao: 0 }, restante, sinal);
    }
    const docs = await carregarDocsDaEmpresa(edital.companyId);
    const empresa = await carregarFatosDaEmpresa(edital.companyId);
    // O que já foi decidido como "não se aplica a esta empresa" continua assim (não pergunta de novo).
    const jaNaoSeAplica: Final[] = linhas
      .filter((l) => l.situacao === "NAO_SE_APLICA")
      .map((l) => ({
        categoria: l.categoria,
        documento: l.documento,
        chave: l.catalogoChave,
        origem: l.origem,
        localizacao: l.localizacao,
        condicao: l.condicao,
        aplicavelSe: l.aplicavelSe,
        aplica: false,
        docEmpresaId: null,
        certeza: true,
        acaoSugerida: null,
      }));
    const brutas: Bruta[] = linhas
      .filter((l) => l.situacao !== "NAO_SE_APLICA")
      .map((l) => ({
        categoria: l.categoria,
        documento: l.documento,
        chave: l.catalogoChave,
        origem: l.origem,
        localizacao: l.localizacao,
        condicao: l.condicao,
        aplicavelSe: l.aplicavelSe,
      }));
    const finais = [...(await conferirComIA(brutas, docs, uso.sonnet, empresa, sinal)), ...jaNaoSeAplica];
    const avaliadas = avaliarTodas(finais, docs, dataReferencia);
    const r = await gravarResultado({
      editalId,
      linhas: avaliadas,
      dataReferencia,
      leituraCompleta: atual.leituraCompleta,
      docsEmpresa: docs,
      uso: usoTotal(),
    });
    await avisarVencimentosProximos(editalId, dataReferencia);
    await logAudit(editalId, NOME_AGENTE, "Conferência atualizada", r.status === "NAO_HABILITADA" ? "ALERTA" : "OK", `Documentação da empresa reconferida: ${r.atendidas} de ${r.total} exigências atendidas (${r.percentual}%).`);
    return "concluida";
  }

  // ── Leitura completa do processo, em passos ──
  const progresso: Progresso = atual.progresso ? (JSON.parse(atual.progresso) as Progresso) : { chunksTotal: 0, feitos: [], brutas: [] };
  progresso.passos = (progresso.passos ?? 0) + 1;
  progresso.falhas ??= {};
  progresso.lotes ??= {};
  let avancos = 0; // quanta coisa avançou neste passo (documentos, pedaços, lotes)
  let docsLidos: { nome: string; caracteres: number; ok: boolean; motivo?: MotivoArquivo }[] | null = null;
  let leituraCompleta = true;

  const salvar = () =>
    prisma.auditoriaHabilitacao.update({
      where: { editalId },
      data: {
        progresso: JSON.stringify(progresso),
        ...(docsLidos ? { documentosLidos: JSON.stringify(docsLidos), leituraCompleta } : {}),
        haikuEntrada: uso.haiku.entrada,
        haikuSaida: uso.haiku.saida,
        sonnetEntrada: uso.sonnet.entrada,
        sonnetSaida: uso.sonnet.saida,
      },
    });

  /** Não deu tempo de terminar: salva e passa o bastão (próxima execução, ou a fila numa cadeia nova). */
  const passarAdiante = async (): Promise<ResultadoExecucao> => {
    progresso.semAvanco = avancos > 0 ? 0 : (progresso.semAvanco ?? 0) + 1;
    await salvar();
    if (progresso.semAvanco >= MAX_PASSOS_SEM_AVANCO) {
      throw new ErroTipado("TEMPO_ESGOTADO", "A auditoria não avançou em passos seguidos.");
    }
    if (continuacao >= MAX_CONTINUACOES_NA_CADEIA) {
      await prisma.auditoriaHabilitacao.update({ where: { editalId }, data: { estado: "NA_FILA" } });
      return "continua";
    }
    const ok = await dispararAuditoriaHabilitacao(editalId, { continuacao: continuacao + 1, origem: opts.origem });
    if (!ok) await prisma.auditoriaHabilitacao.update({ where: { editalId }, data: { estado: "NA_FILA" } });
    return "continua";
  };

  // 1. Baixar e extrair o texto de cada arquivo (cada um com prazo próprio).
  const todos = await prisma.document.findMany({
    where: { editalId, tipo: { in: ["DOCUMENTO_PNCP", "DOCUMENTO_LICITANET", "DOCUMENTO_USUARIO"] } },
    orderBy: { createdAt: "asc" },
  });
  const { lidos } = selecionarDocumentos(todos);

  const textos = new Map<string, string>(); // id do documento → texto
  for (const d of lidos) if (d.textoExtraido) textos.set(d.id, d.textoExtraido);

  const aProcessar = lidos.filter((d) => !textos.has(d.id) && (progresso.falhas![d.id]?.n ?? 0) < FALHAS_ATE_DESISTIR_DO_ARQUIVO);
  await rodarComPrazo(aProcessar, 3, () => restante() > FOLGA_PREPARO_MS, async (d) => {
    const r = await prepararDocumento(d, edital.companyId, () => Math.min(LIMITE_ARQUIVO_MS, restante() - MARGEM_FINAL_MS));
    if (r.texto !== null) {
      textos.set(d.id, r.texto);
      delete progresso.falhas![d.id];
      avancos++;
    } else {
      progresso.falhas![d.id] = { n: (progresso.falhas![d.id]?.n ?? 0) + 1, motivo: r.motivo };
    }
  });

  docsLidos = lidos.map((d) => {
    const texto = textos.get(d.id);
    return {
      nome: d.nome,
      caracteres: texto?.length ?? 0,
      ok: !!texto && !texto.includes(MARCA_ILEGIVEL),
      ...(texto ? {} : { motivo: progresso.falhas![d.id]?.motivo ?? ("download" as MotivoArquivo) }),
    };
  });
  leituraCompleta = docsLidos.every((d) => d.ok);

  const aindaPendentes = lidos.filter((d) => !textos.has(d.id) && (progresso.falhas![d.id]?.n ?? 0) < FALHAS_ATE_DESISTIR_DO_ARQUIVO);
  if (aindaPendentes.length > 0) return passarAdiante();

  if (textos.size === 0) {
    await salvar();
    throw lidos.length === 0
      ? new ErroTipado("SEM_DOCUMENTO", "Este edital não tem nenhum documento para ler.")
      : new ErroTipado("ARQUIVO_ILEGIVEL", "Nenhum documento deste edital pôde ser baixado ou lido.");
  }

  // 2. Só os trechos de habilitação vão para a IA; os mais relevantes são lidos primeiro.
  const pedacos: Pedaco[] = lidos
    .filter((d) => textos.has(d.id))
    .flatMap((d) => {
      const selecionado = selecionarTrechosDeHabilitacao(textos.get(d.id)!);
      const partes = dividirEmPedacos(selecionado.texto);
      return partes.map((p, i) => ({ docNome: d.nome, indice: i, total: partes.length, texto: p, densidade: densidadeDeHabilitacao(p) }));
    })
    .sort((a, b) => b.densidade - a.densidade);

  const plano = createHash("sha1").update(pedacos.map((p) => `${p.docNome}:${p.indice}:${p.texto.length}`).join("|")).digest("hex");
  if (progresso.plano !== plano) {
    // O conjunto de pedaços mudou (ex.: um arquivo que faltava foi lido): recomeça a leitura.
    progresso.plano = plano;
    progresso.feitos = [];
    progresso.brutas = [];
    progresso.lotes = {};
  }
  progresso.chunksTotal = pedacos.length;
  if (pedacos.length > LIMITE_PEDACOS_GRANDE) {
    await prisma.edital.update({ where: { id: editalId }, data: { habilitacaoStatus: "EDITAL_GRANDE" } });
  }

  // 3. Levantar as exigências, pedaço por pedaço (salvando a cada um).
  const faltam = pedacos.map((_, i) => i).filter((i) => !progresso.feitos.includes(i));
  if (faltam.length > 0) {
    try {
      await rodarComPrazo(faltam, PEDACOS_EM_PARALELO, () => restante() > FOLGA_NOVO_PEDACO_MS, async (i) => {
        try {
          const brutas = await extrairDoPedaco(pedacos[i], uso.haiku, sinal);
          progresso.feitos.push(i);
          progresso.brutas.push(...brutas);
          avancos++;
          await salvar();
        } catch (e) {
          if (sinal.aborted) return; // prazo: o pedaço fica para a próxima execução
          throw e;
        }
      });
    } finally {
      await salvar().catch(() => null);
    }
  }
  const faltamAinda = pedacos.map((_, i) => i).filter((i) => !progresso.feitos.includes(i));
  if (faltamAinda.length > 0) {
    if ((progresso.passos ?? 0) < MAX_PASSOS_LEITURA) return passarAdiante();
    // Edital gigante: depois de muitos passos, fecha com o que já foi lido (nunca recusa) — o
    // resultado fica com ressalva e o aviso de leitura incompleta.
    leituraCompleta = false;
  }

  // 4. Conferência com a documentação da empresa, lote a lote (salvando a cada um).
  const brutas = removerDuplicadas(progresso.brutas);
  if (brutas.length === 0) {
    throw new ErroTipado(
      "SEM_EXIGENCIAS",
      "Nenhuma exigência de documento de habilitação foi encontrada nos documentos lidos. Se o edital as exige, confira se o arquivo do edital está completo."
    );
  }
  const docs = await carregarDocsDaEmpresa(edital.companyId);
  const empresa = await carregarFatosDaEmpresa(edital.companyId);
  const ctx = contextoDeConferencia(docs, empresa);
  const lotes = montarLotes(brutas);
  const lotesFaltam = lotes.map((_, i) => i).filter((i) => !progresso.lotes![String(i)]);
  if (lotesFaltam.length > 0) {
    try {
      await rodarComPrazo(lotesFaltam, 4, () => restante() > FOLGA_NOVO_LOTE_MS, async (i) => {
        try {
          progresso.lotes![String(i)] = await conferirLote(lotes[i], ctx, uso.sonnet, sinal);
          avancos++;
          await salvar();
        } catch (e) {
          if (sinal.aborted) return;
          throw e;
        }
      });
    } finally {
      await salvar().catch(() => null);
    }
  }
  if (lotes.some((_, i) => !progresso.lotes![String(i)])) return passarAdiante();

  const finais = lotes.flatMap((_, i) => progresso.lotes![String(i)]);
  if (finais.length === 0) throw new ErroTipado("RESPOSTA_INVALIDA", "A conferência final não devolveu resultado.");
  const avaliadas = avaliarTodas(finais, docs, dataReferencia);

  const r = await gravarResultado({
    editalId,
    linhas: avaliadas,
    dataReferencia,
    leituraCompleta,
    docsLidos,
    docsEmpresa: docs,
    editalFingerprint: fingerprintEdital(todos, edital),
    uso: usoTotal(),
  });
  await avisarVencimentosProximos(editalId, dataReferencia);

  const aviso = leituraCompleta ? "" : " Atenção: algum documento do processo não pôde ser lido por inteiro — o resultado nunca fica como \"Habilitada\" sem ressalva.";
  await logAudit(
    editalId,
    NOME_AGENTE,
    "Auditoria de habilitação",
    r.status === "HABILITADA" ? "OK" : "ALERTA",
    `${r.atendidas} de ${r.total} exigências de habilitação atendidas (${r.percentual}%) — ${
      r.status === "HABILITADA" ? "Habilitada" : r.status === "HABILITADA_RESSALVAS" ? "Habilitada com ressalvas" : "Não habilitada"
    }.${aviso}`
  );
  return "concluida";
}

/**
 * Baixa (se preciso) e extrai o texto de UM arquivo, cada etapa com prazo. Nunca lança: devolve
 * o texto ou o motivo da falha, para a tela dizer QUAL arquivo deu problema e o que fazer.
 */
async function prepararDocumento(
  d: DocumentRow,
  companyId: string,
  limiteMs: () => number
): Promise<{ texto: string; motivo?: undefined } | { texto: null; motivo: MotivoArquivo }> {
  try {
    let doc = d;
    const precisaBaixar = (d.tipo === "DOCUMENTO_PNCP" || d.tipo === "DOCUMENTO_LICITANET") && !d.conteudoBase64 && !d.storagePath && !!d.origemUrl;
    if (precisaBaixar) {
      let baixou = false;
      try {
        const r = await comPrazo(
          baixarEPersistirDocumento({ id: d.id, editalId: d.editalId, nome: d.nome, tipo: d.tipo, origemUrl: d.origemUrl! }, companyId),
          limiteMs()
        );
        if (r === ESGOTOU) return { texto: null, motivo: "demorou" };
        baixou = true;
      } catch (err) {
        console.error(`Falha ao baixar "${d.nome}" (edital ${d.editalId}):`, err);
        return { texto: null, motivo: "download" };
      }
      if (baixou) doc = await prisma.document.findUniqueOrThrow({ where: { id: d.id } });
    }
    const texto = await comPrazo(obterTextoBrutoDocumento(doc), limiteMs());
    if (texto === ESGOTOU) return { texto: null, motivo: "demorou" };
    if (!texto) return { texto: null, motivo: "formato" };
    return { texto };
  } catch (err) {
    console.error(`Falha ao preparar "${d.nome}" (edital ${d.editalId}):`, err);
    return { texto: null, motivo: "formato" };
  }
}

/**
 * Registra uma falha com o destino certo: guardada (sem saldo/chave), nova tentativa automática
 * agendada (erro passageiro, com espera crescente) ou erro final com o motivo em linguagem simples.
 * Nunca deixa a auditoria "rodando".
 */
async function registrarFalha(editalId: string, err: unknown, reconferindo: boolean) {
  // O detalhe técnico (com request_id etc.) vai só para o log do servidor e para o campo
  // interno; a tela recebe sempre o texto amigável do tipo do erro.
  const c = classificarErro(err);
  console.error(`Auditoria de habilitação do edital ${editalId} falhou [${c.tipo}]:`, c.detalheTecnico);

  try {
    // Numa reconferência o resultado anterior continua valendo: só registra o problema.
    const temResultado = reconferindo && (await prisma.exigenciaHabilitacao.count({ where: { editalId } })) > 0;
    if (temResultado) {
      await prisma.auditoriaHabilitacao.update({
        where: { editalId },
        data: { estado: "CONCLUIDA", mensagem: null, erroTipo: c.tipo, detalheTecnico: c.detalheTecnico, proximaTentativaEm: null },
      });
      return;
    }

    const aud = await prisma.auditoriaHabilitacao.findUnique({ where: { editalId }, select: { tentativasAutomaticas: true } });
    const decisao = decidirAposFalha(c.tipo, aud?.tentativasAutomaticas ?? 0);
    let dados: Prisma.AuditoriaHabilitacaoUpdateInput;
    let status: HabilitacaoStatus;
    let aviso: string;

    if (decisao.acao === "aguardar_ia") {
      dados = { estado: "AGUARDANDO_SALDO", mensagem: c.mensagemUsuario, proximaTentativaEm: new Date(Date.now() + PAUSA_MS) };
      status = statusHabilitacaoDoErro(c.tipo);
      aviso = c.mensagemUsuario;
    } else if (decisao.acao === "tentar_de_novo") {
      const msg = mensagemDeRetentativaDoTipo(c.tipo);
      dados = { estado: "ERRO", mensagem: msg, proximaTentativaEm: new Date(Date.now() + decisao.esperaMs) };
      status = statusHabilitacaoDoErro(c.tipo);
      aviso = `${msg} Nova tentativa em cerca de ${Math.round(decisao.esperaMs / 60_000)} min.`;
    } else {
      const msg = mensagemDefinitivaDoTipo(c.tipo);
      dados = { estado: "ERRO", mensagem: msg, proximaTentativaEm: null };
      status = statusHabilitacaoDefinitivaDoErro(c.tipo);
      aviso = msg;
    }

    const data = { ...dados, erroTipo: c.tipo, detalheTecnico: c.detalheTecnico };
    await prisma.auditoriaHabilitacao.upsert({
      where: { editalId },
      create: { ...(data as Omit<Prisma.AuditoriaHabilitacaoUncheckedCreateInput, "editalId">), editalId },
      update: data,
    });
    if (!reconferindo) await prisma.edital.update({ where: { id: editalId }, data: { habilitacaoStatus: status } });
    await logAudit(editalId, NOME_AGENTE, "Auditoria de habilitação", "ERRO", aviso);
  } catch (e) {
    // Último recurso: nem o registro da falha pode derrubar o processo.
    console.error(`Não foi possível registrar a falha da auditoria do edital ${editalId}:`, e);
  }
}

// ── Gatilhos ────────────────────────────────────────────────────────────────

/**
 * A documentação da empresa mudou (enviou, substituiu, alterou validade ou removeu): refaz a
 * conferência dos editais abertos já auditados. A parte de decidir validade é só conta (grátis);
 * quando há exigência fora do catálogo ainda pendente, pede também uma reconferência com a IA.
 */
export async function reavaliarEditaisDaEmpresa(companyId: string, origem?: string, opts: { editalId?: string } = {}) {
  const editais = await prisma.edital.findMany({
    where: opts.editalId
      ? // Pedido para UM edital (o analista anexou um documento nele): reavalia mesmo com a sessão encerrada.
        { id: opts.editalId, companyId, habilitacaoStatus: { in: ["HABILITADA", "HABILITADA_RESSALVAS", "NAO_HABILITADA"] } }
      : {
          companyId,
          etapaKanban: { not: "RASCUNHO" },
          habilitacaoStatus: { in: ["HABILITADA", "HABILITADA_RESSALVAS", "NAO_HABILITADA"] },
          OR: [{ dataEncerramentoProposta: null }, { dataEncerramentoProposta: { gt: new Date() } }],
        },
    select: { id: true, titulo: true, etapaKanban: true, dataAberturaProposta: true, dataEncerramentoProposta: true },
    take: 60,
  });
  if (editais.length === 0) return;

  const docs = await carregarDocsDaEmpresa(companyId);
  const fingerprint = fingerprintDocumentos(docs);
  let reconferirComIA = 0;

  for (const edital of editais) {
    try {
      const aud = await prisma.auditoriaHabilitacao.findUnique({ where: { editalId: edital.id } });
      if (!aud || aud.estado === "RODANDO" || aud.docsFingerprint === fingerprint) continue;

      const linhas = await prisma.exigenciaHabilitacao.findMany({ where: { editalId: edital.id }, orderBy: { ordem: "asc" } });
      if (linhas.length === 0) continue;
      const dataReferencia = dataReferenciaDoEdital(edital);

      const avaliadas = avaliarTodas(
        linhas.map((l) => ({
          categoria: l.categoria,
          documento: l.documento,
          chave: l.catalogoChave,
          origem: l.origem,
          localizacao: l.localizacao,
          condicao: l.condicao,
          aplicavelSe: l.aplicavelSe,
          // Decisão anterior sobre a exigência valer ou não para a empresa continua (não dá para saber = null).
          aplica: l.situacao === "NAO_SE_APLICA" ? false : l.aplicavelSe ? (l.certezaMapeamento ? true : null) : true,
          // Mapeamento já decidido antes (documento personalizado) continua valendo se o documento ainda existe.
          docEmpresaId: l.catalogoChave ? null : l.documentoEmpresaId,
          certeza: l.catalogoChave ? true : l.certezaMapeamento,
          acaoSugerida: l.acaoSugerida,
        })),
        docs,
        dataReferencia
      );
      const gravacao = await gravarResultado({
        editalId: edital.id,
        linhas: avaliadas,
        dataReferencia,
        leituraCompleta: aud.leituraCompleta,
        docsEmpresa: docs,
        descartarSeDocumentosMudaram: { companyId },
      });
      // Os documentos mudaram durante o cálculo: outra reavaliação, mais nova, já cuida deste edital.
      if (!gravacao.gravado) continue;
      await avisarVencimentosProximos(edital.id, dataReferencia);

      // Exigência fora do catálogo ainda sem documento: um documento personalizado novo pode atendê-la.
      // A reconferência com IA custa dinheiro: só para editais que auditam (Qualificação em diante).
      const temForaDoCatalogoPendente = avaliadas.some((a) => !a.catalogoChave && a.situacao !== "ATENDIDA");
      if (temForaDoCatalogoPendente && etapaAudita(edital.etapaKanban) && reconferirComIA < 5) {
        reconferirComIA++;
        await dispararAuditoriaHabilitacao(edital.id, { modo: "reconferir", origem });
      }
    } catch (err) {
      console.error(`Falha ao reavaliar a habilitação do edital ${edital.id}:`, err);
    }
  }
}
