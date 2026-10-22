import JSZip from "jszip";
import { ehPacoteXlsx, extrairTextoCsv, extrairTextoXlsx } from "@/lib/agents/planilhas";

// Editais do LicitaNet (e alguns do PNCP) chegam dentro de um ZIP com vários arquivos —
// termo de referência, anexos, o edital em si. Aqui o ZIP é aberto e cada arquivo lido por
// inteiro. Suporta PDF, DOCX, XLSX, CSV e TXT (planilhas de preços e de quantitativo são documentos principais);
// outros formatos (imagens etc.) são ignorados.

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
 * true quando o "texto" de um arquivo é só o aviso de que nada pôde ser lido (ex.: ZIP corrompido ou só com
 * arquivos de formato não suportado) — sem nenhum conteúdo de verdade. Esse texto NÃO pode ir para a IA: ela
 * não acharia exigência nenhuma e o resultado sairia como "sem exigências" em vez de "arquivo ilegível".
 */
export function textoSoIlegivel(texto: string): boolean {
  const semMarcas = texto
    .replace(/\[\[ARQUIVO ILEGÍVEL:[^\]]*\]\]/g, "")
    .replace(/={3,} ARQUIVO:[^\n]*={3,}/g, "")
    .trim();
  return semMarcas.length < 40;
}

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
  // Idem para uma planilha do Excel (.xlsx): o arquivo todo é o documento.
  if (ehPacoteXlsx(Object.keys(zip.files))) {
    return extrairTextoXlsx(bytes);
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
    const ehXlsx = minusculo.endsWith(".xlsx");
    const ehCsv = minusculo.endsWith(".csv");
    if (!ehPdf && !ehDocx && !ehTxt && !ehXlsx && !ehCsv) continue;

    const conteudo = await entrada.async("uint8array");
    total += conteudo.byteLength;
    if (total > MAX_BYTES_DESCOMPACTADOS) throw new Error("ZIP descompactado grande demais.");

    let texto: string | null = null;
    try {
      if (ehPdf) texto = await lerPdf(conteudo);
      else if (ehDocx) texto = await extrairTextoDocx(conteudo);
      else if (ehXlsx) texto = await extrairTextoXlsx(conteudo);
      else if (ehCsv) texto = extrairTextoCsv(conteudo);
      else texto = new TextDecoder("utf-8").decode(conteudo).trim() || null;
    } catch (err) {
      console.error(`Falha ao ler "${nome}" dentro do ZIP:`, err);
    }
    partes.push(texto ? `===== ARQUIVO: ${nome} =====\n${texto}` : `${MARCA_ILEGIVEL} ${nome}]]`);
  }

  return partes.length > 0 ? partes.join("\n\n") : null;
}
