// Seleção dos trechos do edital que falam de HABILITAÇÃO / documentos exigidos — só eles vão
// para a IA. Um edital de 150 mil caracteres costuma ter 20–40% de texto útil para a auditoria
// (o resto é objeto, preços, minuta do contrato, penalidades...). Mandar tudo custava mais e
// estourava o tempo; mandar só o relevante é mais barato e mais rápido.
//
// Regra de ouro: NÃO perder exigência. Por isso o filtro é generoso — um trecho entra se tiver
// QUALQUER termo de habilitação, e leva junto os trechos vizinhos (listas "a), b), c)" continuam
// nas linhas seguintes). Documentos curtos passam inteiros (não há o que economizar).

/** Documentos menores que isto são lidos por inteiro. */
export const LIMITE_TEXTO_INTEIRO = 20_000;

// Termos que indicam exigência de documento de habilitação. Evita palavras genéricas demais
// (ex.: "registro" aparece em "registro de preços" em quase todo edital).
const TERMOS_HABILITACAO = new RegExp(
  [
    "habilita",
    "certid[aã]o|certid[oõ]es",
    "regularidade",
    "atestado",
    "declara[cç][aã]o|declara[cç][oõ]es|declarar",
    "balan[cç]o",
    "qualifica[cç][aã]o",
    "comprovante|comprova[cç][aã]o|comprovar",
    "contrato social|ato constitutivo|estatuto|requerimento de empres",
    "cnpj",
    "fgts|inss|d[ée]bitos? trabalhistas?|cndt|tributos? federais|dívida ativa|d[ií]vida ativa|fazenda (federal|estadual|municipal)|receita federal",
    "fal[êe]ncia|concordata|recupera[cç][aã]o judicial|extrajudicial",
    "alvar[aá]|licen[cç]a (de|sanit)|autoriza[cç][aã]o de funcionamento",
    "garantia de proposta|garantia da proposta|cau[cç][aã]o",
    "[ií]ndices?|liquidez|solv[eê]ncia|endividamento|patrim[oô]nio l[ií]quido|capital (social|m[ií]nimo)",
    "procura[cç][aã]o|credenciamento|representante legal",
    "inidone|impedimento de licitar|ceis|cnep|cadin|cepim",
    "sicaf|cadastro (unificado|de fornecedores)",
    "crea|\\bcau\\b|\\bcrm\\b|\\bcrf\\b|\\bcrq\\b|conselho (regional|federal|de)",
    "acervo t[eé]cnico|capacidade t[eé]cnica|respons[aá]vel t[eé]cnico|equipe t[eé]cnica|profissional (de n[ií]vel|habilitado)",
    "visita t[eé]cnica|vistoria",
    "menor (de idade|aprendiz)|trabalho (infantil|noturno)",
    "documentos? (exigid|necess|obrigat)|documenta[cç][aã]o",
    "registro (na|no|junto|em) (junta|conselho|cart[oó]rio|[óo]rg[aã]o)|junta comercial",
  ].join("|"),
  "i"
);

// Início de uma seção de habilitação: o conteúdo seguinte é praticamente todo relevante.
const CABECALHO_HABILITACAO = /\b(da|de|para a|para)\s+habilita[cç][aã]o|documentos? de habilita[cç][aã]o|qualifica[cç][aã]o (t[eé]cnica|econ[oô]mica)|regularidade (fiscal|trabalhista)|habilita[cç][aã]o jur[ií]dica/i;

const LINHAS_POR_BLOCO = 6;
const MAX_CARACTERES_POR_BLOCO = 900;
const VIZINHOS = 1; // blocos de contexto antes e depois de um bloco relevante
const BLOCOS_APOS_CABECALHO = 40; // seção de habilitação: leva os blocos seguintes por inteiro

const MARCA_PAGINA = /^\[Pág\. \d+\]$/;

type Bloco = { texto: string; pagina: string | null; pontos: number; cabecalho: boolean };

function dividirEmBlocos(texto: string): Bloco[] {
  const blocos: Bloco[] = [];
  let pagina: string | null = null;
  let linhasDoBloco: string[] = [];
  let tamanho = 0;

  const fechar = () => {
    if (linhasDoBloco.length === 0) return;
    const t = linhasDoBloco.join("\n");
    blocos.push({ texto: t, pagina, pontos: contarTermos(t), cabecalho: CABECALHO_HABILITACAO.test(t) });
    linhasDoBloco = [];
    tamanho = 0;
  };

  for (const linha of texto.split("\n")) {
    if (MARCA_PAGINA.test(linha.trim())) {
      fechar();
      pagina = linha.trim();
      continue;
    }
    linhasDoBloco.push(linha);
    tamanho += linha.length + 1;
    if (linhasDoBloco.length >= LINHAS_POR_BLOCO || tamanho >= MAX_CARACTERES_POR_BLOCO) fechar();
  }
  fechar();
  return blocos;
}

function contarTermos(t: string): number {
  const g = new RegExp(TERMOS_HABILITACAO.source, "gi");
  return (t.match(g) ?? []).length;
}

export type TrechosSelecionados = {
  texto: string;
  /** Caracteres do texto original e do selecionado (para medir a economia). */
  original: number;
  selecionado: number;
  /** true = documento curto, lido por inteiro. */
  inteiro: boolean;
};

/**
 * Devolve só os trechos relevantes para habilitação (com contexto), mantendo as marcas
 * "[Pág. N]" das páginas dos trechos mantidos, para a IA continuar citando a página.
 */
export function selecionarTrechosDeHabilitacao(texto: string): TrechosSelecionados {
  if (texto.length <= LIMITE_TEXTO_INTEIRO) {
    return { texto, original: texto.length, selecionado: texto.length, inteiro: true };
  }

  const blocos = dividirEmBlocos(texto);
  const manter = new Array<boolean>(blocos.length).fill(false);

  blocos.forEach((b, i) => {
    if (b.pontos > 0) {
      for (let j = Math.max(0, i - VIZINHOS); j <= Math.min(blocos.length - 1, i + VIZINHOS); j++) manter[j] = true;
    }
    if (b.cabecalho) {
      for (let j = i; j <= Math.min(blocos.length - 1, i + BLOCOS_APOS_CABECALHO); j++) manter[j] = true;
    }
  });

  const partes: string[] = [];
  let paginaEmitida: string | null = null;
  let houvePulo = false;
  blocos.forEach((b, i) => {
    if (!manter[i]) {
      houvePulo = true;
      return;
    }
    if (houvePulo && partes.length > 0) partes.push("[...]");
    houvePulo = false;
    if (b.pagina && b.pagina !== paginaEmitida) {
      partes.push(b.pagina);
      paginaEmitida = b.pagina;
    }
    partes.push(b.texto);
  });

  const selecionado = partes.join("\n");
  return { texto: selecionado, original: texto.length, selecionado: selecionado.length, inteiro: false };
}

/** Densidade de termos de habilitação (por mil caracteres): para ler primeiro o que mais interessa. */
export function densidadeDeHabilitacao(texto: string): number {
  if (texto.length === 0) return 0;
  return (contarTermos(texto) * 1000) / texto.length;
}
