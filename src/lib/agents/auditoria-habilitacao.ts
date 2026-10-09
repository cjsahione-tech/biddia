import type { Document as DocumentRow, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { askJSON, MODELO_HAIKU, MODELO_SONNET, type UsoTokens } from "@/lib/anthropic";
import { descreverErro } from "@/lib/ia-erros";
import { mapComLimite } from "@/lib/concorrencia";
import { logAudit } from "@/lib/agents/run-tracker";
import { baixarDocumentosPendentes } from "@/lib/agents/agente1-comercial";
import { obterTextoBrutoDocumento } from "@/lib/agents/pdf-extract";
import { MARCA_ILEGIVEL } from "@/lib/agents/arquivos-compactados";
import { dispararAuditoriaHabilitacao } from "@/lib/agents/auditoria-dispatch";
import { notificarPrazosVencendo } from "@/lib/notifications";
import {
  CATALOGO_DOCUMENTOS,
  CATEGORIAS_CATALOGO,
  chaveEfetivaDoDocumento,
  equivalentesDe,
  itemPorChave,
} from "@/lib/catalogo-documentos";
import {
  AUDITORIA_HABILITACAO_DESDE,
  avaliarExigencia,
  calcularResultado,
  custoEstimadoUsd,
  dataReferenciaDoEdital,
  dividirEmPedacos,
  inferirNaturezaPelaRazaoSocial,
  epochNoNome,
  fingerprintDocumentos,
  type SituacaoExigencia,
} from "@/lib/habilitacao";

// Auditoria de habilitação: lê TUDO que o processo tem (edital, termo de referência, anexos —
// inclusive dentro de ZIPs), levanta cada documento de habilitação exigido, confere com a
// documentação da empresa (tela Documentos) e grava o resultado e a lista de exigências.
//
// Sem botão: roda sozinha depois da captação do edital (ver agente1-comercial.ts) e refaz a
// conferência quando a documentação da empresa muda (ver reavaliarEditaisDaEmpresa).
//
// Cabe em execuções de 60s da Vercel: o edital é lido em pedaços, quatro por vez; se não der
// tempo, o progresso fica salvo e uma nova execução continua de onde parou (até 3 execuções).

const ORCAMENTO_MS = 50_000; // tempo de trabalho por execução (limite da Vercel: 60s)
const FOLGA_EXTRACAO_MS = 22_000; // só começa uma leva de pedaços se sobrar isto
const FOLGA_CONFERENCIA_MS = 28_000; // a conferência final (Sonnet) precisa de mais folga
const PEDACOS_EM_PARALELO = 4;
const MAX_CONTINUACOES = 2;
const NOME_AGENTE = "Auditor de Habilitação";

type Bruta = {
  categoria: string;
  documento: string;
  chave: string | null;
  origem: string;
  localizacao: string | null;
  condicao: string | null;
  // Só vale para certo tipo de empresa/situação (ex.: "apenas cooperativas").
  aplicavelSe: string | null;
};

type Progresso = { chunksTotal: number; feitos: number[]; brutas: Bruta[] };

type Pedaco = { docNome: string; indice: number; total: number; texto: string };

const IDS_CATEGORIA = CATEGORIAS_CATALOGO.map((c) => c.id);

// ── Documentos do processo ──────────────────────────────────────────────────

/**
 * Quais documentos do processo são lidos. Todos — exceto as versões ANTERIORES de um mesmo
 * edital do LicitaNet (o órgão reenvia o edital ao retificar; só o envio mais recente vale).
 */
export function selecionarDocumentos<T extends { nome: string; tipo: string; categoria: string | null; createdAt: Date }>(
  docs: T[]
): { lidos: T[]; ignorados: T[] } {
  const editaisLicitaNet = docs.filter((d) => d.tipo === "DOCUMENTO_LICITANET" && d.categoria === "EDITAL");
  let maisRecente: T | null = null;
  for (const d of editaisLicitaNet) {
    if (!maisRecente) maisRecente = d;
    else {
      const [a, b] = [epochNoNome(d.nome), epochNoNome(maisRecente.nome)];
      if (a > b || (a === b && d.createdAt > maisRecente.createdAt)) maisRecente = d;
    }
  }
  const ignorados = editaisLicitaNet.filter((d) => d !== maisRecente);
  return { lidos: docs.filter((d) => !ignorados.includes(d)), ignorados };
}

// ── Extração (Haiku) ────────────────────────────────────────────────────────

const LISTA_CATALOGO_PROMPT = CATALOGO_DOCUMENTOS.map((i) => `- ${i.chave}: ${i.nome} [${i.aplicacao === "PS" ? "P+S" : i.aplicacao}]`).join("\n");
const LISTA_CATEGORIAS_PROMPT = CATEGORIAS_CATALOGO.map((c) => `- ${c.id}: ${c.titulo}`).join("\n");

function promptExtracao(): string {
  return `Você lê um TRECHO de um documento de licitação pública brasileira (edital, termo de referência ou anexo) e
levanta TODA exigência de DOCUMENTO DE HABILITAÇÃO que o LICITANTE precisa apresentar para ser habilitado:
habilitação jurídica, regularidade fiscal, regularidade trabalhista, qualificação econômico-financeira,
qualificação técnica (empresa e equipe), certificados e atestados, declarações exigidas, garantia de proposta.

NÃO inclua: itens da proposta de preços (planilha, proposta comercial), obrigações de execução do contrato,
documentos que o próprio órgão emite, nem regras gerais sem documento a apresentar. Se o trecho não tem
nenhuma exigência de documento de habilitação, devolva a lista vazia. NÃO invente nada: só o que está escrito.
Se o mesmo documento aparece mais de uma vez no trecho, liste uma vez.

Categorias (campo "categoria" — use exatamente um destes ids):
${LISTA_CATEGORIAS_PROMPT}

Catálogo de documentos conhecidos (campo "chave": o id do item SOMENTE se o documento exigido É esse mesmo
documento. Não use um item parecido, da mesma categoria ou "quase igual" — nesse caso use null):
${LISTA_CATALOGO_PROMPT}

Campos de cada exigência:
- "categoria": id da categoria.
- "documento": o documento exigido, descrito de forma curta e fiel ao edital.
- "chave": id do catálogo ou null.
- "arquivo": o nome do arquivo de onde veio, tirado da linha "===== ARQUIVO: nome =====" mais próxima acima, ou null.
- "localizacao": onde está no texto — item/cláusula (ex.: "item 8.2.1") e a página (as marcas "[Pág. N]" do texto
  indicam a página; ex.: "item 8.2.1, pág. 14"). null se não constar. NUNCA cite "trecho" nem números de trecho
  (isso é só a divisão interna da leitura).
- "condicao": condição ou requisito que o documento precisa cumprir, quando o texto disser (ex.: "índices de
  liquidez maiores que 1,00", "atestado de pelo menos 50% do quantitativo", "emitido nos últimos 90 dias"),
  senão null.
- "aplicavelSe": se a exigência só vale para um tipo específico de empresa ou situação (ex.: "apenas cooperativas",
  "somente empresa estrangeira", "empresário individual", "sociedades simples", "ME/EPP optante pelo Simples",
  "consórcios"), descreva em poucas palavras; se vale para todos os licitantes, null.

Responda em JSON: { "exigencias": [ { "categoria": string, "documento": string, "chave": string | null, "arquivo": string | null, "localizacao": string | null, "condicao": string | null, "aplicavelSe": string | null } ] }`;
}

async function extrairDoPedaco(pedaco: Pedaco, uso: UsoTokens): Promise<Bruta[]> {
  const r = await askJSON<{
    exigencias?: { categoria?: string; documento?: string; chave?: string | null; arquivo?: string | null; localizacao?: string | null; condicao?: string | null; aplicavelSe?: string | null }[];
  }>(
    promptExtracao(),
    `Documento: ${pedaco.docNome} (trecho ${pedaco.indice + 1} de ${pedaco.total})\n\n${pedaco.texto}`,
    { model: MODELO_HAIKU, maxTokens: 6000, uso }
  );

  const brutas: Bruta[] = [];
  for (const e of r.exigencias ?? []) {
    const documento = e.documento?.trim();
    if (!documento) continue;
    const categoria = e.categoria && IDS_CATEGORIA.includes(e.categoria as never) ? e.categoria : "outros";
    brutas.push({
      categoria,
      documento,
      chave: e.chave && itemPorChave(e.chave) ? e.chave : null,
      origem: e.arquivo?.trim() || pedaco.docNome,
      localizacao: e.localizacao?.trim() || null,
      condicao: e.condicao?.trim() || null,
      aplicavelSe: e.aplicavelSe?.trim() || null,
    });
  }
  return brutas;
}

// ── Conferência (Sonnet) ────────────────────────────────────────────────────

type DocEmpresa = {
  id: string;
  tipo: string;
  nome: string;
  catalogoChave: string | null;
  validade: Date | null;
  updatedAt: Date;
};

type Final = {
  categoria: string;
  documento: string;
  chave: string | null;
  origem: string;
  localizacao: string | null;
  condicao: string | null;
  aplicavelSe: string | null;
  /** false = a exigência não vale para esta empresa (com certeza); true/null = vale ou não dá para saber. */
  aplica: boolean | null;
  docEmpresaId: string | null;
  certeza: boolean;
  acaoSugerida: string | null;
};

async function carregarDocsDaEmpresa(companyId: string): Promise<DocEmpresa[]> {
  return prisma.companyDocument.findMany({
    where: { companyId },
    select: { id: true, tipo: true, nome: true, catalogoChave: true, validade: true, updatedAt: true },
    orderBy: { createdAt: "desc" },
  });
}

async function carregarFatosDaEmpresa(companyId: string): Promise<FatosEmpresa> {
  const c = await prisma.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { razaoSocial: true, regimeTributarioPadrao: true, atendeBem: true, atendeServico: true },
  });
  return { razaoSocial: c.razaoSocial, natureza: inferirNaturezaPelaRazaoSocial(c.razaoSocial), regime: c.regimeTributarioPadrao, atendeBem: c.atendeBem, atendeServico: c.atendeServico };
}

/** Documento da empresa por item do catálogo (o mais recente de cada item). */
function indexarPorChave(docs: DocEmpresa[]): Map<string, DocEmpresa> {
  const mapa = new Map<string, DocEmpresa>();
  for (const d of docs) {
    const chave = chaveEfetivaDoDocumento(d);
    if (chave && !mapa.has(chave)) mapa.set(chave, d);
  }
  return mapa;
}

function removerDuplicadas(brutas: Bruta[]): Bruta[] {
  const vistos = new Set<string>();
  const out: Bruta[] = [];
  for (const b of brutas) {
    const k = `${b.chave ?? "-"}|${b.documento.toLowerCase().replace(/\s+/g, " ")}`;
    if (vistos.has(k)) continue;
    vistos.add(k);
    out.push(b);
  }
  return out;
}

// Exigências por chamada à IA: lotes pequenos rodam em paralelo e cada um responde em poucos
// segundos (uma chamada só, com tudo, passava dos 60s da Vercel em editais com dezenas de itens).
const EXIGENCIAS_POR_LOTE = 18;

/**
 * Conferência final (Sonnet). A IA NÃO reescreve os textos: devolve só um mapa compacto —
 * quais exigências são o mesmo documento (se juntam), o item do catálogo, qual documento da
 * empresa atende, se tem certeza e uma ação sugerida curta. Os textos (documento, origem,
 * localização, condição) vêm do levantamento, preservados.
 */
type FatosEmpresa = { razaoSocial: string; natureza: string | null; regime: string | null; atendeBem: boolean; atendeServico: boolean };

async function conferirComIA(brutas: Bruta[], docs: DocEmpresa[], uso: UsoTokens, empresa: FatosEmpresa): Promise<Final[]> {
  if (brutas.length === 0) return [];
  const porChave = indexarPorChave(docs);
  const personalizados = docs.filter((d) => !chaveEfetivaDoDocumento(d));

  const listaDocs = [
    ...Array.from(porChave.entries()).map(([chave, d]) => `- ${d.id} | item do catálogo: ${chave} | arquivo: ${d.nome}`),
    ...personalizados.map((d) => `- ${d.id} | personalizado: ${d.tipo} | arquivo: ${d.nome}`),
  ].join("\n");

  const sistema = `Você é o conferente final de habilitação de uma licitação pública brasileira. Recebe exigências de
documentos de habilitação levantadas do edital/termo de referência (numeradas E1, E2...) e a lista de documentos
que a EMPRESA tem. Devolva um mapa COMPACTO — não reescreva os textos das exigências.

Regras:
1. AGRUPE as exigências que são o MESMO documento (ex.: repetida no edital e no termo de referência): coloque os
   números juntos em "ids". Documentos diferentes NUNCA se agrupam. Toda exigência recebida deve aparecer em
   exatamente um grupo.
2. "chave": o item do catálogo SOMENTE se o documento exigido É esse mesmo documento (confirme ou corrija a
   sugestão). Não use item parecido, da mesma categoria ou "quase igual" — nesse caso null (ex.: "Registro
   Comercial" NÃO é o Cartão CNPJ; "comprovante de opção pelo Simples" NÃO é a certidão de tributos federais):
${LISTA_CATALOGO_PROMPT}
3. "docEmpresaId": o id (da lista de documentos da empresa) do documento que atende, ou null se a empresa não tem
   nada que atenda. Prefira o documento do mesmo item do catálogo. Um documento PERSONALIZADO só atende se o nome
   indicar claramente o documento exigido.
4. "certeza": true só se você tem CERTEZA de que entendeu qual DOCUMENTO é exigido e de que o documento escolhido
   (ou a ausência dele) está certo. Em dúvida sobre o documento — exigência vaga ("documento equivalente"), nome
   ambíguo — false. Condições numéricas ou de conteúdo do documento (índices, percentuais, prazos de emissão) NÃO
   são dúvida: são só informativas e não mudam a certeza.
5. "acao": uma frase curta (até 15 palavras), em português simples, do que a empresa deve fazer, ou null se já
   está atendida.
6. "aplica": algumas exigências dizem "aplicavelSe" (só valem para um tipo de empresa/situação). Com base nos dados
   da empresa abaixo, responda "sim" se a exigência VALE para esta empresa (ex.: "sociedades empresárias" e a empresa
   é uma LTDA), "nao" se tem certeza de que NÃO vale (ex.: "apenas cooperativas" e a empresa é uma LTDA), ou
   "nao_sei" se os dados não permitem saber (ex.: "ME/EPP" sem o porte informado). Sem "aplicavelSe", responda "sim".

DADOS DA EMPRESA: razão social "${empresa.razaoSocial}"; tipo de empresa pelo nome: ${empresa.natureza ?? "não dá para saber pelo nome"}; regime tributário padrão: ${empresa.regime ?? "não informado"};
atua com ${[empresa.atendeBem ? "venda de produtos" : null, empresa.atendeServico ? "prestação de serviços" : null].filter(Boolean).join(" e ") || "não informado"}.

Responda em JSON: { "grupos": [ { "ids": ["E1","E7"], "chave": string | null, "docEmpresaId": string | null, "certeza": boolean, "aplica": "sim" | "nao" | "nao_sei", "acao": string | null } ] }`;

  // Ordena por categoria para que repetições caiam no mesmo lote.
  const ordenadas = [...brutas].sort((x, y) => x.categoria.localeCompare(y.categoria) || x.documento.localeCompare(y.documento));
  const lotes: Bruta[][] = [];
  for (let i = 0; i < ordenadas.length; i += EXIGENCIAS_POR_LOTE) lotes.push(ordenadas.slice(i, i + EXIGENCIAS_POR_LOTE));

  const idsValidos = new Set(docs.map((d) => d.id));

  const resultados = await mapComLimite(lotes, 4, async (lote) => {
    const entrada = lote
      .map(
        (b, i) =>
          `E${i + 1} | categoria: ${b.categoria} | documento: ${b.documento} | chave sugerida: ${b.chave ?? "nenhuma"} | local: ${b.localizacao ?? "—"} | condição: ${b.condicao ?? "—"} | aplicavelSe: ${b.aplicavelSe ?? "—"}`
      )
      .join("\n");
    const r = await askJSON<{
      grupos?: { ids?: string[]; chave?: string | null; docEmpresaId?: string | null; certeza?: boolean; aplica?: string; acao?: string | null }[];
    }>(
      sistema,
      `=== EXIGÊNCIAS LEVANTADAS ===\n${entrada}\n\n=== DOCUMENTOS DA EMPRESA ===\n${listaDocs || "(a empresa ainda não enviou nenhum documento)"}`,
      { model: MODELO_SONNET, maxTokens: 4000, uso }
    );

    const finais: Final[] = [];
    const usadas = new Set<number>();
    for (const g of r.grupos ?? []) {
      const idx = (g.ids ?? [])
        .map((id) => Number(String(id).replace(/\D/g, "")) - 1)
        .filter((n) => Number.isInteger(n) && n >= 0 && n < lote.length && !usadas.has(n));
      if (idx.length === 0) continue;
      idx.forEach((n) => usadas.add(n));
      const base = lote[idx[0]];
      const locais = Array.from(new Set(idx.map((n) => lote[n].localizacao).filter((x): x is string => !!x)));
      const origens = Array.from(new Set(idx.map((n) => lote[n].origem)));
      const condicoes = Array.from(new Set(idx.map((n) => lote[n].condicao).filter((x): x is string => !!x)));
      finais.push({
        categoria: base.categoria,
        documento: base.documento,
        chave: g.chave && itemPorChave(g.chave) ? g.chave : base.chave,
        origem: origens.join("; "),
        localizacao: locais.length > 0 ? locais.join("; ") : null,
        condicao: condicoes.length > 0 ? condicoes.join("; ") : null,
        aplicavelSe: idx.map((n) => lote[n].aplicavelSe).find((x): x is string => !!x) ?? null,
        // false = não vale (com certeza); true = vale; null = não dá para saber. Só vale a resposta da
        // IA quando a exigência realmente é condicional ao tipo de empresa; senão, vale para todos.
        aplica: !idx.some((n) => lote[n].aplicavelSe) ? true : g.aplica === "nao" ? false : g.aplica === "sim" ? true : null,
        // Só aceita id que de fato existe na documentação desta empresa (nunca confia na IA).
        docEmpresaId: g.docEmpresaId && idsValidos.has(g.docEmpresaId) ? g.docEmpresaId : null,
        certeza: g.certeza === true,
        acaoSugerida: g.acao?.trim() || null,
      });
    }
    // Exigência que a IA esqueceu de devolver NÃO some: entra como "verificar manualmente".
    lote.forEach((b, n) => {
      if (usadas.has(n)) return;
      finais.push({
        categoria: b.categoria,
        documento: b.documento,
        chave: b.chave,
        origem: b.origem,
        localizacao: b.localizacao,
        condicao: b.condicao,
        aplicavelSe: b.aplicavelSe,
        aplica: null,
        docEmpresaId: null,
        certeza: false,
        acaoSugerida: null,
      });
    });
    return finais;
  });

  return resultados.flat();
}

// ── Avaliação e gravação ────────────────────────────────────────────────────

type LinhaAvaliada = {
  ordem: number;
  categoria: string;
  documento: string;
  catalogoChave: string | null;
  origem: string;
  localizacao: string | null;
  condicao: string | null;
  aplicavelSe: string | null;
  situacao: SituacaoExigencia;
  documentoEmpresaId: string | null;
  validade: Date | null;
  certezaMapeamento: boolean;
  observacao: string;
  acaoSugerida: string | null;
  venceAntesDaSessao: boolean;
};

const ACAO_PADRAO: Record<SituacaoExigencia, string> = {
  ATENDIDA: "",
  NAO_ENVIADA: "Reunir o documento e enviá-lo na tela Documentos.",
  VENCIDA: "Renovar o documento e enviar a versão atualizada na tela Documentos.",
  VERIFICAR: "Conferir manualmente se algum documento da empresa atende a esta exigência.",
  NAO_SE_APLICA: "",
};

/** Decide a situação de cada exigência. Determinístico: a IA só diz qual documento e se tem certeza. */
export function avaliarTodas(
  finais: Pick<Final, "categoria" | "documento" | "chave" | "origem" | "localizacao" | "condicao" | "aplicavelSe" | "aplica" | "docEmpresaId" | "certeza" | "acaoSugerida">[],
  docs: DocEmpresa[],
  dataReferencia: Date
): LinhaAvaliada[] {
  const porChave = indexarPorChave(docs);
  const porId = new Map(docs.map((d) => [d.id, d]));

  return finais.map((f, i) => {
    // Exigência de outro tipo de empresa (ex.: "para cooperativa"): fora da conta.
    if (f.aplica === false) {
      return {
        ordem: i,
        categoria: f.categoria,
        documento: f.documento,
        catalogoChave: f.chave,
        origem: f.origem,
        localizacao: f.localizacao,
        condicao: f.condicao,
        aplicavelSe: f.aplicavelSe,
        situacao: "NAO_SE_APLICA" as SituacaoExigencia,
        documentoEmpresaId: null,
        validade: null,
        certezaMapeamento: true,
        observacao: `Não se aplica a esta empresa${f.aplicavelSe ? ` (vale ${f.aplicavelSe.toLowerCase()})` : ""}.`,
        acaoSugerida: null,
        venceAntesDaSessao: false,
      };
    }
    let doc: DocEmpresa | null = null;
    let certeza = f.certeza;
    let nota = "";
    // Exigência que só vale para certo tipo de empresa e não dá para ter certeza de que NÃO vale
    // para esta: nunca é creditada sozinha — vai para conferência manual.
    if (f.aplicavelSe && f.aplica !== true) {
      certeza = false;
      nota = ` Esta exigência só vale para: ${f.aplicavelSe} — confirme se se aplica à empresa.`;
    }

    if (f.chave) {
      // Item do catálogo: o documento enviado nesse item é o que vale (não depende da IA).
      doc = porChave.get(f.chave) ?? null;
      if (!doc) {
        // Enviado na "versão" de produto/serviço do mesmo documento? Só serve com conferência humana.
        for (const eq of equivalentesDe(f.chave)) {
          const alt = porChave.get(eq);
          if (alt) {
            doc = alt;
            certeza = false;
            nota += ` O documento foi enviado como "${itemPorChave(eq)?.nome}" — confira se serve para esta exigência.`;
            break;
          }
        }
      }
    }
    // A IA só pode indicar um documento PERSONALIZADO ("Outros"). Um documento de outro item do
    // catálogo nunca atende esta exigência por indicação da IA — só vale no próprio item.
    if (!doc && f.docEmpresaId) {
      const indicado = porId.get(f.docEmpresaId);
      if (indicado && !chaveEfetivaDoDocumento(indicado)) doc = indicado;
    }

    const av = avaliarExigencia({
      doc: doc ? { id: doc.id, validade: doc.validade } : null,
      certeza,
      dataReferencia,
    });

    // Sem item do catálogo e sem documento achado, "não enviada" só vale quando a IA tem certeza.
    return {
      ordem: i,
      categoria: f.categoria,
      documento: f.documento,
      catalogoChave: f.chave,
      origem: f.origem,
      localizacao: f.localizacao,
      condicao: f.condicao,
      aplicavelSe: f.aplicavelSe,
      situacao: av.situacao,
      documentoEmpresaId: av.documentoEmpresaId,
      validade: av.validade,
      certezaMapeamento: certeza,
      observacao: av.observacao + nota,
      acaoSugerida: av.situacao === "ATENDIDA" ? null : (f.acaoSugerida ?? ACAO_PADRAO[av.situacao]),
      venceAntesDaSessao: av.venceAntesDaSessao,
    };
  });
}

async function gravarResultado(opts: {
  editalId: string;
  linhas: LinhaAvaliada[];
  dataReferencia: Date;
  leituraCompleta: boolean;
  docsLidos?: { nome: string; caracteres: number; ok: boolean }[];
  docsEmpresa: DocEmpresa[];
  mensagem?: string | null;
  uso?: { haikuEntrada: number; haikuSaida: number; sonnetEntrada: number; sonnetSaida: number };
}) {
  const { editalId, linhas, dataReferencia, leituraCompleta, docsEmpresa } = opts;
  const r = calcularResultado({ situacoes: linhas.map((l) => l.situacao), leituraCompleta });

  // Preserva o aviso de vencimento já enviado para a mesma exigência (não repete a mensagem).
  const anteriores = await prisma.exigenciaHabilitacao.findMany({
    where: { editalId, alertadoEm: { not: null } },
    select: { documento: true, documentoEmpresaId: true, alertadoEm: true },
  });
  const alertadas = new Map(anteriores.map((a) => [`${a.documento}|${a.documentoEmpresaId}`, a.alertadoEm]));

  const dadosAuditoria: Prisma.AuditoriaHabilitacaoUpdateInput = {
    estado: "CONCLUIDA",
    mensagem: opts.mensagem ?? null,
    dataReferencia,
    totalExigencias: r.total,
    atendidas: r.atendidas,
    pendentes: r.pendentes,
    leituraCompleta,
    docsFingerprint: fingerprintDocumentos(docsEmpresa),
    concluidaEm: new Date(),
    progresso: null,
    ...(opts.docsLidos ? { documentosLidos: JSON.stringify(opts.docsLidos) } : {}),
    ...(opts.uso ? { ...opts.uso, custoUsd: custoEstimadoUsd(opts.uso) } : {}),
  };

  await prisma.$transaction([
    prisma.exigenciaHabilitacao.deleteMany({ where: { editalId } }),
    prisma.exigenciaHabilitacao.createMany({
      data: linhas.map((l) => ({
        editalId,
        ...l,
        alertadoEm: alertadas.get(`${l.documento}|${l.documentoEmpresaId}`) ?? null,
      })),
    }),
    prisma.auditoriaHabilitacao.update({ where: { editalId }, data: dadosAuditoria }),
    prisma.edital.update({
      where: { id: editalId },
      data: { habilitacaoStatus: r.status, habilitacaoPercentual: r.percentual, habilitacaoAuditadaEm: new Date() },
    }),
  ]);

  return r;
}

/** Avisa (e-mail/WhatsApp, uma vez por exigência) os documentos que vencem até 7 dias antes da sessão. */
async function avisarVencimentosProximos(editalId: string, dataReferencia: Date) {
  try {
    const linhas = await prisma.exigenciaHabilitacao.findMany({
      where: { editalId, venceAntesDaSessao: true, alertadoEm: null },
    });
    if (linhas.length === 0) return;
    const edital = await prisma.edital.findUnique({
      where: { id: editalId },
      select: { titulo: true, company: { select: { razaoSocial: true, whatsapp: true, user: { select: { email: true } } } } },
    });
    if (!edital) return;

    const sessaoBr = dataReferencia.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const hoje = Date.now();
    await notificarPrazosVencendo(
      { email: edital.company.user.email, whatsapp: edital.company.whatsapp, razaoSocial: edital.company.razaoSocial },
      linhas.map((l) => ({
        documentoNome: l.documento,
        editalTitulo: `${edital.titulo.slice(0, 80)} — sessão em ${sessaoBr}`,
        diasRestantes: l.validade ? Math.ceil((l.validade.getTime() - hoje) / 86_400_000) : 0,
      }))
    );
    await prisma.exigenciaHabilitacao.updateMany({ where: { id: { in: linhas.map((l) => l.id) } }, data: { alertadoEm: new Date() } });
  } catch (err) {
    console.error(`Falha ao avisar vencimentos próximos do edital ${editalId}:`, err);
  }
}

// ── Orquestração ────────────────────────────────────────────────────────────

export type ResultadoExecucao = "concluida" | "continua" | "erro";

export async function executarAuditoriaHabilitacao(
  editalId: string,
  opts: { continuacao?: number; modo?: "completo" | "reconferir"; origem?: string } = {}
): Promise<ResultadoExecucao> {
  const continuacao = opts.continuacao ?? 0;
  const prazo = Date.now() + ORCAMENTO_MS;
  const restante = () => prazo - Date.now();

  try {
    const edital = await prisma.edital.findUniqueOrThrow({
      where: { id: editalId },
      select: { id: true, companyId: true, titulo: true, dataAberturaProposta: true, dataEncerramentoProposta: true },
    });
    const dataReferencia = dataReferenciaDoEdital(edital);

    if (continuacao === 0) {
      await prisma.auditoriaHabilitacao.upsert({
        where: { editalId },
        create: { editalId, estado: "RODANDO", tentativas: 1 },
        update: {
          estado: "RODANDO",
          mensagem: null,
          tentativas: { increment: 1 },
          // Numa reconferência o consumo da auditoria completa continua somado; numa nova
          // auditoria completa recomeça do zero.
          ...(opts.modo === "reconferir"
            ? {}
            : { haikuEntrada: 0, haikuSaida: 0, sonnetEntrada: 0, sonnetSaida: 0, iniciadaEm: new Date(), progresso: null }),
        },
      });
      // "Auditando…" só enquanto o edital ainda não tem resultado; numa reconferência o
      // resultado anterior continua visível até o novo ficar pronto.
      if (opts.modo !== "reconferir") {
        await prisma.edital.update({ where: { id: editalId }, data: { habilitacaoStatus: "AUDITANDO" } });
      }
    }

    const atual = await prisma.auditoriaHabilitacao.findUniqueOrThrow({ where: { editalId } });
    const uso = {
      haiku: { entrada: atual.haikuEntrada, saida: atual.haikuSaida } as UsoTokens,
      sonnet: { entrada: atual.sonnetEntrada, saida: atual.sonnetSaida } as UsoTokens,
    };
    const usoTotal = () => ({
      haikuEntrada: uso.haiku.entrada,
      haikuSaida: uso.haiku.saida,
      sonnetEntrada: uso.sonnet.entrada,
      sonnetSaida: uso.sonnet.saida,
    });

    // ── Só refazer a conferência (documentação da empresa mudou) — sem reler o edital ──
    if (opts.modo === "reconferir") {
      const linhas = await prisma.exigenciaHabilitacao.findMany({ where: { editalId }, orderBy: { ordem: "asc" } });
      if (linhas.length === 0) {
        // Nada para reconferir ainda: faz a auditoria completa.
        return executarAuditoriaHabilitacao(editalId, { ...opts, modo: "completo", continuacao: 0 });
      }
      const docs = await carregarDocsDaEmpresa(edital.companyId);
      const empresa = await carregarFatosDaEmpresa(edital.companyId);
      // O que já foi decidido como "não se aplica a esta empresa" continua assim (não pergunta de novo).
      const jaNaoSeAplica: Final[] = linhas
        .filter((l) => l.situacao === "NAO_SE_APLICA")
        .map((l) => ({
          categoria: l.categoria,
          documento: l.documento,
          chave: l.catalogoChave,
          origem: l.origem,
          localizacao: l.localizacao,
          condicao: l.condicao,
          aplicavelSe: l.aplicavelSe,
          aplica: false,
          docEmpresaId: null,
          certeza: true,
          acaoSugerida: null,
        }));
      const brutas: Bruta[] = linhas.filter((l) => l.situacao !== "NAO_SE_APLICA").map((l) => ({
        categoria: l.categoria,
        documento: l.documento,
        chave: l.catalogoChave,
        origem: l.origem,
        localizacao: l.localizacao,
        condicao: l.condicao,
        aplicavelSe: l.aplicavelSe,
      }));
      const finais = [...(await conferirComIA(brutas, docs, uso.sonnet, empresa)), ...jaNaoSeAplica];
      const avaliadas = avaliarTodas(finais, docs, dataReferencia);
      const anterior = await prisma.auditoriaHabilitacao.findUniqueOrThrow({ where: { editalId } });
      const r = await gravarResultado({
        editalId,
        linhas: avaliadas,
        dataReferencia,
        leituraCompleta: anterior.leituraCompleta,
        docsEmpresa: docs,
        uso: usoTotal(),
      });
      await avisarVencimentosProximos(editalId, dataReferencia);
      await logAudit(editalId, NOME_AGENTE, "Conferência atualizada", r.status === "NAO_HABILITADA" ? "ALERTA" : "OK", `Documentação da empresa reconferida: ${r.atendidas} de ${r.total} exigências atendidas (${r.percentual}%).`);
      return "concluida";
    }

    // ── Leitura completa do processo ──
    await baixarDocumentosPendentes([editalId]);
    const todos = await prisma.document.findMany({
      where: { editalId, tipo: { in: ["DOCUMENTO_PNCP", "DOCUMENTO_LICITANET", "DOCUMENTO_USUARIO"] } },
      orderBy: { createdAt: "asc" },
    });
    const { lidos } = selecionarDocumentos(todos);

    const textos = await mapComLimite(lidos, 3, async (d: DocumentRow) => ({ doc: d, texto: await obterTextoBrutoDocumento(d).catch(() => null) }));
    const docsLidos = textos.map(({ doc, texto }) => ({
      nome: doc.nome,
      caracteres: texto?.length ?? 0,
      ok: !!texto && !texto.includes(MARCA_ILEGIVEL),
    }));
    const comTexto = textos.filter((t): t is { doc: DocumentRow; texto: string } => !!t.texto);

    if (comTexto.length === 0) {
      throw new Error(
        todos.length === 0
          ? "Este edital não tem nenhum documento para ler."
          : "Não foi possível ler nenhum documento deste edital (arquivos não baixaram, estão corrompidos ou são imagens grandes demais)."
      );
    }
    const leituraCompleta = docsLidos.every((d) => d.ok);

    const pedacos: Pedaco[] = comTexto.flatMap(({ doc, texto }) => {
      const partes = dividirEmPedacos(texto);
      return partes.map((p, i) => ({ docNome: doc.nome, indice: i, total: partes.length, texto: p }));
    });

    const progresso: Progresso = atual.progresso
      ? (JSON.parse(atual.progresso) as Progresso)
      : { chunksTotal: pedacos.length, feitos: [], brutas: [] };
    progresso.chunksTotal = pedacos.length;

    const salvarProgresso = () =>
      prisma.auditoriaHabilitacao.update({
        where: { editalId },
        data: {
          progresso: JSON.stringify(progresso),
          documentosLidos: JSON.stringify(docsLidos),
          leituraCompleta,
          haikuEntrada: uso.haiku.entrada,
          haikuSaida: uso.haiku.saida,
        },
      });

    // Pedaços ainda não lidos, em levas de 4 em paralelo enquanto houver tempo.
    let faltam = pedacos.map((_, i) => i).filter((i) => !progresso.feitos.includes(i));
    while (faltam.length > 0 && restante() > FOLGA_EXTRACAO_MS) {
      const leva = faltam.slice(0, PEDACOS_EM_PARALELO);
      const resultados = await Promise.all(leva.map((i) => extrairDoPedaco(pedacos[i], uso.haiku)));
      leva.forEach((i, k) => {
        progresso.feitos.push(i);
        progresso.brutas.push(...resultados[k]);
      });
      await salvarProgresso();
      faltam = faltam.filter((i) => !leva.includes(i));
    }

    const faltaConferir = faltam.length === 0 && restante() <= FOLGA_CONFERENCIA_MS;
    if (faltam.length > 0 || faltaConferir) {
      if (continuacao >= MAX_CONTINUACOES) {
        throw new Error("O edital é grande demais para ser lido em uma auditoria. Tente novamente mais tarde.");
      }
      await salvarProgresso();
      const ok = await dispararAuditoriaHabilitacao(editalId, { continuacao: continuacao + 1, origem: opts.origem });
      if (!ok) throw new Error("Não foi possível continuar a leitura do edital.");
      return "continua";
    }

    // ── Conferência final ──
    const docs = await carregarDocsDaEmpresa(edital.companyId);
    const brutas = removerDuplicadas(progresso.brutas);
    if (brutas.length === 0) {
      throw new Error(
        "Nenhuma exigência de documento de habilitação foi encontrada nos documentos lidos. Se o edital as exige, confira se o arquivo do edital está completo."
      );
    }
    const empresa = await carregarFatosDaEmpresa(edital.companyId);
    const finais = await conferirComIA(brutas, docs, uso.sonnet, empresa);
    if (finais.length === 0) throw new Error("A conferência final não devolveu resultado. Tentaremos de novo.");
    const avaliadas = avaliarTodas(finais, docs, dataReferencia);

    const r = await gravarResultado({
      editalId,
      linhas: avaliadas,
      dataReferencia,
      leituraCompleta,
      docsLidos,
      docsEmpresa: docs,
      uso: usoTotal(),
    });
    await avisarVencimentosProximos(editalId, dataReferencia);

    const aviso = leituraCompleta ? "" : " Atenção: algum documento do processo não pôde ser lido por inteiro — o resultado nunca fica como \"Habilitada\" sem ressalva.";
    await logAudit(
      editalId,
      NOME_AGENTE,
      "Auditoria de habilitação",
      r.status === "HABILITADA" ? "OK" : "ALERTA",
      `${r.atendidas} de ${r.total} exigências de habilitação atendidas (${r.percentual}%) — ${
        r.status === "HABILITADA" ? "Habilitada" : r.status === "HABILITADA_RESSALVAS" ? "Habilitada com ressalvas" : "Não habilitada"
      }.${aviso}`
    );
    return "concluida";
  } catch (err) {
    const mensagem = descreverErro(err);
    console.error(`Auditoria de habilitação do edital ${editalId} falhou:`, err);
    await prisma.auditoriaHabilitacao
      .upsert({
        where: { editalId },
        create: { editalId, estado: "ERRO", mensagem },
        update: { estado: "ERRO", mensagem },
      })
      .catch(() => null);
    // Numa reconferência o resultado anterior continua valendo; só a primeira auditoria vira "erro".
    if (opts.modo !== "reconferir") {
      await prisma.edital.update({ where: { id: editalId }, data: { habilitacaoStatus: "ERRO" } }).catch(() => null);
    }
    await logAudit(editalId, NOME_AGENTE, "Auditoria de habilitação", "ERRO", `Não foi possível concluir a auditoria: ${mensagem}. Vamos tentar de novo automaticamente.`).catch(() => null);
    return "erro";
  }
}

// ── Gatilhos ────────────────────────────────────────────────────────────────

/**
 * Safety net: editais captados depois do lançamento que ainda estão "Aguardando auditoria"
 * (o disparo falhou) ou com erro, ou cuja auditoria travou no meio — dispara de novo. Poucas
 * por vez. Nunca mexe em editais anteriores ao lançamento.
 */
export async function varrerAuditoriasPendentes(opts: { companyId?: string; limite?: number; origem?: string } = {}) {
  const agora = Date.now();
  const candidatos = await prisma.edital.findMany({
    where: {
      ...(opts.companyId ? { companyId: opts.companyId } : {}),
      createdAt: { gte: AUDITORIA_HABILITACAO_DESDE },
      etapaKanban: { not: "RASCUNHO" },
      // Sem documento nenhum (ex.: Compras.gov.br) não há o que ler.
      documents: { some: { tipo: { in: ["DOCUMENTO_PNCP", "DOCUMENTO_LICITANET", "DOCUMENTO_USUARIO"] } } },
      OR: [
        { habilitacaoStatus: "AGUARDANDO", createdAt: { lt: new Date(agora - 3 * 60_000) } },
        { habilitacaoStatus: "ERRO", auditoriaHabilitacao: { is: { tentativas: { lt: 4 }, updatedAt: { lt: new Date(agora - 10 * 60_000) } } } },
        { habilitacaoStatus: "AUDITANDO", auditoriaHabilitacao: { is: { updatedAt: { lt: new Date(agora - 4 * 60_000) } } } },
      ],
    },
    select: { id: true },
    take: opts.limite ?? 5,
    orderBy: { createdAt: "desc" },
  });
  await mapComLimite(candidatos, 3, (e) => dispararAuditoriaHabilitacao(e.id, { origem: opts.origem }));
  return candidatos.length;
}

/**
 * A documentação da empresa mudou (enviou, substituiu, alterou validade ou removeu): refaz a
 * conferência dos editais abertos já auditados. A parte de decidir validade é só conta (grátis);
 * quando há exigência fora do catálogo ainda pendente, pede também uma reconferência com a IA.
 */
export async function reavaliarEditaisDaEmpresa(companyId: string, origem?: string) {
  const editais = await prisma.edital.findMany({
    where: {
      companyId,
      etapaKanban: { not: "RASCUNHO" },
      habilitacaoStatus: { in: ["HABILITADA", "HABILITADA_RESSALVAS", "NAO_HABILITADA"] },
      OR: [{ dataEncerramentoProposta: null }, { dataEncerramentoProposta: { gt: new Date() } }],
    },
    select: { id: true, titulo: true, dataAberturaProposta: true, dataEncerramentoProposta: true },
    take: 60,
  });
  if (editais.length === 0) return;

  const docs = await carregarDocsDaEmpresa(companyId);
  const fingerprint = fingerprintDocumentos(docs);
  let reconferirComIA = 0;

  for (const edital of editais) {
    try {
      const aud = await prisma.auditoriaHabilitacao.findUnique({ where: { editalId: edital.id } });
      if (!aud || aud.estado === "RODANDO" || aud.docsFingerprint === fingerprint) continue;

      const linhas = await prisma.exigenciaHabilitacao.findMany({ where: { editalId: edital.id }, orderBy: { ordem: "asc" } });
      if (linhas.length === 0) continue;
      const dataReferencia = dataReferenciaDoEdital(edital);

      const avaliadas = avaliarTodas(
        linhas.map((l) => ({
          categoria: l.categoria,
          documento: l.documento,
          chave: l.catalogoChave,
          origem: l.origem,
          localizacao: l.localizacao,
          condicao: l.condicao,
          aplicavelSe: l.aplicavelSe,
          // Decisão anterior sobre a exigência valer ou não para a empresa continua (não dá para saber = null).
          aplica: l.situacao === "NAO_SE_APLICA" ? false : l.aplicavelSe ? (l.certezaMapeamento ? true : null) : true,
          // Mapeamento já decidido antes (documento personalizado) continua valendo se o documento ainda existe.
          docEmpresaId: l.catalogoChave ? null : l.documentoEmpresaId,
          certeza: l.catalogoChave ? true : l.certezaMapeamento,
          acaoSugerida: l.acaoSugerida,
        })),
        docs,
        dataReferencia
      );
      await gravarResultado({
        editalId: edital.id,
        linhas: avaliadas,
        dataReferencia,
        leituraCompleta: aud.leituraCompleta,
        docsEmpresa: docs,
      });
      await avisarVencimentosProximos(edital.id, dataReferencia);

      // Exigência fora do catálogo ainda sem documento: um documento personalizado novo pode atendê-la.
      const temForaDoCatalogoPendente = avaliadas.some((a) => !a.catalogoChave && a.situacao !== "ATENDIDA");
      if (temForaDoCatalogoPendente && reconferirComIA < 5) {
        reconferirComIA++;
        await dispararAuditoriaHabilitacao(edital.id, { modo: "reconferir", origem });
      }
    } catch (err) {
      console.error(`Falha ao reavaliar a habilitação do edital ${edital.id}:`, err);
    }
  }
}
