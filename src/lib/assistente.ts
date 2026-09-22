import { prisma } from "@/lib/prisma";
import type { FerramentaDef, ExecutarFerramenta } from "@/lib/anthropic";
import { formatBRL, formatDate } from "@/lib/format";
import { parseItens } from "@/lib/proposal";
import { gerarPlanilhaProposta } from "@/lib/proposal-planilha";
import { gerarChecklistZip } from "@/lib/checklist-zip";
import { gerarPdfRelatorio } from "@/lib/agents/pdf";
import { montarRelatorioEstudo } from "@/lib/estudo-server";
import {
  buscarEditaisParaResultados,
  montarResultados,
  montarSecoesRelatorioResultados,
  tituloRelatorioResultados,
  situacaoDoEdital,
  FILTROS_PADRAO,
  type SituacaoFiltro,
} from "@/lib/resultados";
import { ETAPAS_KANBAN } from "@/lib/kanban";
import { LABEL_CATEGORIA, LABEL_OUTROS } from "@/lib/habilitacao-categorias";
import { RAMO_LABEL, etapaAtualDoEstudo, ETAPAS_ESTUDO } from "@/lib/estudo-viabilidade";
import type { EtapaKanban } from "@/lib/types";

export function systemPromptAssistente(companyName: string): string {
  return `Você é a Bidd.IA, assistente de IA da plataforma Bidd.IA — que ajuda empresas brasileiras a participar de
licitações públicas. Você está conversando com alguém da empresa "${companyName}".

Você tem ferramentas para CONSULTAR todos os dados da conta (editais, análises, propostas, checklist, dossiê de
documentos, estudos de viabilidade) e para GERAR arquivos já existentes na plataforma (planilha da proposta, PDF do
Dashboard de Resultados, PDF de relatório de um estudo de viabilidade, ZIP com os documentos de habilitação de um
edital). Use as ferramentas sempre que a pergunta depender de dados reais — nunca invente números, prazos ou
conteúdo de edital. Se não tiver certeza de qual edital o usuário quer dizer, pergunte ou liste as opções antes de
supor uma.

Suas ferramentas são só de LEITURA e GERAÇÃO DE ARQUIVO — você não pode mover um card, editar um campo, excluir nada
nem tomar nenhuma ação que mude os dados. Se o usuário pedir isso, explique que essa ação ainda precisa ser feita
pela tela normal da plataforma, e diga onde.

Quando gerar um arquivo, não descreva o conteúdo dele como se estivesse te devolvendo em texto — apenas confirme que
foi gerado e está pronto pra baixar (o arquivo aparece anexado na sua resposta).

Responda sempre em português, de forma direta e natural — como conversa entre colegas de trabalho, sem enrolação.`;
}

const ETAPA_KEYS = ETAPAS_KANBAN.map((e) => e.key);
const SITUACOES: SituacaoFiltro[] = ["TODOS", "ANDAMENTO", "GANHOS", "PERDIDOS"];

export const FERRAMENTAS_ASSISTENTE: FerramentaDef[] = [
  {
    name: "listar_editais",
    description:
      "Lista os editais da empresa com um resumo (título, órgão, etapa do Kanban, valor, prazo de encerramento). Aceita filtro opcional por etapa ou situação (ganhos/perdidos/em andamento).",
    input_schema: {
      type: "object",
      properties: {
        etapa: { type: "string", enum: ETAPA_KEYS, description: "Filtra por uma etapa exata do Kanban." },
        situacao: { type: "string", enum: SITUACOES, description: "Filtra por situação agregada (padrão TODOS)." },
      },
    },
  },
  {
    name: "detalhar_edital",
    description:
      "Traz o detalhe completo de UM edital: objeto, análise do Agente Analista, itens e valor da proposta financeira, e status do checklist de habilitação.",
    input_schema: {
      type: "object",
      properties: { editalId: { type: "string", description: "ID do edital (obtido via listar_editais)." } },
      required: ["editalId"],
    },
  },
  {
    name: "dados_empresa",
    description: "Traz os dados cadastrais da empresa (razão social, CNPJ, segmento de atuação, regime tributário padrão).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "listar_documentos_empresa",
    description: "Lista os documentos do dossiê da empresa (certidões, contrato social etc.), com validade de cada um.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "listar_estudos_viabilidade",
    description: "Lista os estudos de viabilidade (simulações de precificação) já criados, com o ramo e a etapa atual de cada um.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "gerar_planilha_proposta",
    description: "Gera e disponibiliza pra download a planilha (.xlsx) da proposta comercial de um edital.",
    input_schema: {
      type: "object",
      properties: { editalId: { type: "string", description: "ID do edital (obtido via listar_editais)." } },
      required: ["editalId"],
    },
  },
  {
    name: "gerar_pdf_resultados",
    description: "Gera e disponibiliza pra download o PDF do Dashboard de Resultados, com filtros opcionais de período/situação/portal/UF/tipo.",
    input_schema: {
      type: "object",
      properties: {
        de: { type: "string", description: "Data inicial, formato YYYY-MM-DD." },
        ate: { type: "string", description: "Data final, formato YYYY-MM-DD." },
        situacao: { type: "string", enum: SITUACOES },
        fonte: { type: "string", description: "Portal de origem (ex: PNCP)." },
        uf: { type: "string" },
        tipoObjeto: { type: "string", enum: ["SERVICO", "BEM", "AMBOS", "NAO_CLASSIFICADO"] },
      },
    },
  },
  {
    name: "gerar_pdf_estudo",
    description: "Gera e disponibiliza pra download o PDF do relatório final de um estudo de viabilidade.",
    input_schema: {
      type: "object",
      properties: { estudoId: { type: "string", description: "ID do estudo (obtido via listar_estudos_viabilidade)." } },
      required: ["estudoId"],
    },
  },
  {
    name: "gerar_zip_checklist",
    description: "Gera e disponibiliza pra download um .zip com todos os documentos já anexados ao checklist de habilitação de um edital, organizados por categoria.",
    input_schema: {
      type: "object",
      properties: { editalId: { type: "string", description: "ID do edital (obtido via listar_editais)." } },
      required: ["editalId"],
    },
  },
];

function bufferParaArquivo(buffer: Buffer, nome: string, contentType: string) {
  return { nome, contentType, base64: buffer.toString("base64") };
}

/** Monta o executor de ferramentas do assistente, já travado numa empresa — nenhuma
 * ferramenta aceita ou usa um companyId vindo do modelo, sempre o desta closure. */
export function criarExecutorAssistente(companyId: string): ExecutarFerramenta {
  return async (name, input) => {
    switch (name) {
      case "listar_editais": {
        const etapa = input.etapa as EtapaKanban | undefined;
        const situacao = (input.situacao as SituacaoFiltro | undefined) ?? FILTROS_PADRAO.situacao;
        const editais = await prisma.edital.findMany({
          where: { companyId },
          select: {
            id: true,
            titulo: true,
            orgaoNome: true,
            etapaKanban: true,
            valorGlobal: true,
            orcamentoSigiloso: true,
            dataEncerramentoProposta: true,
            proposal: { select: { valorGlobalReferencia: true } },
          },
        });
        const filtrados = editais.filter((e) => {
          if (etapa && e.etapaKanban !== etapa) return false;
          if (situacao !== "TODOS" && situacaoDoEdital(e) !== situacao) return false;
          return true;
        });
        if (filtrados.length === 0) return { resultadoTexto: "Nenhum edital encontrado com esse filtro." };
        const linhas = filtrados.map(
          (e) =>
            `- [${e.id}] ${e.titulo} — ${e.orgaoNome} — etapa: ${e.etapaKanban} — valor: ${
              e.orcamentoSigiloso ? "sigiloso" : formatBRL(e.valorGlobal ?? e.proposal?.valorGlobalReferencia ?? null)
            } — encerra: ${formatDate(e.dataEncerramentoProposta?.toISOString() ?? null)}`
        );
        return { resultadoTexto: `${filtrados.length} edital(is):\n${linhas.join("\n")}` };
      }

      case "detalhar_edital": {
        const editalId = String(input.editalId ?? "");
        const edital = await prisma.edital.findFirst({
          where: { id: editalId, companyId },
          include: { analysis: true, proposal: true, checklistItems: true },
        });
        if (!edital) return { resultadoTexto: "Edital não encontrado nesta conta." };

        const partes = [
          `Título: ${edital.titulo}`,
          `Órgão: ${edital.orgaoNome}`,
          `Etapa no Kanban: ${edital.etapaKanban}`,
          `Objeto: ${edital.descricao}`,
          `Valor de referência (PNCP): ${edital.orcamentoSigiloso ? "sigiloso" : formatBRL(edital.valorGlobal)}`,
          `Encerramento das propostas: ${formatDate(edital.dataEncerramentoProposta?.toISOString() ?? null)}`,
        ];

        if (edital.analysis) {
          partes.push(
            `\nAnálise do Agente Analista:`,
            `- Resumo: ${edital.analysis.resumoObjeto}`,
            `- Habilitação exigida: ${edital.analysis.habilitacao}`,
            `- Riscos: ${edital.analysis.riscos}`,
            `- Parecer: ${edital.analysis.parecer}`
          );
        } else {
          partes.push(`\nAinda não há análise do Agente Analista para este edital.`);
        }

        if (edital.proposal) {
          const itens = parseItens(edital.proposal.itensJson);
          const soma = itens.reduce((acc, i) => acc + i.valorTotal, 0);
          partes.push(
            `\nProposta financeira: ${itens.length} item(ns), soma ${formatBRL(soma)}, desconto aplicado ${edital.proposal.descontoPercentual}%.`
          );
        } else {
          partes.push(`\nAinda não há proposta financeira para este edital.`);
        }

        if (edital.checklistItems.length > 0) {
          const pendentes = edital.checklistItems.filter((c) => c.status === "FALTANTE").length;
          partes.push(`\nChecklist de habilitação: ${edital.checklistItems.length} item(ns), ${pendentes} pendente(s).`);
        }

        return { resultadoTexto: partes.join("\n") };
      }

      case "dados_empresa": {
        const company = await prisma.company.findUnique({ where: { id: companyId } });
        if (!company) return { resultadoTexto: "Empresa não encontrada." };
        return {
          resultadoTexto: [
            `Razão social: ${company.razaoSocial}`,
            `CNPJ: ${company.cnpj}`,
            `Segmento (LicitaNet): ${company.licitanetSegmentoNome ?? "não configurado"}`,
            `Atende serviço: ${company.atendeServico ? "sim" : "não"} / Atende bem/produto: ${company.atendeBem ? "sim" : "não"}`,
            `Regime tributário padrão: ${company.regimeTributarioPadrao ?? "não configurado"}`,
          ].join("\n"),
        };
      }

      case "listar_documentos_empresa": {
        const docs = await prisma.companyDocument.findMany({ where: { companyId }, orderBy: { nome: "asc" } });
        if (docs.length === 0) return { resultadoTexto: "Nenhum documento cadastrado no dossiê da empresa ainda." };
        const linhas = docs.map(
          (d) =>
            `- ${d.nome} (${d.categoria ? LABEL_CATEGORIA[d.categoria] : LABEL_OUTROS}) — validade: ${
              d.validade ? formatDate(d.validade.toISOString()) : "não vence"
            }`
        );
        return { resultadoTexto: `${docs.length} documento(s) no dossiê:\n${linhas.join("\n")}` };
      }

      case "listar_estudos_viabilidade": {
        const estudos = await prisma.estudoViabilidade.findMany({
          where: { companyId },
          include: { edital: { select: { titulo: true } } },
          orderBy: { createdAt: "desc" },
        });
        if (estudos.length === 0) return { resultadoTexto: "Nenhum estudo de viabilidade criado ainda." };
        const linhas = estudos.map((e) => {
          const etapaKey = etapaAtualDoEstudo({
            editalId: e.editalId,
            requisitosConfirmadoEm: e.requisitosConfirmadoEm?.toISOString() ?? null,
            tributosConfirmadoEm: e.tributosConfirmadoEm?.toISOString() ?? null,
            custosConfirmadoEm: e.custosConfirmadoEm?.toISOString() ?? null,
            calculoConfirmadoEm: e.calculoConfirmadoEm?.toISOString() ?? null,
          });
          const etapaLabel = ETAPAS_ESTUDO.find((et) => et.key === etapaKey)?.label ?? etapaKey;
          return `- [${e.id}] ${e.nome ?? RAMO_LABEL[e.ramo]} — ramo: ${RAMO_LABEL[e.ramo]}${
            e.edital ? ` — edital: ${e.edital.titulo}` : ""
          } — etapa atual: ${etapaLabel}`;
        });
        return { resultadoTexto: `${estudos.length} estudo(s):\n${linhas.join("\n")}` };
      }

      case "gerar_planilha_proposta": {
        const editalId = String(input.editalId ?? "");
        const edital = await prisma.edital.findFirst({ where: { id: editalId, companyId }, include: { proposal: true } });
        if (!edital) return { resultadoTexto: "Edital não encontrado nesta conta." };
        if (!edital.proposal) return { resultadoTexto: "Este edital ainda não tem uma proposta financeira montada." };
        const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
        const { buffer, nomeArquivo } = await gerarPlanilhaProposta(edital, edital.proposal, company);
        return {
          resultadoTexto: `Planilha da proposta gerada com sucesso (${parseItens(edital.proposal.itensJson).length} itens).`,
          arquivo: bufferParaArquivo(buffer, nomeArquivo, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        };
      }

      case "gerar_pdf_resultados": {
        const filtros = {
          de: (input.de as string) || null,
          ate: (input.ate as string) || null,
          situacao: (input.situacao as SituacaoFiltro) || FILTROS_PADRAO.situacao,
          fonte: (input.fonte as string) || null,
          uf: (input.uf as string) || null,
          tipoObjeto: (input.tipoObjeto as string) || null,
        };
        const editais = await buscarEditaisParaResultados(companyId);
        const r = montarResultados(editais, filtros);
        const secoes = montarSecoesRelatorioResultados(r, filtros);
        const { titulo, subtitulo } = tituloRelatorioResultados();
        const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
        const bytes = await gerarPdfRelatorio({ company, titulo, subtitulo, secoes });
        return {
          resultadoTexto: `PDF do Dashboard de Resultados gerado com sucesso (${r.totalFiltrado} edital(is) no filtro).`,
          arquivo: bufferParaArquivo(Buffer.from(bytes), `${titulo}.pdf`, "application/pdf"),
        };
      }

      case "gerar_pdf_estudo": {
        const estudoId = String(input.estudoId ?? "");
        const dados = await montarRelatorioEstudo(estudoId, companyId);
        if (!dados) return { resultadoTexto: "Estudo de viabilidade não encontrado nesta conta." };
        const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
        const titulo = dados.estudo.nome ?? RAMO_LABEL[dados.estudo.ramo];
        const bytes = await gerarPdfRelatorio({
          company,
          titulo: `Relatório — ${titulo}`,
          secoes: [
            {
              tipo: "campos",
              titulo: "Resumo",
              campos: [
                { label: "Ramo", valor: RAMO_LABEL[dados.estudo.ramo] },
                { label: "Edital vinculado", valor: dados.estudo.edital?.titulo ?? "nenhum" },
                { label: "Margem mínima aceitável", valor: dados.estudo.margemMinimaAceitavel != null ? `${dados.estudo.margemMinimaAceitavel}%` : "não definida" },
              ],
            },
          ],
        });
        return {
          resultadoTexto: `PDF do relatório do estudo "${titulo}" gerado com sucesso.`,
          arquivo: bufferParaArquivo(Buffer.from(bytes), `Relatorio - ${titulo}.pdf`.replace(/[^a-zA-Z0-9-_ ]/g, ""), "application/pdf"),
        };
      }

      case "gerar_zip_checklist": {
        const editalId = String(input.editalId ?? "");
        const resultado = await gerarChecklistZip(editalId, companyId);
        if ("erro" in resultado) return { resultadoTexto: resultado.erro };
        return {
          resultadoTexto: `ZIP com os documentos de habilitação gerado com sucesso.`,
          arquivo: bufferParaArquivo(resultado.buffer, resultado.nomeArquivo, "application/zip"),
        };
      }

      default:
        return { resultadoTexto: `Ferramenta desconhecida: ${name}` };
    }
  };
}
