import { extractText, getDocumentProxy } from "unpdf";
import { prisma } from "@/lib/prisma";
import { mapComLimite } from "@/lib/concorrencia";
import {
  buscarArquivosCompra,
  buscarItensCompra,
  parseNumeroControlePNCP,
  selecionarDocumentosPrincipais,
} from "@/lib/agents/pncp";
import { baixarEPersistirDocumento } from "@/lib/agents/document-download";
import { extrairValorDoTexto, somarValorDosItens } from "@/lib/valor-edital";

// Deixa o edital DENTRO da plataforma desde o início, sem gastar IA:
//  1) registra a lista de arquivos do PNCP quando ela ficou vazia (falha momentânea na captura);
//  2) baixa o EDITAL principal para o Storage (não para o banco), para o usuário baixar na hora, mesmo com o
//     PNCP fora do ar — os anexos continuam baixando no clique;
//  3) completa o valor estimado quando a captura não o recebeu: soma dos itens do PNCP ou valor escrito no edital.

const TENTAR_DE_NOVO_APOS_MS = 24 * 3_600_000;
// A consulta de itens do PNCP devolve até 500 por página: com tanto, o total pode estar incompleto.
const ITENS_POR_PAGINA_PNCP = 500;
const LIMITE_BYTES_LEITURA_TEXTO = 12 * 1024 * 1024;

/** Valor do edital pela soma dos itens publicados no PNCP. Devolve false se o PNCP não respondeu (tenta depois). */
export async function preencherValorPelosItens(edital: { id: string; numeroControlePNCP: string }): Promise<boolean> {
  const ref = parseNumeroControlePNCP(edital.numeroControlePNCP);
  const agora = new Date();
  if (!ref) {
    await prisma.edital.update({ where: { id: edital.id }, data: { valorTentadoEm: agora } });
    return true;
  }
  let itens;
  try {
    itens = await buscarItensCompra(ref.cnpj, ref.ano, ref.sequencial);
  } catch {
    return false; // PNCP indisponível: não marca como tentado
  }
  const r = somarValorDosItens(itens);
  if (r.sigiloso) {
    await prisma.edital.update({ where: { id: edital.id }, data: { orcamentoSigiloso: true, valorGlobal: null, valorOrigem: null, valorTentadoEm: agora } });
  } else if (r.valor != null) {
    const parcial = r.parcial || itens.length >= ITENS_POR_PAGINA_PNCP;
    await prisma.edital.update({
      where: { id: edital.id },
      data: { valorGlobal: r.valor, valorOrigem: parcial ? "ITENS_PARCIAL" : "ITENS", valorTentadoEm: agora },
    });
  } else {
    await prisma.edital.update({ where: { id: edital.id }, data: { valorTentadoEm: agora } });
  }
  return true;
}

/** Registra os arquivos do edital no PNCP quando o edital ainda não tem nenhum documento oficial. */
export async function registrarDocumentosPncpSeFaltar(edital: { id: string; numeroControlePNCP: string }): Promise<number> {
  const ref = parseNumeroControlePNCP(edital.numeroControlePNCP);
  if (!ref) return 0;
  const existentes = await prisma.document.count({ where: { editalId: edital.id, tipo: "DOCUMENTO_PNCP" } });
  if (existentes > 0) return 0;

  let arquivos;
  try {
    arquivos = await buscarArquivosCompra(ref.cnpj, ref.ano, ref.sequencial);
  } catch {
    return 0; // não marca como consultado: a próxima rodada tenta de novo
  }
  const { edital: docEdital, termoReferencia, anexosPrecos } = selecionarDocumentosPrincipais(arquivos);
  const novos = [
    ...(docEdital ? [{ nome: docEdital.titulo, origemUrl: docEdital.url, categoria: "EDITAL" as const }] : []),
    ...(termoReferencia ? [{ nome: termoReferencia.titulo, origemUrl: termoReferencia.url, categoria: "TERMO_REFERENCIA" as const }] : []),
    ...anexosPrecos.map((a) => ({ nome: a.titulo, origemUrl: a.url, categoria: "ANEXO_PRECOS" as const })),
  ];
  for (const d of novos) {
    await prisma.document.create({
      data: { editalId: edital.id, nome: d.nome, tipo: "DOCUMENTO_PNCP", categoria: d.categoria, status: "DISPONIVEL", origemUrl: d.origemUrl, conteudoBase64: null },
    });
  }
  await prisma.edital.update({ where: { id: edital.id }, data: { documentosConsultadosEm: new Date() } });
  return novos.length;
}

/** Texto de um PDF SEM OCR (não usa IA): só a camada de texto. Outros formatos ou PDF escaneado = null. */
async function textoDoPdfSemOcr(bytes: Uint8Array): Promise<string | null> {
  if (bytes.byteLength > LIMITE_BYTES_LEITURA_TEXTO) return null;
  const ehPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // %PDF
  if (!ehPdf) return null;
  try {
    const pdf = await getDocumentProxy(bytes.slice());
    const { text } = await extractText(pdf, { mergePages: true });
    const t = Array.isArray(text) ? text.join("\n") : text;
    return t.trim().length > 200 ? t : null;
  } catch {
    return null;
  }
}

/** Baixa o edital principal para o Storage (se ainda não foi) e, se faltar o valor, procura-o no texto. */
export async function baixarEditalPrincipal(editalId: string): Promise<boolean> {
  const doc = await prisma.document.findFirst({
    where: {
      editalId,
      tipo: { in: ["DOCUMENTO_PNCP", "DOCUMENTO_LICITANET"] },
      categoria: "EDITAL",
      conteudoBase64: null,
      storagePath: null,
      origemUrl: { not: null },
    },
    orderBy: { createdAt: "asc" },
    include: { edital: { select: { companyId: true, fonte: true, valorGlobal: true, orcamentoSigiloso: true, valorTentadoEm: true } } },
  });
  if (!doc) return false;

  const arquivo = await baixarEPersistirDocumento(
    { id: doc.id, editalId, nome: doc.nome, tipo: doc.tipo, origemUrl: doc.origemUrl! },
    doc.edital.companyId
  );

  const e = doc.edital;
  // PNCP: o valor pelos itens já foi tentado antes; o texto é a segunda chance. LicitaNet não tem itens: o texto é a única.
  if (e.valorGlobal == null && !e.orcamentoSigiloso && (e.fonte === "LICITANET" || e.valorTentadoEm != null)) {
    const texto = await textoDoPdfSemOcr(arquivo.bytes);
    const valor = texto ? extrairValorDoTexto(texto) : null;
    await prisma.edital
      .update({
        where: { id: editalId },
        data: valor != null ? { valorGlobal: valor, valorOrigem: "EDITAL", valorTentadoEm: new Date() } : { valorTentadoEm: new Date() },
      })
      .catch(() => null);
  }
  return true;
}

export type ResultadoReparo = { valores: number; documentosRegistrados: number; editaisBaixados: number; falhas: number };

/**
 * Passada de manutenção em segundo plano: completa valor, lista de arquivos e download do edital principal dos
 * editais que ainda precisam, em lotes pequenos e com limite de tempo. Seguro de repetir: só mexe no que falta.
 */
export async function repararEditais(opts: { companyId?: string; limite?: number; ateMs?: number } = {}): Promise<ResultadoReparo> {
  const limite = opts.limite ?? 10;
  const fim = Date.now() + (opts.ateMs ?? 25_000);
  const resultado: ResultadoReparo = { valores: 0, documentosRegistrados: 0, editaisBaixados: 0, falhas: 0 };
  const dono = opts.companyId ? { companyId: opts.companyId } : {};
  const vivos = { etapaKanban: { not: "RASCUNHO" as const } };
  const aindaAbertos = { OR: [{ dataEncerramentoProposta: null }, { dataEncerramentoProposta: { gt: new Date() } }] };

  // 1. Valor pelos itens do PNCP
  const semValor = await prisma.edital.findMany({
    where: { ...dono, ...vivos, fonte: "PNCP", valorGlobal: null, orcamentoSigiloso: false, valorTentadoEm: null },
    select: { id: true, numeroControlePNCP: true },
    orderBy: { createdAt: "desc" },
    take: limite * 3,
  });
  await mapComLimite(semValor, 4, async (e) => {
    if (Date.now() > fim) return;
    try {
      if (await preencherValorPelosItens(e)) resultado.valores++;
    } catch {
      resultado.falhas++;
    }
  });

  // 2. Editais do PNCP sem nenhum documento registrado (consulta falhou na captura)
  if (Date.now() < fim) {
    const semArquivos = await prisma.edital.findMany({
      where: {
        ...dono,
        ...vivos,
        fonte: "PNCP",
        documents: { none: { tipo: "DOCUMENTO_PNCP" } },
        OR: [{ documentosConsultadosEm: null }, { documentosConsultadosEm: { lt: new Date(Date.now() - TENTAR_DE_NOVO_APOS_MS) } }],
      },
      select: { id: true, numeroControlePNCP: true },
      orderBy: { createdAt: "desc" },
      take: limite * 2,
    });
    await mapComLimite(semArquivos, 4, async (e) => {
      if (Date.now() > fim) return;
      try {
        resultado.documentosRegistrados += await registrarDocumentosPncpSeFaltar(e);
        // Mesmo sem arquivo publicado, marca a consulta para não repetir a cada rodada.
        await prisma.edital.updateMany({ where: { id: e.id, documentosConsultadosEm: null }, data: { documentosConsultadosEm: new Date() } });
      } catch {
        resultado.falhas++;
      }
    });
  }

  // 3. Edital principal para o Storage (os que fecham primeiro vêm antes)
  if (Date.now() < fim) {
    const pendentes = await prisma.edital.findMany({
      where: {
        ...dono,
        ...vivos,
        ...aindaAbertos,
        documents: {
          some: { tipo: { in: ["DOCUMENTO_PNCP", "DOCUMENTO_LICITANET"] }, categoria: "EDITAL", conteudoBase64: null, storagePath: null, origemUrl: { not: null } },
        },
      },
      select: { id: true },
      orderBy: [{ dataEncerramentoProposta: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      take: Math.max(2, Math.floor(limite / 2)),
    });
    await mapComLimite(pendentes, 3, async (e) => {
      if (Date.now() > fim) return;
      try {
        if (await baixarEditalPrincipal(e.id)) resultado.editaisBaixados++;
      } catch (err) {
        resultado.falhas++;
        console.error(`Não foi possível guardar o edital principal ${e.id}:`, err instanceof Error ? err.message : err);
      }
    });
  }
  return resultado;
}

/** Um edital específico (ao abrir o card): garante arquivos, edital principal e valor. */
export async function repararUmEdital(editalId: string): Promise<void> {
  const e = await prisma.edital.findUnique({
    where: { id: editalId },
    select: { id: true, fonte: true, numeroControlePNCP: true, etapaKanban: true, valorGlobal: true, orcamentoSigiloso: true, valorTentadoEm: true },
  });
  if (!e || e.etapaKanban === "RASCUNHO") return;
  if (e.fonte === "PNCP") {
    await registrarDocumentosPncpSeFaltar(e).catch(() => null);
    if (e.valorGlobal == null && !e.orcamentoSigiloso && e.valorTentadoEm == null) await preencherValorPelosItens(e).catch(() => null);
  }
  await baixarEditalPrincipal(e.id).catch(() => null);
}
