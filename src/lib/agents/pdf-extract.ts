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
 * Em documentos maiores que o limite considerado, corta de forma "burra" pelo início —
 * o que descarta justamente o que costuma ficar no fim de editais longos (anexos,
 * planilhas de preços, tabelas de itens). Em vez disso, divide o texto em blocos e
 * pontua cada um pela DENSIDADE de palavras-chave nele — não basta ocorrer a palavra
 * uma vez qualquer (termos como "item" aparecem soltos o tempo todo em cláusulas
 * genéricas, tipo "conforme item 8.2"); o que denuncia uma tabela de verdade é várias
 * palavras-chave diferentes se repetindo concentradas num mesmo trecho curto. Mantém
 * só os blocos de maior pontuação, na ordem em que aparecem no documento. Sem nenhuma
 * ocorrência, cai de volta para início + fim do texto (ainda melhor que só o início, já
 * que anexos costumam vir depois).
 */
export function selecionarTrechoRelevante(
  texto: string,
  opts: { tamanhoMax: number; palavrasChave: string[]; tamanhoBloco?: number }
): string {
  if (texto.length <= opts.tamanhoMax) return texto;

  const tamanhoBloco = opts.tamanhoBloco ?? 2000;
  const textoLower = texto.toLowerCase();
  const numBlocos = Math.ceil(texto.length / tamanhoBloco);
  const pontuacao = new Array(numBlocos).fill(0);

  for (const palavra of opts.palavrasChave) {
    const alvo = palavra.toLowerCase();
    let pos = textoLower.indexOf(alvo);
    while (pos !== -1) {
      pontuacao[Math.floor(pos / tamanhoBloco)] += 1;
      pos = textoLower.indexOf(alvo, pos + alvo.length);
    }
  }

  if (pontuacao.every((p) => p === 0)) {
    const metade = Math.floor(opts.tamanhoMax / 2);
    const fimCabeca = texto.lastIndexOf("\n", metade);
    const inicioRodape = texto.indexOf("\n", texto.length - metade);
    const cabeca = texto.slice(0, fimCabeca === -1 ? metade : fimCabeca);
    const rodape = texto.slice(inicioRodape === -1 ? texto.length - metade : inicioRodape + 1);
    return `${cabeca}\n\n[...trecho omitido — nenhuma palavra-chave relevante encontrada...]\n\n${rodape}`;
  }

  const maxBlocos = Math.max(1, Math.ceil(opts.tamanhoMax / tamanhoBloco));
  const indicesEscolhidos = pontuacao
    .map((pontos, i) => ({ i, pontos }))
    .filter((b) => b.pontos > 0)
    .sort((a, b) => b.pontos - a.pontos)
    .slice(0, maxBlocos)
    .map((b) => b.i)
    .sort((a, b) => a - b);

  // Agrupa blocos vizinhos/consecutivos num único trecho contínuo, em vez de fatiar o
  // texto em pedacinhos ilegíveis.
  const grupos: number[][] = [];
  for (const i of indicesEscolhidos) {
    const ultimoGrupo = grupos[grupos.length - 1];
    if (ultimoGrupo && i <= ultimoGrupo[ultimoGrupo.length - 1] + 1) {
      ultimoGrupo.push(i);
    } else {
      grupos.push([i]);
    }
  }

  return grupos
    .map((grupo) => {
      // Os limites do bloco caem em qualquer posição de caractere — sem ajustar, um
      // corte no meio de uma linha pode partir um número ao meio (ex: "12.500" virar
      // "500" de um lado e "12." do outro), corrompendo justamente o dado que se quer
      // preservar. Estica a borda até a quebra de linha mais próxima antes/depois.
      let inicio = grupo[0] * tamanhoBloco;
      let fim = Math.min(texto.length, (grupo[grupo.length - 1] + 1) * tamanhoBloco);
      if (inicio > 0) {
        const quebra = texto.lastIndexOf("\n", inicio);
        inicio = quebra === -1 ? 0 : quebra + 1;
      }
      if (fim < texto.length) {
        const quebra = texto.indexOf("\n", fim);
        fim = quebra === -1 ? texto.length : quebra;
      }
      return texto.slice(inicio, fim);
    })
    .join("\n\n[...]\n\n");
}

/**
 * Texto BRUTO (sem corte) de um documento. Reaproveita `doc.textoExtraido` se já foi
 * extraído antes; senão extrai do PDF (cópia local ou, em último caso, baixando da
 * fonte) e grava o resultado para as próximas leituras não reprocessarem o mesmo PDF.
 */
export async function obterTextoBrutoDocumento(doc: DocumentRow): Promise<string | null> {
  if (doc.textoExtraido) return doc.textoExtraido;

  let bytes: Uint8Array | null = null;
  if (doc.conteudoBase64) {
    bytes = base64ParaBytes(doc.conteudoBase64);
  } else if (doc.origemUrl) {
    const arquivo = await baixarArquivoPncp(doc.origemUrl).catch((err) => {
      console.error(`Falha ao baixar "${doc.nome}" de ${doc.origemUrl}:`, err);
      return null;
    });
    if (arquivo) bytes = arquivo.bytes;
  }
  if (!bytes) return null;

  const texto = await extrairTextoPdf(bytes);
  if (!texto) return null;

  await prisma.document
    .update({ where: { id: doc.id }, data: { textoExtraido: texto } })
    .catch((err) => console.error(`Falha ao cachear texto do documento ${doc.id}:`, err));

  return texto;
}

/**
 * Extrai + já entrega o texto no tamanho certo para enviar ao modelo. Quando
 * `palavrasChave` é informado, documentos maiores que o limite são cortados de forma
 * inteligente (ver `selecionarTrechoRelevante`) em vez de perder tudo que vem depois
 * do início — importante para quem lê especificamente atrás de uma tabela de
 * itens/preços, que raramente está nas primeiras páginas.
 */
export async function extrairTextoDocumento(
  doc: DocumentRow,
  opts?: { palavrasChave?: string[] }
): Promise<string | null> {
  const texto = await obterTextoBrutoDocumento(doc);
  if (!texto) return null;
  if (texto.length <= MAX_CHARS_POR_DOCUMENTO) return texto;

  if (opts?.palavrasChave) {
    return selecionarTrechoRelevante(texto, { tamanhoMax: MAX_CHARS_POR_DOCUMENTO, palavrasChave: opts.palavrasChave });
  }
  return `${texto.slice(0, MAX_CHARS_POR_DOCUMENTO)}\n\n[...texto truncado — documento maior que o limite considerado...]`;
}

/**
 * Extrai e cacheia o texto de todos os PDFs de um edital de uma vez. Chamado no início
 * do pipeline para que os agentes Analista/Financeiro/Advogado (que rodam em paralelo)
 * não disputem a extração do mesmo arquivo — cada um lê direto do cache.
 */
export async function prewarmTextoDocumentos(editalId: string): Promise<void> {
  const docs = await prisma.document.findMany({
    where: {
      editalId,
      tipo: { in: ["DOCUMENTO_PNCP", "DOCUMENTO_USUARIO"] },
      textoExtraido: null,
    },
  });
  if (docs.length === 0) return;
  await Promise.all(docs.map((doc) => obterTextoBrutoDocumento(doc)));
}

export type TextoEdital = {
  textoEdital: string | null;
  textoTermoReferencia: string | null;
  // Anexos que não são o edital nem o TR em si, mas foram identificados como prováveis
  // portadores de planilha/tabela de preços (ver classificação em pncp.ts).
  textoAnexosPrecos: string | null;
  temTextoCompleto: boolean;
};

/**
 * Busca e extrai o texto do edital (ou aviso equivalente), do termo de referência e de
 * eventuais anexos de preços de uma contratação, para os agentes lerem o documento de
 * verdade em vez de trabalharem só com o resumo curto vindo da busca do PNCP.
 *
 * `palavrasChave`, quando informado, direciona o corte de documentos longos para os
 * trechos mais relevantes à tarefa de quem está chamando (ex: o Agente Financeiro passa
 * termos como "valor unitário"/"quantidade" para não perder a tabela de itens).
 */
export async function obterTextoCompletoEdital(
  editalId: string,
  opts?: { palavrasChave?: string[] }
): Promise<TextoEdital> {
  // Inclui tanto os documentos baixados do PNCP quanto os enviados manualmente
  // pelo usuário na captação — ambos são a fonte do texto real do edital/TR.
  const documentos = await prisma.document.findMany({
    where: { editalId, tipo: { in: ["DOCUMENTO_PNCP", "DOCUMENTO_USUARIO"] } },
  });

  const docEdital = documentos.find((d) => d.categoria === "EDITAL") ?? null;
  const docTR = documentos.find((d) => d.categoria === "TERMO_REFERENCIA") ?? null;
  const docsAnexosPrecos = documentos.filter((d) => d.categoria === "ANEXO_PRECOS");

  const [textoEdital, textoTermoReferencia, textosAnexos] = await Promise.all([
    docEdital ? extrairTextoDocumento(docEdital, opts) : Promise.resolve(null),
    docTR ? extrairTextoDocumento(docTR, opts) : Promise.resolve(null),
    Promise.all(docsAnexosPrecos.map((d) => extrairTextoDocumento(d, opts))),
  ]);

  const textoAnexosPrecos = textosAnexos.filter((t): t is string => !!t).join("\n\n---\n\n") || null;

  return {
    textoEdital,
    textoTermoReferencia,
    textoAnexosPrecos,
    temTextoCompleto: !!(textoEdital || textoTermoReferencia || textoAnexosPrecos),
  };
}
