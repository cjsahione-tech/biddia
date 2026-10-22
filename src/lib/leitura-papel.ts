// Quais documentos do processo são PRINCIPAIS (se um deles não for lido por inteiro, o resultado nunca fica como
// "Habilitada") e quais são de APOIO (aparecem como aviso, mas não rebaixam o resultado).
//
// Principais: edital, termo de referência (e projeto básico), anexo de preços, planilhas de quantitativo e
// retificações/erratas. De apoio: o que a própria empresa anexou (certidões, documentos do dossiê, correções
// enviadas pelo chat) e os demais anexos de modelo/declaração do portal.

export type PapelDocumento = "principal" | "apoio";

type DocParaPapel = { id: string; nome: string; tipo: string; categoria: string | null };

/** Trecho que marca, no texto lido, as páginas deixadas de fora pelo teto de leitura por imagem. */
export const MARCA_ACIMA_DO_LIMITE = "acima do limite de leitura por imagem";

const CATEGORIAS_PRINCIPAIS = new Set(["EDITAL", "TERMO_REFERENCIA", "ANEXO_PRECOS"]);
const CATEGORIAS_DE_APOIO = new Set(["CHECKLIST", "CORRECAO_AGENTE"]);

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Pelo nome, parece um documento principal? (cobre arquivos sem categoria, como os enviados à mão em "Adicionar PDF") */
const NOME_DE_DOCUMENTO_PRINCIPAL =
  /edital|termo de referencia|projeto basico|retifica|errata|planilha|quantitativ|preco|orcamento|proposta|memorial|cronograma|\btr\b/;

export function papelDoDocumento(d: Omit<DocParaPapel, "id">): PapelDocumento {
  if (d.categoria && CATEGORIAS_PRINCIPAIS.has(d.categoria)) return "principal";
  if (d.categoria && CATEGORIAS_DE_APOIO.has(d.categoria)) return "apoio";
  return NOME_DE_DOCUMENTO_PRINCIPAL.test(semAcento(d.nome)) ? "principal" : "apoio";
}

/**
 * Papel de cada documento (por id). Se NENHUM documento do processo parecer principal (arquivos sem categoria nem
 * nome reconhecível), todos contam como principais — na dúvida, a regra mais rígida.
 */
export function papeisDosDocumentos(docs: DocParaPapel[]): Map<string, PapelDocumento> {
  const mapa = new Map(docs.map((d) => [d.id, papelDoDocumento(d)] as const));
  // Arquivo do portal que o analista SUBSTITUIU (enviou um da mesma categoria, ex.: outro "Edital"): o do portal passa a
  // ser de apoio — se ele não abre, é justamente por isso que a pessoa mandou outro, e isso não pode travar o resultado.
  const categoriasEnviadasPelaPessoa = new Set(
    docs.filter((d) => d.tipo === "DOCUMENTO_USUARIO" && d.categoria && CATEGORIAS_PRINCIPAIS.has(d.categoria)).map((d) => d.categoria)
  );
  for (const d of docs) {
    if (d.tipo !== "DOCUMENTO_USUARIO" && d.categoria && categoriasEnviadasPelaPessoa.has(d.categoria)) mapa.set(d.id, "apoio");
  }
  if (docs.length > 0 && ![...mapa.values()].includes("principal")) {
    for (const d of docs) mapa.set(d.id, "principal");
  }
  return mapa;
}

/**
 * O que ficou sem leitura dentro de um texto já extraído, em linguagem simples: lê as marcas
 * "[[ARQUIVO ILEGÍVEL: páginas 61-100 não lidas (…)]]" (OCR) e "[[ARQUIVO ILEGÍVEL: nome.pdf]]" (arquivo de dentro de um ZIP).
 */
export function descreverNaoLido(texto: string): string[] {
  const out: string[] = [];
  for (const m of texto.matchAll(/\[\[ARQUIVO ILEGÍVEL:([^\]]*)\]\]/g)) {
    const conteudo = m[1].trim();
    if (!conteudo) continue;
    out.push(/^páginas /.test(conteudo) ? conteudo : `arquivo "${conteudo}" (dentro do pacote)`);
  }
  return out;
}

/** Quantas páginas há num aviso como "páginas 61-100, 130 não lidas (...)" (61 a 100 = 40, mais a 130 = 41). */
export function contarPaginasDoAviso(aviso: string): number {
  const m = aviso.match(/p[áa]ginas ([\d,\s-]+) n[ãa]o lidas/i);
  if (!m) return 0;
  let total = 0;
  for (const parte of m[1].split(",")) {
    const [a, b] = parte.trim().split("-").map(Number);
    if (Number.isFinite(a) && Number.isFinite(b)) total += Math.max(0, b - a + 1);
    else if (Number.isFinite(a)) total += 1;
  }
  return total;
}
