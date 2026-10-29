// Formato REAL de um arquivo baixado, descoberto pelos primeiros bytes — não pelo que o servidor de origem diz. O PNCP
// entrega arquivos sem extensão e, às vezes, com o tipo errado (octet-stream, zip, texto...), e isso fazia o mesmo edital
// aparecer ora como PDF, ora como outro formato. O sistema trabalha com PDF: quando o arquivo é PDF, ele é tratado e
// entregue sempre como PDF.

export type TipoArquivo = "pdf" | "zip" | "outro";

/** "%PDF-" nos primeiros bytes (alguns PDFs têm lixo antes do cabeçalho, até ~1 KB). */
export function ehPdf(bytes: Uint8Array): boolean {
  const inicio = Math.min(bytes.length, 1024);
  for (let i = 0; i + 4 < inicio; i++) {
    if (bytes[i] === 0x25 && bytes[i + 1] === 0x50 && bytes[i + 2] === 0x44 && bytes[i + 3] === 0x46 && bytes[i + 4] === 0x2d) return true;
  }
  return false;
}

export function ehZipPorBytes(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05);
}

export function tipoDoArquivo(bytes: Uint8Array): TipoArquivo {
  if (ehPdf(bytes)) return "pdf";
  if (ehZipPorBytes(bytes)) return "zip";
  return "outro";
}

/**
 * Content-Type a gravar/servir: PDF sempre "application/pdf" (o que o servidor disse não importa); ZIP, "application/zip"
 * (um .docx/.xlsx também é ZIP por dentro — quem precisa distinguir abre o pacote); o resto, o que veio da origem.
 */
export function contentTypeReal(bytes: Uint8Array, cabecalho: string | null | undefined): string {
  const tipo = tipoDoArquivo(bytes);
  if (tipo === "pdf") return "application/pdf";
  const c = (cabecalho ?? "").split(";")[0].trim().toLowerCase();
  if (tipo === "zip" && (c === "" || c === "application/octet-stream" || c === "binary/octet-stream")) return "application/zip";
  return c || "application/octet-stream";
}

/** Nome do arquivo para download: PDF sempre termina em ".pdf" (os arquivos do PNCP chegam sem extensão). */
export function nomeComExtensao(nome: string, tipo: TipoArquivo): string {
  const limpo = nome.trim() || "documento";
  if (tipo === "pdf") return /\.pdf$/i.test(limpo) ? limpo : `${limpo.replace(/\.(zip|bin|dat|tmp)$/i, "")}.pdf`;
  if (tipo === "zip") return /\.zip$/i.test(limpo) ? limpo : `${limpo}.zip`;
  return limpo;
}
