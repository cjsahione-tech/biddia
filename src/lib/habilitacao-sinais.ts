// Sinais que o texto lido dá de que a leitura automática NÃO é suficiente — viram aviso de "revisar manualmente":
//  - o edital manda buscar um anexo em um link externo (que o sistema não baixa);
//  - o edital e outro documento (TR, anexo) pedem coisas diferentes para o mesmo documento de habilitação.

/** Sites onde o sistema já busca os arquivos (ou que são o próprio portal da disputa): um link para eles não é "anexo externo". */
const SITES_DO_PROPRIO_PROCESSO = /pncp\.gov\.br|gov\.br\/compras|comprasnet|compras\.gov|comprasgovernamentais|licitanet|bll\.org|bnc\.org\.br|portaldecompraspublicas|licitacoes-e|bbmnet/i;

const ANEXO_PEDIDO = /anexo|termo de refer[êe]ncia|projeto b[áa]sico|planilha|memorial|caderno|cronograma|modelo/i;
const DISPONIBILIDADE = /dispon[ií]ve(l|is)|obt[eê]m?|obtido|acess|baix|download|consult|encontr|publicad/i;

export type AnexoExterno = { link: string; trecho: string };

/**
 * Procura frases do tipo "o Anexo II está disponível em https://...", cujo link não é um dos portais que o sistema já lê.
 * Conservador de propósito: é um aviso para revisão, e avisar à toa cansa o analista.
 */
export function detectarAnexosExternos(texto: string, maximo = 3): AnexoExterno[] {
  const achados: AnexoExterno[] = [];
  const vistos = new Set<string>();
  for (const m of texto.matchAll(/https?:\/\/[^\s)>\]"']+/gi)) {
    const link = m[0].replace(/[.,;:]+$/, "");
    if (SITES_DO_PROPRIO_PROCESSO.test(link) || vistos.has(link)) continue;
    const i = m.index ?? 0;
    const trecho = texto.slice(Math.max(0, i - 220), i).replace(/\s+/g, " ").trim();
    if (ANEXO_PEDIDO.test(trecho) && DISPONIBILIDADE.test(trecho)) {
      vistos.add(link);
      achados.push({ link, trecho: trecho.slice(-140) });
      if (achados.length >= maximo) break;
    }
  }
  return achados;
}

export function avisoDeAnexosExternos(achados: AnexoExterno[]): string | null {
  if (achados.length === 0) return null;
  const links = achados.map((a) => a.link).join("; ");
  return `O edital manda buscar anexo(s) em link externo (${links}), que o sistema não baixa. Baixe e envie o arquivo para que ele seja lido também.`;
}

type BrutaParaContradicao = { chave: string | null; documento: string; origem: string; condicao: string | null };

const numerosDe = (texto: string) => (texto.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(",", ".")).sort().join("|");

/**
 * Mesmo documento de habilitação (mesma chave do catálogo), pedido em arquivos diferentes, com condições numéricas
 * diferentes (ex.: atestado de 50% no edital e de 30% no termo de referência). Só compara quando os dois trazem números.
 */
export function detectarContradicoes(brutas: BrutaParaContradicao[]): string[] {
  const porChave = new Map<string, BrutaParaContradicao[]>();
  for (const b of brutas) {
    if (!b.chave || !b.condicao || !/\d/.test(b.condicao)) continue;
    porChave.set(b.chave, [...(porChave.get(b.chave) ?? []), b]);
  }
  const avisos: string[] = [];
  for (const lista of porChave.values()) {
    const porOrigem = new Map<string, BrutaParaContradicao>();
    for (const b of lista) if (!porOrigem.has(b.origem)) porOrigem.set(b.origem, b);
    if (porOrigem.size < 2) continue;
    const distintas = new Set([...porOrigem.values()].map((b) => numerosDe(b.condicao!)));
    if (distintas.size < 2) continue;
    const partes = [...porOrigem.values()].slice(0, 3).map((b) => `${b.origem}: “${b.condicao}”`);
    avisos.push(`${lista[0].documento} — os documentos pedem condições diferentes (${partes.join(" × ")}). Confira qual vale.`);
    if (avisos.length >= 3) break;
  }
  return avisos;
}
