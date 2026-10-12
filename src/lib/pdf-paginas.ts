import { PDFDocument } from "pdf-lib";

// OCR seletivo: em vez de mandar o PDF inteiro para a visão da IA, só as páginas que NÃO têm
// texto selecionável (imagem escaneada). PDFs "mistos" — texto digital com algumas páginas
// escaneadas, comum em editais com anexos digitalizados — deixam de perder essas páginas, e o
// custo/tempo do OCR cai para só o que precisa.

/** Página com menos que isto (sem contar a marca "[Pág. N]") é tratada como sem texto. */
export const MIN_CHARS_PAGINA_COM_TEXTO = 40;
/** Poucas páginas vazias são normais (verso em branco, separador): só vale o OCR a partir daqui. */
export const MIN_PAGINAS_SEM_TEXTO_PARA_OCR = 3;

/** Números (a partir de 1) das páginas sem texto selecionável. */
export function paginasSemTexto(porPagina: string[]): number[] {
  const out: number[] = [];
  porPagina.forEach((t, i) => {
    if (t.trim().length < MIN_CHARS_PAGINA_COM_TEXTO) out.push(i + 1);
  });
  return out;
}

/** Monta um PDF novo só com as páginas pedidas (números a partir de 1, na ordem dada). */
export async function montarPdfComPaginas(bytes: Uint8Array, paginas: number[]): Promise<Uint8Array> {
  const origem = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const destino = await PDFDocument.create();
  const copiadas = await destino.copyPages(
    origem,
    paginas.map((p) => p - 1)
  );
  copiadas.forEach((p) => destino.addPage(p));
  return destino.save();
}

/**
 * Separa a transcrição por página, pelas marcas "[Pág. N]" que a IA recebeu a instrução de
 * escrever (com o número ORIGINAL da página). Devolve só as páginas pedidas; o que vier sem
 * marca reconhecível é descartado.
 */
export function separarTranscricaoPorPagina(transcricao: string, paginasPedidas: number[]): Map<number, string> {
  const pedidas = new Set(paginasPedidas);
  const mapa = new Map<number, string>();
  const partes = transcricao.split(/\[P[áa]g\.?\s*(\d+)\]/i);
  // partes = [antes, num1, texto1, num2, texto2, ...]
  for (let i = 1; i < partes.length; i += 2) {
    const numero = Number(partes[i]);
    const texto = (partes[i + 1] ?? "").trim();
    if (pedidas.has(numero) && texto) mapa.set(numero, texto);
  }
  return mapa;
}

/** Texto final do documento: cada página com sua marca, usando o OCR nas que não tinham texto. */
export function mesclarTextoComOcr(porPagina: string[], ocr: Map<number, string>): string {
  return porPagina.map((t, i) => `[Pág. ${i + 1}]\n${(ocr.get(i + 1) ?? t).trim()}`).join("\n\n");
}
