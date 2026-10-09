import JSZip from "jszip";

// Editais do LicitaNet (e alguns do PNCP) chegam dentro de um ZIP com vários arquivos —
// termo de referência, anexos, o edital em si. Aqui o ZIP é aberto e cada arquivo lido por
// inteiro. Suporta PDF, DOCX e TXT; outros formatos (planilhas, imagens) são ignorados por
// não carregarem exigências de habilitação em texto.

const MAX_ARQUIVOS = 60;
// Proteção contra "bomba de ZIP" (arquivo pequeno que expande para gigabytes).
const MAX_BYTES_DESCOMPACTADOS = 120 * 1024 * 1024;

export function ehZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05);
}

/** Texto de um .docx: o conteúdo fica em word/document.xml — troca fim de parágrafo por quebra
 * de linha e remove as etiquetas. */
export async function extrairTextoDocx(bytes: Uint8Array): Promise<string | null> {
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) return null;
  const texto = xml
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:br[^>]*\/>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return texto || null;
}

export const MARCA_ILEGIVEL = "[[ARQUIVO ILEGÍVEL:";

/**
 * Abre um ZIP e devolve o texto de todos os arquivos suportados, cada um com um cabeçalho
 * "===== ARQUIVO: nome =====". Arquivo que não pôde ser lido (PDF escaneado grande demais,
 * corrompido) fica marcado com `[[ARQUIVO ILEGÍVEL: nome]]` — a auditoria usa isso para
 * saber que a leitura foi incompleta, em vez de ignorar em silêncio.
 */
export async function extrairTextoDeZip(
  bytes: Uint8Array,
  lerPdf: (bytes: Uint8Array) => Promise<string | null>
): Promise<string | null> {
  const zip = await JSZip.loadAsync(bytes);

  // Um arquivo Word (.docx) é, por dentro, um ZIP — o próprio arquivo é o documento, não um
  // pacote de documentos. Sem este desvio, editais enviados em Word nunca eram lidos.
  if (zip.file("word/document.xml")) {
    return extrairTextoDocx(bytes);
  }

  const entradas = Object.values(zip.files)
    .filter((f) => !f.dir && !f.name.startsWith("__MACOSX/"))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (entradas.length > MAX_ARQUIVOS) {
    throw new Error(`ZIP com arquivos demais (${entradas.length}).`);
  }

  const partes: string[] = [];
  let total = 0;
  for (const entrada of entradas) {
    const nome = entrada.name.split("/").pop() ?? entrada.name;
    const minusculo = nome.toLowerCase();
    const ehPdf = minusculo.endsWith(".pdf");
    const ehDocx = minusculo.endsWith(".docx");
    const ehTxt = minusculo.endsWith(".txt");
    if (!ehPdf && !ehDocx && !ehTxt) continue;

    const conteudo = await entrada.async("uint8array");
    total += conteudo.byteLength;
    if (total > MAX_BYTES_DESCOMPACTADOS) throw new Error("ZIP descompactado grande demais.");

    let texto: string | null = null;
    try {
      if (ehPdf) texto = await lerPdf(conteudo);
      else if (ehDocx) texto = await extrairTextoDocx(conteudo);
      else texto = new TextDecoder("utf-8").decode(conteudo).trim() || null;
    } catch (err) {
      console.error(`Falha ao ler "${nome}" dentro do ZIP:`, err);
    }
    partes.push(texto ? `===== ARQUIVO: ${nome} =====\n${texto}` : `${MARCA_ILEGIVEL} ${nome}]]`);
  }

  return partes.length > 0 ? partes.join("\n\n") : null;
}
