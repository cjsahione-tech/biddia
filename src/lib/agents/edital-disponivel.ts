import { extractText, getDocumentProxy } from "unpdf";
import { prisma } from "@/lib/prisma";
import { mapComLimite } from "@/lib/concorrencia";
import {
  buscarArquivosCompra,
  buscarDetalheCompra,
  buscarItensCompra,
  parseNumeroControlePNCP,
  selecionarDocumentosPrincipais,
} from "@/lib/agents/pncp";
import { baixarEPersistirDocumento } from "@/lib/agents/document-download";
import { extrairValorDoTexto, somarValorDosItens } from "@/lib/valor-edital";
import { logAudit } from "@/lib/agents/run-tracker";

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

export const SITUACAO_REMOVIDA_PNCP = "Removida do PNCP pelo órgão";

/**
 * O órgão apagou esta contratação do PNCP (muito comum: ele republica com outro número). Sem isso o usuário só via
 * "não consegui ler os arquivos". Marca o card, registra um aviso e, se a versão republicada já estiver no quadro
 * (mesmo órgão e mesmo título), diz qual é.
 */
export async function marcarCompraRemovida(edital: { id: string }): Promise<void> {
  const e = await prisma.edital.findUnique({ where: { id: edital.id }, select: { companyId: true, orgaoCnpj: true, titulo: true, situacao: true } });
  if (!e || e.situacao === SITUACAO_REMOVIDA_PNCP) return;
  await prisma.edital.update({ where: { id: edital.id }, data: { situacao: SITUACAO_REMOVIDA_PNCP } });
  const substituto = await prisma.edital.findFirst({
    where: { companyId: e.companyId, orgaoCnpj: e.orgaoCnpj, titulo: e.titulo, id: { not: edital.id }, situacao: { not: SITUACAO_REMOVIDA_PNCP } },
    select: { titulo: true, numeroControlePNCP: true, etapaKanban: true },
    orderBy: { createdAt: "desc" },
  });
  const sufixo = substituto
    ? ` Já existe no seu quadro uma contratação do mesmo órgão e com o mesmo título (${substituto.numeroControlePNCP}, coluna "${substituto.etapaKanban}") — provavelmente a versão republicada; use ela.`
    : " Se o órgão republicou, a nova versão aparece numa próxima busca; ou envie o edital em PDF pelo botão “Adicionar PDF”.";
  await logAudit(edital.id, "Agente Comercial", "Contratação removida do PNCP", "ALERTA", `O órgão apagou esta contratação do PNCP, por isso os arquivos não podem mais ser baixados.${sufixo}`);
}

/**
 * Completa os arquivos do edital com o que o PNCP publica agora: registra os principais (edital — inclusive vários
 * arquivos do tipo "Edital" —, termo de referência e anexos de preços) que ainda não estão cadastrados. Cobre
 * falha momentânea na captura, arquivos publicados depois e a capa que escondia o edital de verdade.
 */
export async function completarDocumentosPncp(edital: { id: string; numeroControlePNCP: string }): Promise<{ novos: number; removida: boolean }> {
  const ref = parseNumeroControlePNCP(edital.numeroControlePNCP);
  if (!ref) return { novos: 0, removida: false };

  let arquivos;
  try {
    arquivos = await buscarArquivosCompra(ref.cnpj, ref.ano, ref.sequencial);
  } catch (err) {
    // 404 na lista de arquivos E sem detalhe da compra = o órgão apagou a contratação (um 404 isolado pode ser instabilidade).
    const sem404 = !(err instanceof Error) || !err.message.includes("(404)");
    if (sem404) return { novos: 0, removida: false };
    const detalhe = await buscarDetalheCompra(ref.cnpj, ref.ano, ref.sequencial).catch(() => null);
    if (detalhe) return { novos: 0, removida: false };
    await marcarCompraRemovida(edital);
    await prisma.edital.update({ where: { id: edital.id }, data: { documentosConsultadosEm: new Date() } });
    return { novos: 0, removida: true };
  }

  const { editais, termoReferencia, anexosPrecos } = selecionarDocumentosPrincipais(arquivos);
  const principais = [
    ...editais.map((a) => ({ nome: a.titulo, origemUrl: a.url, categoria: "EDITAL" as const })),
    ...(termoReferencia ? [{ nome: termoReferencia.titulo, origemUrl: termoReferencia.url, categoria: "TERMO_REFERENCIA" as const }] : []),
    ...anexosPrecos.map((a) => ({ nome: a.titulo, origemUrl: a.url, categoria: "ANEXO_PRECOS" as const })),
  ];
  const registrados = new Set(
    (await prisma.document.findMany({ where: { editalId: edital.id, tipo: "DOCUMENTO_PNCP" }, select: { origemUrl: true } })).map((d) => d.origemUrl)
  );
  let novos = 0;
  for (const d of principais) {
    if (registrados.has(d.origemUrl)) continue;
    await prisma.document.create({
      data: { editalId: edital.id, nome: d.nome, tipo: "DOCUMENTO_PNCP", categoria: d.categoria, status: "DISPONIVEL", origemUrl: d.origemUrl, conteudoBase64: null },
    });
    novos++;
  }
  await prisma.edital.update({ where: { id: edital.id }, data: { documentosConsultadosEm: new Date() } });
  return { novos, removida: false };
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

  // 2. Completa os arquivos do PNCP: editais ainda não conferidos (os de antes desta rotina, falha na captura, capa no
  // lugar do edital) e os que seguem sem documento depois de um dia.
  if (Date.now() < fim) {
    const paraCompletar = await prisma.edital.findMany({
      where: {
        ...dono,
        ...vivos,
        fonte: "PNCP",
        situacao: { not: SITUACAO_REMOVIDA_PNCP },
        OR: [
          { documentosConsultadosEm: null },
          { documents: { none: { tipo: "DOCUMENTO_PNCP" } }, documentosConsultadosEm: { lt: new Date(Date.now() - TENTAR_DE_NOVO_APOS_MS) } },
        ],
      },
      select: { id: true, numeroControlePNCP: true },
      orderBy: { createdAt: "desc" },
      take: limite * 2,
    });
    await mapComLimite(paraCompletar, 4, async (e) => {
      if (Date.now() > fim) return;
      try {
        const r = await completarDocumentosPncp(e);
        resultado.documentosRegistrados += r.novos;
        // Mesmo sem arquivo novo, marca a consulta para não repetir a cada rodada.
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
    await completarDocumentosPncp(e).catch(() => null);
    if (e.valorGlobal == null && !e.orcamentoSigiloso && e.valorTentadoEm == null) await preencherValorPelosItens(e).catch(() => null);
  }
  await baixarEditalPrincipal(e.id).catch(() => null);
}
