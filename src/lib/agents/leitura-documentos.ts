import { PDFDocument } from "pdf-lib";
import { extractText, getDocumentProxy } from "unpdf";
import { transcreverPdfViaVisao, OCR_VISAO_LIMITE_BYTES } from "@/lib/anthropic";
import { MARCA_ILEGIVEL } from "@/lib/agents/arquivos-compactados";
import { densidadeDeHabilitacao } from "@/lib/habilitacao-trechos";
import { MARCA_ACIMA_DO_LIMITE } from "@/lib/leitura-papel";
import { TETO_PAGINAS_OCR } from "@/lib/limites-leitura";
import {
  MIN_PAGINAS_SEM_TEXTO_PARA_OCR,
  mesclarTextoComOcr,
  montarPdfComPaginas,
  paginasSemTexto,
  separarTranscricaoPorPagina,
} from "@/lib/pdf-paginas";

// Leitura de documentos da auditoria: descobre o formato REAL do arquivo (pelo conteúdo, não pelo nome) e lê PDFs
// escaneados em lotes pequenos, com o progresso guardado — para um edital grande nunca recomeçar do zero nem
// estourar o tempo de uma execução só.

// ── Formato ─────────────────────────────────────────────────────────────────

export type FormatoArquivo = "pdf" | "docx" | "xlsx" | "zip" | "csv" | "txt" | "doc_antigo" | "imagem" | "html" | "desconhecido";

const comeca = (b: Uint8Array, ...assinatura: number[]) => assinatura.every((x, i) => b[i] === x);

/** Descobre o tipo do arquivo pelos primeiros bytes. `zipInterno` (nomes dentro do ZIP) separa .docx/.xlsx de um pacote qualquer. */
export function detectarFormato(bytes: Uint8Array, nome = "", zipInterno?: string[]): FormatoArquivo {
  if (bytes.length < 4) return "desconhecido";
  if (comeca(bytes, 0x25, 0x50, 0x44, 0x46)) return "pdf"; // %PDF
  if (comeca(bytes, 0x50, 0x4b, 0x03, 0x04) || comeca(bytes, 0x50, 0x4b, 0x05, 0x06)) {
    if (zipInterno?.includes("word/document.xml")) return "docx";
    if (zipInterno?.includes("xl/workbook.xml")) return "xlsx";
    return "zip";
  }
  if (comeca(bytes, 0xd0, 0xcf, 0x11, 0xe0)) return "doc_antigo"; // .doc/.xls antigos (OLE)
  if (comeca(bytes, 0xff, 0xd8, 0xff) || comeca(bytes, 0x89, 0x50, 0x4e, 0x47) || comeca(bytes, 0x49, 0x49, 0x2a, 0x00) || comeca(bytes, 0x4d, 0x4d, 0x00, 0x2a)) {
    return "imagem";
  }
  const inicio = new TextDecoder("utf-8").decode(bytes.slice(0, 512)).trimStart().toLowerCase();
  // Página de login/captcha/erro devolvida no lugar do arquivo.
  if (inicio.startsWith("<!doctype html") || inicio.startsWith("<html") || inicio.includes("<head") || inicio.includes("<body")) return "html";
  const n = nome.toLowerCase();
  if (n.endsWith(".csv")) return "csv";
  if (n.endsWith(".txt")) return "txt";
  return "desconhecido";
}

// ── Diagnóstico de arquivo que não abriu ────────────────────────────────────

/** Por que um arquivo não pôde ser lido, quando dá para saber (e só uma pessoa resolve). */
export type DiagnosticoArquivo = "protegido" | "corrompido" | "login" | "pagina" | "ilegivel";

/** O PDF tem senha ou está corrompido? Só é chamado quando a leitura já falhou (carregar um PDF grande é caro). */
export async function diagnosticarPdf(bytes: Uint8Array): Promise<"protegido" | "corrompido" | null> {
  try {
    await PDFDocument.load(bytes);
    return null;
  } catch (err) {
    const nome = err instanceof Error ? err.constructor.name + " " + err.message : String(err);
    return /encrypt|password|senha/i.test(nome) ? "protegido" : "corrompido";
  }
}

/** Uma página da web no lugar do arquivo: tela de login/captcha/bloqueio, ou só uma página com links. */
export function diagnosticarHtml(bytes: Uint8Array): "login" | "pagina" {
  const texto = new TextDecoder("utf-8").decode(bytes.slice(0, 20_000)).toLowerCase();
  return /captcha|recaptcha|hcaptcha|just a moment|verify you are human|verifique que voc|type="password"|name="senha"|entrar|fa[cç]a login|acesso restrito|access denied|forbidden/.test(texto) ? "login" : "pagina";
}

// ── OCR por lotes ───────────────────────────────────────────────────────────

/** Páginas lidas por imagem em cada chamada (lotes pequenos: rápido, barato de repetir e de recuperar). */
export const PAGINAS_POR_LOTE_OCR = 10;
export { TETO_PAGINAS_OCR };
/** Só começa um novo lote se ainda houver este tempo (um lote de 10 páginas leva ~15–25 s). */
export const MARGEM_NOVO_LOTE_OCR_MS = 28_000;

/** Quanto do OCR já foi feito (guardado em `progresso.ocr[documento]`, dentro da própria auditoria). */
export type EstadoOcr = {
  /** Páginas escolhidas para ler por imagem (definido uma vez; não muda entre execuções). */
  escolhidas?: number[];
  /** Páginas deixadas de fora pelo teto. */
  deixadas?: number[];
  /** Texto de cada página já lida ("" = tentou e não conseguiu ler). */
  lidas: Record<string, string>;
  /** Quantas vezes cada página veio sem resposta (a 2ª vez vira "não lida" em vez de insistir para sempre). */
  tentativas?: Record<string, number>;
  /** Lotes que a IA não respondeu. */
  falhasDeLote?: number;
};

/** O OCR avançou mas ainda não terminou: o progresso foi guardado e a próxima execução continua. */
export class OcrEmAndamento extends Error {
  constructor(
    public feitas: number,
    public total: number
  ) {
    super(`Leitura por imagem em andamento: ${feitas} de ${total} páginas.`);
    this.name = "OcrEmAndamento";
  }
}

export function ehOcrEmAndamento(err: unknown): err is OcrEmAndamento {
  return err instanceof Error && err.name === "OcrEmAndamento";
}

/** "3-7, 12, 20-21" a partir de uma lista de páginas. */
export function formatarIntervalos(paginas: number[]): string {
  const ord = [...new Set(paginas)].sort((a, b) => a - b);
  const partes: string[] = [];
  let i = 0;
  while (i < ord.length) {
    let j = i;
    while (j + 1 < ord.length && ord[j + 1] === ord[j] + 1) j++;
    partes.push(j > i ? `${ord[i]}-${ord[j]}` : String(ord[i]));
    i = j + 1;
  }
  return partes.join(", ");
}

/**
 * Escolhe quais páginas sem texto ler por imagem quando passam do teto. Dá preferência às páginas vizinhas de
 * trechos de habilitação/proposta; sem nenhum sinal (documento 100% escaneado), lê o começo (cláusulas) e o fim
 * (anexos e planilhas de preço), que é onde as exigências costumam estar.
 */
export function escolherPaginasParaOcr(vazias: number[], porPagina: string[], teto: number): { escolhidas: number[]; deixadas: number[] } {
  if (vazias.length <= teto) return { escolhidas: [...vazias], deixadas: [] };

  const sinal = (p: number) => Math.max(densidadeDeHabilitacao(porPagina[p - 2] ?? ""), densidadeDeHabilitacao(porPagina[p] ?? ""));
  const pontos = vazias.map((p) => ({ p, s: sinal(p) }));
  let escolhidas: number[];
  if (pontos.some((x) => x.s > 0)) {
    escolhidas = [...pontos].sort((a, b) => b.s - a.s || a.p - b.p).slice(0, teto).map((x) => x.p);
  } else {
    const cabeca = Math.ceil((teto * 2) / 3);
    escolhidas = [...vazias.slice(0, cabeca), ...vazias.slice(vazias.length - (teto - cabeca))];
  }
  const set = new Set(escolhidas);
  return { escolhidas: [...set].sort((a, b) => a - b), deixadas: vazias.filter((p) => !set.has(p)) };
}

export type ResultadoPdfEmLotes = {
  texto: string | null;
  viaOcr: boolean;
  /** true = nada pôde ser lido (nem texto, nem imagem): documento escaneado ilegível. */
  todasIlegiveis?: boolean;
  /** Páginas que não puderam ser lidas (acima do teto ou ilegíveis). Vazio = leitura completa. */
  paginasNaoLidas: number[];
};

export type ContextoOcr = {
  estado: EstadoOcr;
  restanteMs: () => number;
  /** Chamado depois de cada lote: salva o progresso na auditoria. `avancou` = false quando o lote falhou (não conta como avanço). */
  aoAvancar: (avancou: boolean) => Promise<void>;
  /** true = o analista liberou a leitura completa (sem teto). */
  semTeto?: boolean;
  /** Substituíveis nos testes. */
  ocrLote?: (pdfBase64: string, paginas: number[]) => Promise<string | null>;
  camadaDeTexto?: (bytes: Uint8Array) => Promise<string[]>;
};

async function camadaDeTextoPadrao(bytes: Uint8Array): Promise<string[]> {
  try {
    // getDocumentProxy "consome" o buffer que recebe: passa uma CÓPIA.
    const pdf = await getDocumentProxy(bytes.slice());
    const { text, totalPages } = await extractText(pdf, { mergePages: false });
    const lista = Array.isArray(text) ? text : [text];
    return lista.length >= (totalPages || 1) ? lista : [...lista, ...Array(Math.max(0, (totalPages || 1) - lista.length)).fill("")];
  } catch (err) {
    console.error("Falha ao extrair texto do PDF:", err);
    // Sem a camada de texto, ainda dá para saber quantas páginas há e ler tudo por imagem.
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    return Array(doc.getPageCount()).fill("");
  }
}

async function ocrLotePadrao(pdfBase64: string, paginas: number[]): Promise<string | null> {
  return transcreverPdfViaVisao(pdfBase64, { maxTokens: Math.min(16_000, Math.max(4_000, paginas.length * 900)), paginas });
}

/** Densidade mínima (caracteres por página) para considerar que o PDF tem texto de verdade. */
const MIN_CHARS_POR_PAGINA = 30;

/**
 * Lê um PDF: usa a camada de texto e lê por imagem (em lotes de 10 páginas) só as páginas sem texto, até o teto.
 * Se o tempo desta execução acabar no meio, guarda o que já leu e lança OcrEmAndamento — a próxima execução continua
 * do próximo lote, sem refazer nada. O texto final marca com [[ARQUIVO ILEGÍVEL: …]] o que ficou sem leitura, para a
 * auditoria saber que a leitura foi incompleta (nunca fecha como "Habilitada" sem ressalva).
 */
export async function extrairTextoPdfEmLotes(bytes: Uint8Array, ctx: ContextoOcr): Promise<ResultadoPdfEmLotes> {
  const porPagina = await (ctx.camadaDeTexto ?? camadaDeTextoPadrao)(bytes);
  const total = porPagina.length || 1;
  const caracteres = porPagina.reduce((s, t) => s + t.trim().length, 0);
  const vazias = paginasSemTexto(porPagina);
  const temTexto = caracteres / total >= MIN_CHARS_POR_PAGINA;

  // PDF com texto e no máximo duas páginas em branco (verso, separador): nada a ler por imagem.
  if (temTexto && vazias.length < MIN_PAGINAS_SEM_TEXTO_PARA_OCR) {
    return { texto: mesclarTextoComOcr(porPagina, new Map()), viaOcr: false, paginasNaoLidas: [] };
  }
  if (vazias.length === 0) return { texto: null, viaOcr: false, paginasNaoLidas: [] };

  const est = ctx.estado;
  if (!est.escolhidas) {
    const teto = ctx.semTeto ? Number.MAX_SAFE_INTEGER : TETO_PAGINAS_OCR;
    const { escolhidas, deixadas } = escolherPaginasParaOcr(vazias, porPagina, teto);
    est.escolhidas = escolhidas;
    est.deixadas = deixadas;
  }
  est.tentativas ??= {};

  const ocr = ctx.ocrLote ?? ocrLotePadrao;
  const pendentes = () => est.escolhidas!.filter((p) => !(String(p) in est.lidas));

  while (pendentes().length > 0 && ctx.restanteMs() > MARGEM_NOVO_LOTE_OCR_MS) {
    const lote = await montarLoteQueCabe(bytes, pendentes().slice(0, PAGINAS_POR_LOTE_OCR));
    if (lote.paginas.length === 0) {
      // Nem uma página sozinha cabe no limite de tamanho: dá como não lida.
      const p = pendentes()[0];
      est.lidas[String(p)] = "";
      await ctx.aoAvancar(true);
      continue;
    }
    const transcricao = await ocr(Buffer.from(lote.pdf).toString("base64"), lote.paginas).catch(() => null);
    if (!transcricao) {
      // A IA não respondeu este lote: guarda o que já foi feito e deixa a próxima execução tentar de novo.
      est.falhasDeLote = (est.falhasDeLote ?? 0) + 1;
      await ctx.aoAvancar(false);
      throw new OcrEmAndamento(est.escolhidas.length - pendentes().length, est.escolhidas.length);
    }
    const lidas = separarTranscricaoPorPagina(transcricao, lote.paginas);
    for (const p of lote.paginas) {
      const chave = String(p);
      const texto = lidas.get(p);
      if (texto) est.lidas[chave] = texto;
      else {
        est.tentativas[chave] = (est.tentativas[chave] ?? 0) + 1;
        if (est.tentativas[chave] >= 2) est.lidas[chave] = ""; // 2 vezes sem resposta: não insiste mais
      }
    }
    await ctx.aoAvancar(lidas.size > 0);
  }

  if (pendentes().length > 0) throw new OcrEmAndamento(est.escolhidas.length - pendentes().length, est.escolhidas.length);

  const mapa = new Map<number, string>();
  for (const [p, t] of Object.entries(est.lidas)) if (t) mapa.set(Number(p), t);
  // Sem camada de texto e nenhuma página legível por imagem: documento escaneado sem condições de leitura.
  if (mapa.size === 0 && !temTexto) return { texto: null, viaOcr: false, todasIlegiveis: true, paginasNaoLidas: est.escolhidas };
  const naoLidas = [...(est.deixadas ?? []), ...est.escolhidas.filter((p) => !mapa.has(p))];
  let texto = mesclarTextoComOcr(porPagina, mapa);
  if (naoLidas.length > 0) {
    const motivo = (est.deixadas?.length ?? 0) > 0 ? MARCA_ACIMA_DO_LIMITE : "ilegíveis";
    texto += `\n\n${MARCA_ILEGIVEL} páginas ${formatarIntervalos(naoLidas)} não lidas (${motivo})]]`;
  }
  return { texto, viaOcr: mapa.size > 0, paginasNaoLidas: naoLidas.sort((a, b) => a - b) };
}

/** Monta o mini-PDF do lote; se passar do limite de tamanho da API, reduz o lote até caber. */
async function montarLoteQueCabe(bytes: Uint8Array, paginas: number[]): Promise<{ pdf: Uint8Array; paginas: number[] }> {
  let n = paginas.length;
  while (n >= 1) {
    const usadas = paginas.slice(0, n);
    const pdf = await montarPdfComPaginas(bytes, usadas);
    if (pdf.byteLength <= OCR_VISAO_LIMITE_BYTES) return { pdf, paginas: usadas };
    n = Math.floor(n / 2);
  }
  return { pdf: new Uint8Array(), paginas: [] };
}
