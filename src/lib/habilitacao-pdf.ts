import type { Company } from "@prisma/client";
import { gerarPdfRelatorio, type SecaoRelatorio } from "@/lib/agents/pdf";
import { ROTULO_STATUS_HABILITACAO } from "@/lib/habilitacao";
import { AVISO_IA, type RelatorioHabilitacao } from "@/lib/habilitacao-relatorio";

const dataBr = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—");

/** PDF do relatório de pendências de habilitação — mesmo conteúdo da aba "Habilitação". */
export async function gerarPdfPendenciasHabilitacao(company: Company, r: RelatorioHabilitacao): Promise<Uint8Array> {
  const secoes: SecaoRelatorio[] = [];

  secoes.push({
    tipo: "campos",
    titulo: "Edital",
    campos: [
      { label: "Edital", valor: r.edital.titulo },
      { label: "Órgão", valor: `${r.edital.orgaoNome} — ${r.edital.municipio ?? "?"}/${r.edital.uf ?? "?"}` },
      { label: "Modalidade", valor: r.edital.modalidade ?? "Não informada" },
      { label: "Data da sessão", valor: dataBr(r.auditoria?.dataReferencia ?? null) },
      { label: "Data da auditoria", valor: dataBr(r.auditoria?.concluidaEm ?? null) },
    ],
  });

  secoes.push({
    tipo: "campos",
    titulo: "Resumo",
    campos: [
      { label: "Situação da empresa", valor: `${ROTULO_STATUS_HABILITACAO[r.status] ?? r.status}${r.percentual != null ? ` (${String(r.percentual).replace(".", ",")}%)` : ""}` },
      { label: "Documentos exigidos", valor: String(r.resumo.exigidas) },
      { label: "Atendidos", valor: String(r.resumo.atendidas) },
      { label: "Pendentes", valor: String(r.resumo.pendentes) },
      ...(r.resumo.naoSeAplicam > 0 ? [{ label: "Não se aplicam à empresa", valor: String(r.resumo.naoSeAplicam) }] : []),
    ],
  });

  if (r.auditoria && !r.auditoria.leituraCompleta) {
    const ilegiveis = r.auditoria.documentosLidos.filter((d) => !d.ok).map((d) => d.nome);
    secoes.push({
      tipo: "texto",
      titulo: "Atenção: leitura incompleta",
      texto: `Nem todos os documentos do processo puderam ser lidos por inteiro${ilegiveis.length ? ` (${ilegiveis.join("; ")})` : ""}. Confira manualmente se há exigências nesses arquivos. O resultado nunca fica como "Habilitada" sem ressalva nesses casos.`,
    });
  }

  if (r.resumo.pendentes === 0) {
    secoes.push({
      tipo: "texto",
      titulo: "Pendências",
      texto: "Sem pendências: todos os documentos exigidos pelo edital e pelo termo de referência estão enviados e válidos na data da sessão.",
    });
  } else {
    for (const grupo of r.pendencias) {
      secoes.push({
        tipo: "tabela",
        titulo: `Pendências — ${grupo.titulo}`,
        quebrarLinhas: true,
        colunas: [
          { label: "Documento exigido", largura: 165 },
          { label: "Onde aparece", largura: 95 },
          { label: "Situação", largura: 75 },
          { label: "Ação sugerida", largura: 148 },
        ],
        linhas: grupo.itens.map((i) => [
          i.condicao ? `${i.documento} (condição: ${i.condicao})` : i.documento,
          [i.localizacao, i.origem].filter(Boolean).join(" — "),
          i.situacaoTexto,
          i.acaoSugerida ?? "",
        ]),
      });
    }
  }

  if (r.atendidas.length > 0) {
    secoes.push({
      tipo: "tabela",
      titulo: "Documentos já atendidos",
      quebrarLinhas: true,
      colunas: [
        { label: "Documento exigido", largura: 290 },
        { label: "Onde aparece", largura: 120 },
        { label: "Validade", largura: 73 },
      ],
      linhas: r.atendidas.map((i) => [
        i.documento,
        i.localizacao ?? "—",
        i.validade ? new Date(i.validade).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : "Não vence",
      ]),
    });
  }

  if (r.naoSeAplicam.length > 0) {
    secoes.push({
      tipo: "tabela",
      titulo: "Exigências que não se aplicam a esta empresa",
      quebrarLinhas: true,
      colunas: [
        { label: "Documento", largura: 290 },
        { label: "Vale somente para", largura: 193 },
      ],
      linhas: r.naoSeAplicam.map((i) => [i.documento, i.aplicavelSe ?? "—"]),
    });
  }

  secoes.push({ tipo: "texto", titulo: "Aviso", texto: AVISO_IA });

  return gerarPdfRelatorio({
    company,
    titulo: "Relatório de pendências de habilitação",
    subtitulo: `${r.edital.titulo}`.slice(0, 110),
    secoes,
  });
}
