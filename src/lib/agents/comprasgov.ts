// Cliente para a API pública "dadosabertos.compras.gov.br" (Compras.gov.br) — endpoints
// confirmados contra o OpenAPI real em https://dadosabertos.compras.gov.br/v3/api-docs e
// testados diretamente (não só lidos na doc). Cobre só o módulo "06 - LEGADO" (licitações
// sob a Lei 8.666/1993): o módulo "07 - CONTRATAÇÕES" (Lei 14.133/2021) espelha os mesmos
// dados que já vêm do PNCP, então não adiciona cobertura nova.
//
// Limitação real confirmada: esta API não expõe NENHUM endpoint de documento/anexo (só
// metadados estruturados) — diferente do PNCP e do LicitaNet, editais capturados aqui nunca
// têm um PDF pra baixar. Os agentes rodam normalmente em modo "sem texto completo"
// (baseadoEmTextoCompleto: false), o mesmo fallback já usado hoje quando um PDF falha ao
// baixar — nada quebra, só a análise fica mais rasa até o usuário anexar o edital manualmente
// (Adicionar PDF).
//
// Achado adicional: como a Lei 14.133/2021 já é obrigatória pra novas contratações federais
// desde 2024, o volume de licitações NOVAS neste módulo legado tende a ser baixo e cadente —
// é mais útil pra achar processos antigos ainda em andamento do que como fonte principal de
// oportunidades novas.

const BASE = "https://dadosabertos.compras.gov.br";
const HEADERS = {
  Accept: "application/json",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchComTimeout(url: string, timeoutMs = 10_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { headers: HEADERS, cache: "no-store", signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function getComRetry(url: string, contexto: string): Promise<Response> {
  let res: Response | null = null;
  let lastStatus = 0;
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    if (tentativa > 0) await sleep(600 * tentativa);
    try {
      res = await fetchComTimeout(url);
    } catch {
      continue;
    }
    lastStatus = res.status;
    if (res.ok) break;
    if (![502, 503, 504].includes(res.status)) break;
  }
  if (!res || !res.ok) {
    throw new Error(`Compras.gov.br indisponível no momento (${lastStatus}) — ${contexto}`);
  }
  return res;
}

// Campos confirmados numa chamada real ao endpoint (não só na doc) — ver comentário acima.
export type ComprasGovLicitacao = {
  id_compra: string;
  numero_processo: string;
  uasg: number;
  modalidade: number;
  nome_modalidade: string;
  numero_aviso: number;
  situacao_aviso: string;
  objeto: string;
  informacoes_gerais: string | null;
  numero_itens: number;
  valor_estimado_total: number | null;
  endereco_entrega_edital: string | null;
  codigo_municipio_uasg: number | null;
  data_abertura_proposta: string | null;
  data_publicacao: string | null;
  dt_alteracao: string;
  pertence14133: boolean;
};

type RespostaLicitacoes = {
  resultado: ComprasGovLicitacao[];
  totalRegistros: number;
  totalPaginas: number;
};

function formatarDataApi(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD, formato exigido por esta API
}

/**
 * Busca licitações do módulo legado publicadas num intervalo de datas — esta API não tem
 * busca por palavra-chave livre (diferente do PNCP), então o filtro por relevância acontece
 * depois, no chamador, comparando contra `objeto` (ver agente1-comercial.ts).
 */
export async function buscarLicitacoesComprasGov(diasParaTras = 45): Promise<ComprasGovLicitacao[]> {
  const hoje = new Date();
  const inicio = new Date(hoje.getTime() - diasParaTras * 24 * 60 * 60 * 1000);

  const url = new URL(`${BASE}/modulo-legado/1_consultarLicitacao`);
  url.searchParams.set("pagina", "1");
  url.searchParams.set("tamanhoPagina", "500");
  url.searchParams.set("data_publicacao_inicial", formatarDataApi(inicio));
  url.searchParams.set("data_publicacao_final", formatarDataApi(hoje));

  const res = await getComRetry(url.toString(), "busca de licitações do módulo legado");
  const data = (await res.json()) as RespostaLicitacoes;
  return data.resultado ?? [];
}

export type ComprasGovUasg = { codigo: number; nome: string; cnpj: string | null; municipio: string | null; uf: string | null };

const cacheUasg = new Map<number, ComprasGovUasg | null>();

/** Resolve nome/UF do órgão a partir do código da UASG — cacheado em memória no processo
 * (não muda durante uma execução do Agente Comercial), evita 1 chamada por licitação. */
export async function resolverUasg(codigoUasg: number): Promise<ComprasGovUasg | null> {
  if (cacheUasg.has(codigoUasg)) return cacheUasg.get(codigoUasg)!;

  const url = new URL(`${BASE}/modulo-uasg/1_consultarUasg`);
  url.searchParams.set("codigoUasg", String(codigoUasg));
  url.searchParams.set("statusUasg", "true");

  try {
    const res = await getComRetry(url.toString(), `dados da UASG ${codigoUasg}`);
    const data = (await res.json()) as {
      resultado?: { nomeUasg?: string; cnpjCpfOrgao?: string; nomeMunicipioIbge?: string; siglaUf?: string }[];
    };
    const item = data.resultado?.[0];
    const uasg: ComprasGovUasg | null = item
      ? {
          codigo: codigoUasg,
          nome: item.nomeUasg ?? `UASG ${codigoUasg}`,
          cnpj: item.cnpjCpfOrgao ?? null,
          municipio: item.nomeMunicipioIbge ?? null,
          uf: item.siglaUf ?? null,
        }
      : null;
    cacheUasg.set(codigoUasg, uasg);
    return uasg;
  } catch {
    cacheUasg.set(codigoUasg, null);
    return null;
  }
}

// Link de consulta pública do Comprasnet legado — mesmo padrão de URL usado historicamente
// pelo portal (coduasg/modprp/numprp). Best-effort: como esta API não devolve uma URL de
// consulta pronta, é montada aqui; se o formato mudar no portal, o usuário ainda encontra o
// processo buscando numero_processo/numero_aviso manualmente no Compras.gov.br.
export function linkComprasGov(item: ComprasGovLicitacao): string {
  const numeroPregao = String(item.numero_aviso).padStart(6, "0");
  return `https://www.comprasnet.gov.br/ConsultaLicitacoes/ConsultaLicitacao_Detalhe.asp?coduasg=${item.uasg}&modprp=${item.modalidade}&numprp=${numeroPregao}`;
}
