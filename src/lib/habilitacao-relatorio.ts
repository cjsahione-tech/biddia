import { prisma } from "@/lib/prisma";
import { CATEGORIAS_CATALOGO } from "@/lib/catalogo-documentos";
import { calcularResultado, dataReferenciaDoEdital, type SituacaoExigencia } from "@/lib/habilitacao";

// Dados do relatório de pendências de habilitação — a mesma estrutura alimenta a aba
// "Habilitação" da tela do edital e o PDF. Tudo vem da última auditoria gravada; nada é
// recalculado nem consulta a IA aqui.

export type ItemRelatorio = {
  id: string;
  documento: string;
  categoria: string;
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

export type GrupoRelatorio = { categoria: string; titulo: string; itens: ItemRelatorio[] };

export type RelatorioHabilitacao = {
  edital: { id: string; titulo: string; orgaoNome: string; municipio: string | null; uf: string | null; modalidade: string | null };
  empresa: { razaoSocial: string; cnpj: string };
  status: string;
  percentual: number | null;
  auditoria: null | {
    estado: "RODANDO" | "CONCLUIDA" | "ERRO";
    mensagem: string | null;
    concluidaEm: string | null;
    dataReferencia: string | null;
    leituraCompleta: boolean;
    documentosLidos: { nome: string; caracteres: number; ok: boolean }[];
  };
  resumo: { exigidas: number; atendidas: number; pendentes: number; naoSeAplicam: number };
  /** Só o que falta resolver (não enviado, vencido, verificar), por categoria. */
  pendencias: GrupoRelatorio[];
  atendidas: ItemRelatorio[];
  naoSeAplicam: ItemRelatorio[];
};

const TITULO_CATEGORIA = new Map<string, string>([...CATEGORIAS_CATALOGO.map((c) => [c.id, c.titulo] as [string, string]), ["outros", "Outros documentos"]]);
const ORDEM_CATEGORIA = [...CATEGORIAS_CATALOGO.map((c) => c.id as string), "outros"];

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

export async function montarRelatorioHabilitacao(editalId: string, companyId: string): Promise<RelatorioHabilitacao | null> {
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

  const itens: ItemRelatorio[] = edital.exigenciasHabilitacao.map((e) => ({
    id: e.id,
    documento: e.documento,
    categoria: e.categoria,
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
  let docsLidos: { nome: string; caracteres: number; ok: boolean }[] = [];
  try {
    docsLidos = aud?.documentosLidos ? JSON.parse(aud.documentosLidos) : [];
  } catch {
    docsLidos = [];
  }

  return {
    edital: { id: edital.id, titulo: edital.titulo, orgaoNome: edital.orgaoNome, municipio: edital.municipio, uf: edital.uf, modalidade: edital.modalidade },
    empresa: edital.company,
    status: edital.habilitacaoStatus,
    percentual: edital.habilitacaoPercentual,
    auditoria: aud
      ? {
          estado: aud.estado,
          mensagem: aud.mensagem,
          concluidaEm: aud.concluidaEm?.toISOString() ?? null,
          dataReferencia: (aud.dataReferencia ?? dataReferenciaDoEdital(edital)).toISOString(),
          leituraCompleta: aud.leituraCompleta,
          documentosLidos: docsLidos,
        }
      : null,
    resumo: { exigidas: r.total, atendidas: r.atendidas, pendentes: r.pendentes, naoSeAplicam: itens.filter((i) => i.situacao === "NAO_SE_APLICA").length },
    pendencias,
    atendidas: itens.filter((i) => i.situacao === "ATENDIDA"),
    naoSeAplicam: itens.filter((i) => i.situacao === "NAO_SE_APLICA"),
  };
}

export const AVISO_IA = "Gerado por IA. Confirme com o analista responsável antes de enviar a proposta.";
