// Inventário dos anexos de um edital, feito pelo código (sem IA): o Agente Advogado precisa passar por TODOS os anexos
// que são modelos de declaração, sem esquecer nenhum. Em vez de mandar o edital inteiro para a IA e torcer para ela achar
// tudo, o código acha os cabeçalhos "ANEXO ..." no texto, separa cada anexo e a IA lê um de cada vez.

export type AnexoDoTexto = {
  /** Identificação como no edital: "III", "5", "A". */
  id: string;
  /** Título do anexo, ex.: "MODELO DE DECLARAÇÃO DE INEXISTÊNCIA DE FATO IMPEDITIVO". */
  titulo: string;
  /** Texto do anexo: do cabeçalho até o próximo "ANEXO". */
  texto: string;
};

const ANEXO_TOKEN = String.raw`ANEXO\s+(?:N[º°o.]*\s*)?([IVXLCDM]{1,7}|\d{1,2}|[A-Z])`;
// Cabeçalho: a linha começa com "ANEXO <id>" em maiúsculas (referências no meio de frases não contam).
const CABECALHO = new RegExp(String.raw`^[ \t]*${ANEXO_TOKEN}\b[ \t]*[-–—:.)]*[ \t]*(.*)$`, "gm");

const MAX_CARACTERES_POR_ANEXO = 14_000;

function limpaTitulo(t: string): string {
  return t.replace(/\s+/g, " ").replace(/^[\s\-–—:.)]+/, "").trim();
}

/**
 * Separa o texto em anexos pelos cabeçalhos "ANEXO <id> – <título>". Quando o título vem na linha de baixo, usa a
 * linha de baixo. Se o mesmo anexo aparece duas vezes (no índice do edital e no corpo), fica a versão mais completa.
 */
export function dividirEmAnexos(texto: string): AnexoDoTexto[] {
  const cabecalhos: { id: string; titulo: string; inicio: number; fimCabecalho: number }[] = [];
  for (const m of texto.matchAll(CABECALHO)) {
    const inicio = m.index ?? 0;
    const id = m[1].toUpperCase();
    let titulo = limpaTitulo(m[2] ?? "");
    const fimCabecalho = inicio + m[0].length;
    if (titulo.length < 4) {
      const proxima = texto.slice(fimCabecalho).split(/\r?\n/).map((l) => l.trim()).find((l) => l !== "");
      if (proxima && proxima.length <= 180) titulo = limpaTitulo(proxima);
    }
    // Linha longa demais é frase do edital, não cabeçalho.
    if (m[0].trim().length > 220) continue;
    cabecalhos.push({ id, titulo, inicio, fimCabecalho });
  }

  const anexos: AnexoDoTexto[] = [];
  cabecalhos.forEach((c, i) => {
    const fim = i + 1 < cabecalhos.length ? cabecalhos[i + 1].inicio : texto.length;
    anexos.push({ id: c.id, titulo: c.titulo, texto: texto.slice(c.inicio, Math.min(fim, c.inicio + MAX_CARACTERES_POR_ANEXO)).trim() });
  });

  // Mesmo anexo repetido (índice + corpo): fica o de texto maior.
  const porId = new Map<string, AnexoDoTexto>();
  for (const a of anexos) {
    const atual = porId.get(a.id);
    if (!atual || a.texto.length > atual.texto.length) porId.set(a.id, a);
  }
  return Array.from(porId.values());
}

const TITULO_DE_MODELO = /declara|modelo|carta|termo\s+de\s+(compromisso|ci[eê]ncia|responsabilidade|concord)|credenciamento|procura[çc]|requerimento|formul[aá]rio|ficha|atestado|compromisso/i;
const TITULO_QUE_NAO_E_MODELO =
  /termo\s+de\s+refer[eê]ncia|projeto\s+b[aá]sico|minuta|ata\s+de\s+registro|planilha|cronograma|mapa\s+de|estudo\s+t[eé]cnico|especifica[çc][õo]es|memorial|proposta\s+(comercial|de\s+pre[çc]os?)|modelo\s+de\s+proposta/i;
const LACUNA = /_{4,}|\.{6,}|\[[^\]\n]{2,50}\]|\([^)\n]{2,40}\)\s*_{2,}/;
const LINGUAGEM_DE_DECLARACAO = /declaro|declaramos|a\s+empresa|abaixo\s+assinad|sob\s+as\s+penas|responsabilidade/i;

/**
 * O anexo parece um MODELO que a empresa preenche e assina? (título de declaração/modelo/carta/termo, ou texto com
 * lacunas e linguagem de declaração). Planilha, termo de referência, minuta de contrato e proposta comercial não são
 * (a proposta é do Agente Financeiro).
 */
export function pareceModeloPreenchivel(anexo: Pick<AnexoDoTexto, "titulo" | "texto">): boolean {
  const titulo = anexo.titulo;
  if (/declara/i.test(titulo)) return true; // "declaração" no título vale mesmo que o resto pareça outra coisa
  if (TITULO_QUE_NAO_E_MODELO.test(titulo)) return false;
  if (TITULO_DE_MODELO.test(titulo)) return true;
  return LACUNA.test(anexo.texto) && LINGUAGEM_DE_DECLARACAO.test(anexo.texto);
}

/** Tira o que denunciaria "texto de IA": marcações de markdown e espaços sobrando. O conteúdo do modelo não muda. */
export function sanearParagrafos(paragrafos: unknown): string[] {
  if (!Array.isArray(paragrafos)) return [];
  return paragrafos
    .filter((p): p is string => typeof p === "string")
    .map((p) =>
      p
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/__(.+?)__/g, "$1")
        .replace(/`+/g, "")
        .replace(/^#{1,6}\s+/, "")
        .replace(/[ \t]+/g, " ")
        .trim()
    )
    .filter((p) => p !== "");
}

const normaliza = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Nome do anexo em forma comparável (sem acento, caixa e pontuação) — para saber se dois resultados são o mesmo anexo. */
export function chaveDoAnexo(nome: string): string {
  return normaliza(nome).replace(/^anexo\s+[a-z0-9]+\s*/, "").trim() || normaliza(nome);
}

/**
 * Fidelidade ao edital: que fração das palavras (com 4 letras ou mais) do texto devolvido existe no texto-fonte do anexo
 * ou nos dados da empresa usados no preenchimento. Perto de 1 = o texto é o do edital; baixo = a IA reescreveu ou inventou.
 */
export function fidelidadeAoEdital(paragrafos: string[], textoFonte: string, dadosDaEmpresa: string): number {
  const fonte = new Set(normaliza(`${textoFonte} ${dadosDaEmpresa}`).split(" "));
  const palavras = normaliza(paragrafos.join(" "))
    .split(" ")
    .filter((p) => p.length >= 4);
  if (palavras.length === 0) return 0;
  const presentes = palavras.filter((p) => fonte.has(p)).length;
  return presentes / palavras.length;
}
