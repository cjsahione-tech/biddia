import { prisma } from "@/lib/prisma";
import { CATEGORIAS_CATALOGO, chaveEfetivaDoDocumento, itemPorChave, normalizarNomeTipo } from "@/lib/catalogo-documentos";
import { escolherMelhorDocumento } from "@/lib/documentos-empresa";
import { calcularResultado, dataReferenciaDoEdital, type SituacaoExigencia } from "@/lib/habilitacao";
import { classificarErro, ErroTipado, tipoDeMensagemAntiga, type TipoErroIA } from "@/lib/ia-erros";

// Dados do relatório de pendências de habilitação — a mesma estrutura alimenta a aba
// "Habilitação" da tela do edital e o PDF. Tudo vem da última auditoria gravada; nada é
// recalculado nem consulta a IA aqui.

export type ItemRelatorio = {
  id: string;
  documento: string;
  categoria: string;
  /** Item do catálogo de documentos (null = exigência fora do catálogo → documento personalizado). */
  catalogoChave: string | null;
  /** Este tipo de documento costuma ter validade (certidões, licenças) — marca a caixinha por padrão. */
  venceTipicamente: boolean;
  /** Documento que a empresa já enviou para esta exigência (base de documentos), se houver. */
  documentoEnviado: { nome: string; enviadoEm: string; validade: string | null } | null;
  situacao: SituacaoExigencia;
  /** Texto pronto: "Não enviado", "Vencido em 15/10/2026", "Verificar manualmente"... */
  situacaoTexto: string;
  origem: string;
  localizacao: string | null;
  condicao: string | null;
  aplicavelSe: string | null;
  observacao: string | null;
  acaoSugerida: string | null;
  validade: string | null;
  venceAntesDaSessao: boolean;
};

export type ArquivoComProblema = { nome: string; problema: string; oQueFazer: string };

export type GrupoRelatorio = { categoria: string; titulo: string; itens: ItemRelatorio[] };

export type RelatorioHabilitacao = {
  edital: { id: string; titulo: string; orgaoNome: string; municipio: string | null; uf: string | null; modalidade: string | null };
  empresa: { razaoSocial: string; cnpj: string };
  status: string;
  percentual: number | null;
  auditoria: null | {
    estado: "RODANDO" | "CONCLUIDA" | "ERRO" | "NA_FILA" | "AGUARDANDO_SALDO" | "INTERROMPIDA";
    /** Sempre o texto amigável do tipo do erro — nunca a mensagem crua da API. */
    mensagem: string | null;
    erroTipo: TipoErroIA | null;
    /** Quando a auditoria foi pedida pelo fluxo atual (nulo = registro antigo, de antes da regra "só em Qualificação"). */
    solicitadaEm: string | null;
    /** O que o administrador precisa fazer (ex.: recarregar saldo). Só vem preenchido para admin. */
    avisoAdmin: string | null;
    concluidaEm: string | null;
    dataReferencia: string | null;
    leituraCompleta: boolean;
    documentosLidos: { nome: string; caracteres: number; ok: boolean; motivo?: string }[];
    /** Arquivos que não puderam ser lidos: qual, por quê e o que fazer (linguagem simples). */
    arquivosComProblema: ArquivoComProblema[];
    /** Texto do andamento enquanto roda (ex.: "Lendo o edital: 3 de 7 partes"). */
    andamento: string | null;
    /** Há uma nova tentativa automática agendada (o usuário não precisa fazer nada). */
    retentativaAgendada: boolean;
  };
  resumo: { exigidas: number; atendidas: number; pendentes: number; naoSeAplicam: number };
  /** Só o que falta resolver (não enviado, vencido, verificar), por categoria. */
  pendencias: GrupoRelatorio[];
  atendidas: ItemRelatorio[];
  naoSeAplicam: ItemRelatorio[];
};

const TITULO_CATEGORIA = new Map<string, string>([...CATEGORIAS_CATALOGO.map((c) => [c.id, c.titulo] as [string, string]), ["outros", "Outros documentos"]]);
const ORDEM_CATEGORIA = [...CATEGORIAS_CATALOGO.map((c) => c.id as string), "outros"];

/** Explica, em linguagem simples, por que um arquivo não foi lido e o que o analista pode fazer. */
export function explicarArquivo(nome: string, motivo?: string): ArquivoComProblema {
  switch (motivo) {
    case "download":
      return {
        nome,
        problema: "Não consegui baixar este arquivo do portal de origem (o site não respondeu).",
        oQueFazer: "Vou tentar de novo automaticamente. Se persistir, baixe o arquivo no portal e envie em “Adicionar PDF”.",
      };
    case "removido":
      return {
        nome,
        problema: "O órgão apagou esta contratação do PNCP (geralmente para republicá-la com outro número), então o arquivo não existe mais.",
        oQueFazer: "Procure no seu quadro a versão republicada (o histórico do card diz se ela já foi captada) ou envie o edital em PDF em “Adicionar PDF”.",
      };
    case "demorou":
      return {
        nome,
        problema: "Este arquivo demorou demais para baixar ou ler.",
        oQueFazer: "Vou tentar de novo. Se persistir, envie o arquivo manualmente em “Adicionar PDF”.",
      };
    case "ocr":
      return {
        nome,
        problema: "Este arquivo é um documento escaneado e está sendo lido por imagem (leva alguns minutos).",
        oQueFazer: "Não precisa fazer nada: a leitura continua sozinha de onde parou.",
      };
    case "armazenamento":
      return {
        nome,
        problema: "O armazenamento de arquivos está temporariamente indisponível, então não consegui abrir este arquivo agora.",
        oQueFazer: "Não precisa fazer nada: a auditoria foi guardada e continua sozinha quando o armazenamento voltar.",
      };
    case "formato":
      return {
        nome,
        problema: "Não consegui ler o conteúdo deste arquivo (pode ser uma imagem escaneada, estar protegido ou corrompido).",
        oQueFazer: "Abra o arquivo e confira. Se for imagem, envie uma versão em PDF com texto em “Adicionar PDF”.",
      };
    default:
      return {
        nome,
        problema: "Parte deste arquivo é imagem de baixa qualidade e não pôde ser lida.",
        oQueFazer: "Confira essas páginas manualmente: pode haver exigências que não apareceram aqui.",
      };
  }
}

function textoAndamento(progressoJson: string | null): string | null {
  if (!progressoJson) return null;
  try {
    const p = JSON.parse(progressoJson) as { chunksTotal?: number; feitos?: unknown[]; lotes?: Record<string, unknown> };
    const total = p.chunksTotal ?? 0;
    const feitos = p.feitos?.length ?? 0;
    if (total > 0 && feitos >= total) {
      return Object.keys(p.lotes ?? {}).length > 0 ? "Conferindo as exigências com a documentação da empresa…" : "Leitura concluída; conferindo com a documentação da empresa…";
    }
    if (total > 0) return `Lendo o edital: ${feitos} de ${total} partes`;
  } catch {
    // progresso ilegível: sem texto de andamento
  }
  return null;
}

export function textoSituacao(situacao: SituacaoExigencia, validade: Date | null): string {
  switch (situacao) {
    case "ATENDIDA":
      return "Atendida";
    case "NAO_ENVIADA":
      return "Não enviado";
    case "VENCIDA":
      return validade ? `Vencido em ${validade.toLocaleDateString("pt-BR", { timeZone: "UTC" })}` : "Vencido";
    case "VERIFICAR":
      return "Verificar manualmente";
    case "NAO_SE_APLICA":
      return "Não se aplica";
  }
}

export async function montarRelatorioHabilitacao(
  editalId: string,
  companyId: string,
  opts: { admin?: boolean } = {}
): Promise<RelatorioHabilitacao | null> {
  const edital = await prisma.edital.findFirst({
    where: { id: editalId, companyId },
    select: {
      id: true,
      titulo: true,
      orgaoNome: true,
      municipio: true,
      uf: true,
      modalidade: true,
      dataAberturaProposta: true,
      dataEncerramentoProposta: true,
      habilitacaoStatus: true,
      habilitacaoPercentual: true,
      company: { select: { razaoSocial: true, cnpj: true } },
      auditoriaHabilitacao: true,
      exigenciasHabilitacao: { orderBy: { ordem: "asc" } },
    },
  });
  if (!edital) return null;

  // Documentos que a empresa já enviou: cada exigência mostra "Enviado" quando há um para ela.
  const docsEmpresa = await prisma.companyDocument.findMany({
    where: { companyId },
    select: { id: true, tipo: true, catalogoChave: true, nome: true, validade: true, createdAt: true },
  });
  const docEnviadoPara = (e: { documentoEmpresaId: string | null; catalogoChave: string | null; documento: string }) => {
    const doc =
      (e.documentoEmpresaId ? docsEmpresa.find((d) => d.id === e.documentoEmpresaId) : undefined) ??
      (e.catalogoChave ? escolherMelhorDocumento(docsEmpresa.filter((d) => chaveEfetivaDoDocumento(d) === e.catalogoChave)) ?? undefined : undefined) ??
      // Fora do catálogo: documento personalizado enviado com o nome da exigência.
      (!e.catalogoChave ? docsEmpresa.find((d) => !chaveEfetivaDoDocumento(d) && normalizarNomeTipo(d.tipo) === normalizarNomeTipo(e.documento)) : undefined);
    return doc ? { nome: doc.nome, enviadoEm: doc.createdAt.toISOString(), validade: doc.validade?.toISOString() ?? null } : null;
  };

  const itens: ItemRelatorio[] = edital.exigenciasHabilitacao.map((e) => ({
    documentoEnviado: docEnviadoPara(e),
    id: e.id,
    documento: e.documento,
    categoria: e.categoria,
    catalogoChave: e.catalogoChave,
    venceTipicamente: itemPorChave(e.catalogoChave)?.vence ?? false,
    situacao: e.situacao,
    situacaoTexto: textoSituacao(e.situacao, e.validade),
    origem: e.origem,
    localizacao: e.localizacao,
    condicao: e.condicao,
    aplicavelSe: e.aplicavelSe,
    observacao: e.observacao,
    acaoSugerida: e.acaoSugerida,
    validade: e.validade?.toISOString() ?? null,
    venceAntesDaSessao: e.venceAntesDaSessao,
  }));

  const pendentes = itens.filter((i) => ["NAO_ENVIADA", "VENCIDA", "VERIFICAR"].includes(i.situacao));
  // Documentos faltando primeiro, depois vencidos, depois "verificar" — dentro de cada categoria.
  const pesoSituacao: Record<string, number> = { NAO_ENVIADA: 0, VENCIDA: 1, VERIFICAR: 2 };
  const pendencias: GrupoRelatorio[] = ORDEM_CATEGORIA.map((categoria) => ({
    categoria,
    titulo: TITULO_CATEGORIA.get(categoria) ?? categoria,
    itens: pendentes.filter((i) => (TITULO_CATEGORIA.has(i.categoria) ? i.categoria : "outros") === categoria).sort((a, b) => pesoSituacao[a.situacao] - pesoSituacao[b.situacao]),
  })).filter((g) => g.itens.length > 0);

  const r = calcularResultado({ situacoes: itens.map((i) => i.situacao), leituraCompleta: edital.auditoriaHabilitacao?.leituraCompleta ?? true });
  const aud = edital.auditoriaHabilitacao;
  let docsLidos: { nome: string; caracteres: number; ok: boolean; motivo?: string }[] = [];
  try {
    docsLidos = aud?.documentosLidos ? JSON.parse(aud.documentosLidos) : [];
  } catch {
    docsLidos = [];
  }

  // Linhas antigas (antes da classificação) só têm o texto cru em `mensagem`: reconhece o tipo
  // por ele e mostra sempre o texto amigável.
  const erroTipo: TipoErroIA | null = aud?.erroTipo
    ? (aud.erroTipo as TipoErroIA)
    : aud?.mensagem && aud.estado !== "CONCLUIDA"
      ? tipoDeMensagemAntiga(aud.mensagem)
      : null;
  const classificado = erroTipo ? classificarErro(new ErroTipado(erroTipo, "")) : null;

  return {
    edital: { id: edital.id, titulo: edital.titulo, orgaoNome: edital.orgaoNome, municipio: edital.municipio, uf: edital.uf, modalidade: edital.modalidade },
    empresa: edital.company,
    status: edital.habilitacaoStatus,
    percentual: edital.habilitacaoPercentual,
    auditoria: aud
      ? {
          estado: aud.estado,
          // Registros novos já guardam o texto amigável certo (nova tentativa agendada x erro final);
          // os antigos (sem tipo gravado) são traduzidos pelo tipo reconhecido no texto cru.
          mensagem: aud.estado === "CONCLUIDA" ? null : aud.erroTipo && aud.mensagem ? aud.mensagem : (classificado?.mensagemUsuario ?? null),
          erroTipo: aud.estado === "CONCLUIDA" ? null : erroTipo,
          solicitadaEm: aud.solicitadaEm?.toISOString() ?? null,
          avisoAdmin: opts.admin && aud.estado !== "CONCLUIDA" ? (classificado?.mensagemAdmin ?? null) : null,
          concluidaEm: aud.concluidaEm?.toISOString() ?? null,
          dataReferencia: (aud.dataReferencia ?? dataReferenciaDoEdital(edital)).toISOString(),
          leituraCompleta: aud.leituraCompleta,
          documentosLidos: docsLidos,
          arquivosComProblema: docsLidos.filter((d) => !d.ok).map((d) => explicarArquivo(d.nome, d.motivo)),
          andamento: ["RODANDO", "NA_FILA"].includes(aud.estado) ? textoAndamento(aud.progresso) : null,
          retentativaAgendada: aud.estado === "ERRO" && !!aud.proximaTentativaEm,
        }
      : null,
    resumo: { exigidas: r.total, atendidas: r.atendidas, pendentes: r.pendentes, naoSeAplicam: itens.filter((i) => i.situacao === "NAO_SE_APLICA").length },
    pendencias,
    atendidas: itens.filter((i) => i.situacao === "ATENDIDA"),
    naoSeAplicam: itens.filter((i) => i.situacao === "NAO_SE_APLICA"),
  };
}

export const AVISO_IA = "Gerado por IA. Confirme com o analista responsável antes de enviar a proposta.";
