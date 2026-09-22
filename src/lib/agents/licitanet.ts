// Cliente para o boletim público do LicitaNet (https://licitanet.com.br/boletim).
// Não existe uma API documentada — a página é uma SPA Inertia.js (Laravel) cujo HTML
// inicial já traz todos os dados da listagem embutidos num atributo `data-page`
// (JSON), então não precisamos executar JavaScript nem chamar nada sob `/api/` (que o
// robots.txt do site proíbe explicitamente) — só buscamos a própria página `/boletim`,
// permitida pelo robots.txt, e lemos o JSON que ela já entrega.

const BASE_URL = "https://licitanet.com.br";

// O LicitaNet rejeita (403) requisições sem um User-Agent de navegador — mesmo
// comportamento documentado para o PNCP em pncp.ts.
const LICITANET_HEADERS = {
  Accept: "text/html",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
};

export type LicitaNetNotice = { identifier: number; name: string; link: string };

export type LicitaNetPublication = {
  identifier: number;
  status: string;
  description: string;
  datPublication: string | null;
  datStartSession: string | null;
  datFinishSession: string | null;
  buyer: string;
  document: string; // CNPJ do órgão
  city: string | null;
  uf: string | null;
  biddingProcess: string;
  disputeModeText: string | null;
  acquisition: string | null;
  notices: LicitaNetNotice[];
  files: LicitaNetNotice[];
};

/** Só nos interessam oportunidades ainda abertas — o boletim traz também processos já
 * homologados, revogados, fracassados ou desertos misturados na mesma listagem. */
const STATUS_ABERTO = "RECEBENDO PROPOSTA";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchComTimeout(url: string, timeoutMs = 10_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { headers: LICITANET_HEADERS, cache: "no-store", signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Extrai e decodifica o JSON embutido em `data-page="..."` do HTML da página Inertia. */
function extrairDataPage(html: string): { component: string; props: Record<string, unknown> } | null {
  const m = html.match(/data-page="([^"]*)"/);
  if (!m) return null;
  const decodificado = m[1]
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
  try {
    return JSON.parse(decodificado);
  } catch {
    return null;
  }
}

/**
 * Busca publicações do boletim para um segmento — mesma URL que um usuário logado
 * navegaria manualmente (`/boletim?codSegments=X&limit=Y&page=1`). Devolve só as que
 * ainda estão recebendo proposta; o parâmetro do site não filtra por status, então
 * fazemos isso aqui.
 */
export async function buscarPublicacoesLicitaNet(
  segmentoId: number,
  maxResultados = 100
): Promise<LicitaNetPublication[]> {
  const url = new URL(`${BASE_URL}/boletim`);
  url.searchParams.set("codSegments", String(segmentoId));
  url.searchParams.set("limit", String(Math.min(Math.max(maxResultados, 1), 100)));
  url.searchParams.set("page", "1");

  let res: Response | null = null;
  let lastStatus = 0;
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    if (tentativa > 0) await sleep(600 * tentativa);
    try {
      res = await fetchComTimeout(url.toString());
    } catch {
      continue;
    }
    lastStatus = res.status;
    if (res.ok) break;
    if (![502, 503, 504].includes(res.status)) break;
  }

  if (!res || !res.ok) {
    throw new Error(`LicitaNet indisponível no momento (${lastStatus}) para o segmento ${segmentoId}`);
  }

  const html = await res.text();
  const page = extrairDataPage(html);
  const publications = page?.props?.publications as { data?: LicitaNetPublication[] } | undefined;
  const data = publications?.data ?? [];

  return data.filter((p) => p.status === STATUS_ABERTO);
}

/**
 * Baixa um arquivo hospedado pelo LicitaNet (edital em .zip ou anexo em PDF) — sem
 * cabeçalhos especiais, os links de documento já são hospedados em CDN pública. Mesmo
 * padrão de retry de baixarArquivoPncp (o download precisa ser confiável, a análise por
 * IA só roda depois dele) — lança em vez de devolver null na falha final.
 */
export async function baixarArquivoLicitaNet(url: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  let res: Response | null = null;
  let lastStatus = 0;
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    if (tentativa > 0) await sleep(600 * tentativa);
    try {
      res = await fetchComTimeout(url, 20_000);
    } catch {
      continue;
    }
    lastStatus = res.status;
    if (res.ok) break;
    if (![502, 503, 504].includes(res.status)) break;
  }

  if (!res || !res.ok) {
    throw new Error(`Não foi possível baixar o arquivo do LicitaNet (${lastStatus}): ${url}`);
  }

  const buffer = await res.arrayBuffer();
  return { bytes: new Uint8Array(buffer), contentType: res.headers.get("content-type") ?? "application/octet-stream" };
}

/**
 * Converte "DD/MM/AAAA HH:mm:ss" ou "DD/MM/AAAA" (formato usado pelo LicitaNet) para
 * Date — o parser nativo do JS não lida com esse formato de forma confiável.
 */
export function parseDataBr(valor: string | null): Date | null {
  if (!valor) return null;
  const m = valor.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?/);
  if (!m) return null;
  const [, dia, mes, ano, hora = "00", minuto = "00", segundo = "00"] = m;
  const data = new Date(Number(ano), Number(mes) - 1, Number(dia), Number(hora), Number(minuto), Number(segundo));
  return Number.isNaN(data.getTime()) ? null : data;
}

/** Link de referência à origem — o LicitaNet não expõe uma página pública por
 * publicação (a área do comprador fica atrás de login), então apontamos para o próprio
 * boletim filtrado pelo segmento, onde a oportunidade aparece. */
export function linkBoletimSegmento(segmentoId: number) {
  return `${BASE_URL}/boletim?codSegments=${segmentoId}`;
}
