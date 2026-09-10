import { extractText, getDocumentProxy } from "unpdf";
import { prisma } from "@/lib/prisma";
import { baixarArquivoPncp } from "@/lib/agents/pncp";
import type { Document as DocumentRow } from "@prisma/client";

// Limite de caracteres por documento enviado ao modelo — controla custo/latência
// mesmo em editais muito longos (dezenas de páginas). Mantido moderado (não maior)
// porque a Vercel no plano gratuito corta a execução em 60s, e um texto muito grande
// deixa a resposta do modelo lenta o bastante para estourar esse limite.
export const MAX_CHARS_POR_DOCUMENTO = 35_000;

// Exportado para uso fora deste módulo (ex: extrair dados estruturados de um PDF
// recém enviado pelo usuário, antes mesmo de haver um Document salvo).
export async function extrairTextoPdf(bytes: Uint8Array): Promise<string | null> {
  try {
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    return text.trim() || null;
  } catch (err) {
    console.error("Falha ao extrair texto do PDF:", err);
    return null;
  }
}

export function base64ParaBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1] ?? dataUrl;
  return new Uint8Array(Buffer.from(base64, "base64"));
}

/**
 * Extrai o texto de um documento já baixado (ou, na falta de cópia local, tenta
 * buscar direto na fonte oficial como último recurso). Retorna null se não houver
 * como obter texto (arquivo indisponível, PDF só de imagem sem OCR, etc.).
 */
export async function extrairTextoDocumento(doc: DocumentRow): Promise<string | null> {
  let bytes: Uint8Array | null = null;

  if (doc.conteudoBase64) {
    bytes = base64ParaBytes(doc.conteudoBase64);
  } else if (doc.origemUrl) {
    const arquivo = await baixarArquivoPncp(doc.origemUrl).catch((err) => {
      console.error(`Falha ao baixar "${doc.nome}" de ${doc.origemUrl}:`, err);
      return null;
    });
    if (arquivo) bytes = arquivo.bytes;
    console.log(`[pdf-extract] ${doc.nome}: baixado ao vivo =`, !!arquivo, arquivo?.bytes.length);
  }

  if (!bytes) {
    console.log(`[pdf-extract] ${doc.nome}: sem bytes disponíveis`);
    return null;
  }

  const texto = await extrairTextoPdf(bytes);
  console.log(`[pdf-extract] ${doc.nome}: texto extraído =`, texto?.length ?? 0, "chars");
  if (!texto) return null;

  return texto.length > MAX_CHARS_POR_DOCUMENTO
    ? `${texto.slice(0, MAX_CHARS_POR_DOCUMENTO)}\n\n[...texto truncado — documento maior que o limite considerado...]`
    : texto;
}

export type TextoEdital = {
  textoEdital: string | null;
  textoTermoReferencia: string | null;
  temTextoCompleto: boolean;
};

/**
 * Busca e extrai o texto do edital (ou aviso equivalente) e do termo de referência
 * de uma contratação, para os agentes lerem o documento de verdade em vez de
 * trabalharem só com o resumo curto vindo da busca do PNCP.
 */
export async function obterTextoCompletoEdital(editalId: string): Promise<TextoEdital> {
  // Inclui tanto os documentos baixados do PNCP quanto os enviados manualmente
  // pelo usuário na captação — ambos são a fonte do texto real do edital/TR.
  const documentos = await prisma.document.findMany({
    where: { editalId, tipo: { in: ["DOCUMENTO_PNCP", "DOCUMENTO_USUARIO"] } },
  });

  const docEdital = documentos.find((d) => d.categoria === "EDITAL") ?? null;
  const docTR = documentos.find((d) => d.categoria === "TERMO_REFERENCIA") ?? null;

  const [textoEdital, textoTermoReferencia] = await Promise.all([
    docEdital ? extrairTextoDocumento(docEdital) : Promise.resolve(null),
    docTR ? extrairTextoDocumento(docTR) : Promise.resolve(null),
  ]);

  return {
    textoEdital,
    textoTermoReferencia,
    temTextoCompleto: !!(textoEdital || textoTermoReferencia),
  };
}
