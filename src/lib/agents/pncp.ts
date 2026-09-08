// Cliente para a API pública do PNCP (Portal Nacional de Contratações Públicas).
// Endpoints reais e não autenticados, confirmados em https://pncp.gov.br/api/search e
// https://pncp.gov.br/pncp-consulta/v3/api-docs.

const SEARCH_BASE = "https://pncp.gov.br/api/search/";
const CONSULTA_BASE = "https://pncp.gov.br/pncp-consulta";
const PNCP_API_BASE = "https://pncp.gov.br/api/pncp";

// O PNCP rejeita (ECONNRESET) requisições sem um User-Agent de navegador.
const PNCP_HEADERS = {
  Accept: "application/json",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
};

export type PncpSearchItem = {
  numero_controle_pncp: string;
  title: string;
  description: string;
  item_url: string;
  orgao_nome: string;
  orgao_cnpj: string;
  municipio_nome: string | null;
  uf: string | null;
  modalidade_licitacao_nome: string | null;
  situacao_nome: string | null;
  data_publicacao_pncp: string | null;
  data_inicio_vigencia: string | null;
  data_fim_vigencia: string | null;
  valor_global: number | null;
};

export type PncpSearchResponse = {
  items: PncpSearchItem[];
  total: number;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * fetch com timeout: o PNCP às vezes não responde nem com erro nem com sucesso
 * (conexão fica pendurada) — sem isso, uma chamada travada deixaria a requisição
 * inteira do usuário presa indefinidamente.
 */
async function fetchComTimeout(url: string, timeoutMs = 10_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { headers: PNCP_HEADERS, cache: "no-store", signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function searchEditaisPorPalavraChave(
  termo: string,
  pagina = 1,
  tamPagina = 15
): Promise<PncpSearchItem[]> {
  const url = new URL(SEARCH_BASE);
  url.searchParams.set("q", termo);
  url.searchParams.set("tipos_documento", "edital");
  url.searchParams.set("ordenacao", "-data");
  url.searchParams.set("pagina", String(pagina));
  url.searchParams.set("tam_pagina", String(tamPagina));
  url.searchParams.set("status", "recebendo_proposta");

  // O PNCP tem instabilidades intermitentes (502/503, ou a conexão trava sem
  // responder nada); algumas tentativas curtas costumam resolver sem precisar
  // propagar o erro para o usuário.
  let res: Response | null = null;
  let lastStatus = 0;
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    if (tentativa > 0) await sleep(600 * tentativa);
    try {
      res = await fetchComTimeout(url.toString());
    } catch {
      continue; // timeout ou erro de rede: tenta de novo
    }
    lastStatus = res.status;
    if (res.ok) break;
    if (![502, 503, 504].includes(res.status)) break;
  }

  if (!res || !res.ok) {
    throw new Error(`PNCP search indisponível no momento (${lastStatus}) para termo "${termo}"`);
  }

  const data = (await res.json()) as PncpSearchResponse;
  return data.items ?? [];
}

export type PncpCompraDetalhe = {
  objetoCompra: string;
  informacaoComplementar: string | null;
  amparoLegal: { nome?: string; descricao?: string } | null;
  valorTotalEstimado: number | null;
  indicadorOrcamentoSigiloso: boolean | null;
  orcamentoSigilosoDescricao: string | null;
  modalidadeNome: string | null;
  modoDisputaNome: string | null;
  dataAberturaProposta: string | null;
  dataEncerramentoProposta: string | null;
  orgaoEntidade: { razaoSocial?: string; cnpj?: string } | null;
  unidadeOrgao: { ufSigla?: string; municipioNome?: string } | null;
  numeroControlePNCP: string;
};

/** Extrai cnpj/ano/sequencial a partir do item_url retornado pela busca (/compras/{cnpj}/{ano}/{sequencial}) */
export function parseItemUrl(itemUrl: string) {
  const parts = itemUrl.split("/").filter(Boolean);
  const [, cnpj, ano, sequencial] = parts;
  return { cnpj, ano, sequencial };
}

export async function buscarDetalheCompra(
  cnpj: string,
  ano: string,
  sequencial: string
): Promise<PncpCompraDetalhe | null> {
  const url = `${CONSULTA_BASE}/v1/orgaos/${cnpj}/compras/${ano}/${sequencial}`;
  const res = await fetchComTimeout(url).catch(() => null);
  if (!res || !res.ok) return null;
  return (await res.json()) as PncpCompraDetalhe;
}

export type PncpArquivo = {
  sequencialDocumento: number;
  titulo: string;
  url: string;
  tipoDocumentoId: number;
  tipoDocumentoNome: string;
  statusAtivo: boolean;
};

// IDs oficiais em /v1/tipos-documentos: 2=Edital, 1=Aviso de Contratação Direta
// (equivalente ao edital nas modalidades de dispensa/inexigibilidade).
const EDITAL_TIPO_IDS = new Set([2, 1]);
// 4=Termo de Referência, 31=Termo de Referência (TR) (variante usada em IRP).
const TERMO_REFERENCIA_TIPO_IDS = new Set([4, 31]);

export async function buscarArquivosCompra(
  cnpj: string,
  ano: string,
  sequencial: string
): Promise<PncpArquivo[]> {
  const url = `${PNCP_API_BASE}/v1/orgaos/${cnpj}/compras/${ano}/${sequencial}/arquivos`;
  const res = await fetchComTimeout(url).catch(() => null);
  if (!res || !res.ok) return [];
  const data = (await res.json()) as PncpArquivo[];
  return data.filter((doc) => doc.statusAtivo);
}

/** Dentre os arquivos da contratação, identifica o edital (ou aviso equivalente) e o termo de referência. */
export function selecionarDocumentosPrincipais(arquivos: PncpArquivo[]) {
  const edital = arquivos.find((a) => EDITAL_TIPO_IDS.has(a.tipoDocumentoId)) ?? null;
  const termoReferencia = arquivos.find((a) => TERMO_REFERENCIA_TIPO_IDS.has(a.tipoDocumentoId)) ?? null;
  return { edital, termoReferencia };
}

export async function baixarArquivoPncp(url: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  // Arquivos (PDFs) podem ser maiores que as respostas JSON — timeout mais generoso.
  const res = await fetchComTimeout(url, 20_000).catch(() => null);
  if (!res || !res.ok) return null;
  const buffer = await res.arrayBuffer();
  return { bytes: new Uint8Array(buffer), contentType: res.headers.get("content-type") ?? "application/pdf" };
}

/**
 * Monta o link para a página pública da contratação no site do PNCP.
 * A API de busca (item_url) retorna o caminho com o prefixo "/compras/", mas o
 * app do PNCP só resolve essa rota sob "/editais/" — por isso a troca de prefixo.
 */
export function linkPortalCompra(itemUrl: string) {
  const caminho = itemUrl.replace(/^\/compras\//, "/editais/");
  return `https://pncp.gov.br/app${caminho}`;
}
