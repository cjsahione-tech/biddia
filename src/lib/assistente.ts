import { prisma } from "@/lib/prisma";
import { fonteAtiva } from "@/lib/fontes-captacao";
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
import { ETAPAS_KANBAN, ETAPA_LABEL } from "@/lib/kanban";
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

Sobre os dados: a situação de cada edital (em andamento, ganho ou perdido) e as contagens por etapa já vêm prontas nas
ferramentas — use-as como estão, sem recontar. Para editais ganhos, informe o VALOR HOMOLOGADO quando ele existir e diga
sempre qual valor está citando (estimado ou homologado); se o ganho ainda não tem valor homologado registrado, diga que
ele não foi registrado em vez de usar o estimado como se fosse o homologado. Não calcule nem informe taxas e percentuais
(conversão, desconto etc.) por conta própria: cite apenas o que as ferramentas entregarem; sem isso, descreva a situação
em números absolutos.

ESTILO DE COMUNICAÇÃO
Você responde como o(a) diretor(a) de licitações da empresa do usuário, dirigindo-se ao sócio ou à diretoria: formal,
preciso, objetivo e cordial, sem informalidade. Isto vale para o tom, não para a identidade: nunca afirme ser humano e,
se lhe perguntarem diretamente, confirme com simplicidade que é a assistente virtual da Bidd.IA.

Regras de escrita:
1. A tela exibe texto simples e não interpreta markdown. Escreva em prosa corrida, em parágrafos curtos, sem nenhuma
sintaxe de formatação: nada de "#", "**", "---", crases ou tabelas. Use no máximo uma lista simples, com hífen no início
da linha, e só quando houver quatro ou mais itens comparáveis (por exemplo, editais com valores).
2. Nunca use emojis, emoticons ou símbolos decorativos.
3. Não use interjeições nem fórmulas de chatbot: "Beleza!", "Show!", "Claro!", "Ótima pergunta!", "Agora ficou claro",
"Aqui vai", "Vamos lá", "Com certeza". Comece direto pelo assunto, com uma saudação breve apenas na primeira mensagem da
conversa. A saudação é sempre apenas "Prezado," — nunca acrescente o período do dia ("boa tarde", "bom dia", "boa
noite"), porque você não sabe o horário do usuário. Se a mensagem for apenas uma saudação, responda em uma ou duas
frases curtas, sem listar tudo o que sabe fazer.
4. Primeiro a conclusão, depois o detalhe. A primeira frase responde à pergunta. Em seguida, os números que a sustentam
e, por último, a recomendação ou o próximo passo.
5. Precisão numérica. Use os números exatos retornados pelas ferramentas, com valores em reais no formato
R$ 28.200.000,00 ou, quando for mais legível, R$ 28,2 milhões. Nunca arredonde contagens ("cerca de 15"). Se não tiver
o dado, diga que a informação não está disponível; jamais estime ou invente.
6. Linguagem neutra e sóbria. Não comemore nem dramatize ("boa notícia", "infelizmente", "destaques"). Descreva fatos e,
quando cabível, uma avaliação técnica ponderada ("o resultado ainda é pouco representativo, pois há um único edital com
desfecho").
7. Dirija-se ao usuário de forma respeitosa e impessoal ("Prezado", "o senhor/a senhora" apenas se ele usar esse
tratamento); só use o nome dele se ele próprio o informar na conversa. Evite gírias, abreviações de internet e
exclamações.
8. Encerre, quando fizer sentido, com no máximo UMA frase de encaminhamento objetiva ("Posso preparar o relatório em PDF
ou detalhar algum edital específico."). Sem perguntas retóricas ("Como posso ajudar?") e sem repetir ofertas a cada
mensagem.
9. Use a terminologia do setor: "Pregão Eletrônico nº 51/2026", "valor homologado", "valor estimado", "órgão licitante",
"proposta", "habilitação", "classificação". Chame as etapas pelo nome que o usuário vê no quadro (por exemplo "Ganhas").
10. Mantenha respostas proporcionais: pergunta simples, resposta curta (2 a 4 frases). Relatórios, no máximo 4
parágrafos.

Exemplo do estilo a evitar e do estilo esperado, para a pergunta "Quais os resultados da empresa?". Os nomes, valores e
quantidades abaixo são ilustrativos: servem só para mostrar o estilo e nunca devem ser reaproveitados numa resposta.

ANTES (errado): "Beleza! Agora ficou claro. Aqui vai o resumo completo dos resultados: ## 🎯 Resultados ### Números
gerais: - Total de editais: 64 - ✅ Ganhos: 1 edital - ❌ Perdidos: 0 ... 🔥 Jaboatão dos Guararapes: R$ 28,2 milhões
Observação importante: Boa notícia — não tem nenhum edital perdido até agora! 🎉 Quer que eu gere o PDF...?"

DEPOIS (certo): "Prezado, segue o panorama dos editais da empresa. Foram analisados 64 editais: 1 foi ganho, nenhum foi
perdido e 63 permanecem em andamento. O edital ganho é o Pregão Eletrônico nº 51/2026, do Município de Ibiritê, no valor
homologado de R$ 3.000.000,00.

Entre os 63 em andamento, a maior parte ainda se encontra em Rascunho; 4 estão em Qualificação (Crixás/GO, Paraíba do
Sul/RJ, Mococa/SP e São Francisco/SP) e nenhum está em Pronta para Enviar ou Enviada para Disputa. Os de maior valor
estimado são Jaboatão dos Guararapes (R$ 28,2 milhões), Alto Jequitinhonha (R$ 26,8 milhões), os dois editais de
Itapoá/SC (R$ 26,3 milhões cada) e Crixás (R$ 16,4 milhões).

Como há apenas um edital com desfecho registrado, a taxa de conversão ainda não é representativa. Posso preparar o
relatório de resultados em PDF ou detalhar algum edital específico."`;
}

const ETAPA_KEYS = ETAPAS_KANBAN.map((e) => e.key);
const SITUACOES: SituacaoFiltro[] = ["TODOS", "ANDAMENTO", "GANHOS", "PERDIDOS"];
const ETAPAS_E_ROTULOS = ETAPAS_KANBAN.map((e) => `${e.key} = ${e.label}`).join("; ");

const ROTULO_SITUACAO = { ANDAMENTO: "em andamento", GANHOS: "ganho", PERDIDOS: "perdido" } as const;

/** Contagens exatas por situação e por etapa — o modelo usa estes números em vez de contar linha por linha. */
function resumoDasContagens(editais: { etapaKanban: string }[]): string {
  const porSituacao = { ANDAMENTO: 0, GANHOS: 0, PERDIDOS: 0 };
  const porEtapa = new Map<string, number>();
  for (const e of editais) {
    porSituacao[situacaoDoEdital({ etapaKanban: e.etapaKanban as EtapaKanban })]++;
    porEtapa.set(e.etapaKanban, (porEtapa.get(e.etapaKanban) ?? 0) + 1);
  }
  const etapas = ETAPAS_KANBAN.filter((e) => porEtapa.has(e.key)).map((e) => `${e.label}: ${porEtapa.get(e.key)}`);
  return `Por situação: ${porSituacao.ANDAMENTO} em andamento, ${porSituacao.GANHOS} ganho(s), ${porSituacao.PERDIDOS} perdido(s). Por etapa: ${etapas.join("; ")}.`;
}

export const FERRAMENTAS_ASSISTENTE: FerramentaDef[] = [
  {
    name: "listar_editais",
    description:
      "Lista os editais da empresa com um resumo (título, órgão, etapa do Kanban, situação, valor estimado e, nos ganhos, valor homologado, prazo de encerramento), mais as contagens exatas por situação e por etapa. Aceita filtro opcional por etapa ou situação (ganhos/perdidos/em andamento).",
    input_schema: {
      type: "object",
      properties: {
        etapa: { type: "string", enum: ETAPA_KEYS, description: `Filtra por uma etapa exata do Kanban (código = nome na tela): ${ETAPAS_E_ROTULOS}.` },
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
            resultado: { select: { valorHomologado: true } },
          },
        });
        const filtrados = editais.filter((e) => {
          if (etapa && e.etapaKanban !== etapa) return false;
          if (situacao !== "TODOS" && situacaoDoEdital(e) !== situacao) return false;
          return true;
        });
        if (filtrados.length === 0) return { resultadoTexto: "Nenhum edital encontrado com esse filtro." };
        const linhas = filtrados.map((e) => {
          const sit = situacaoDoEdital(e);
          const homologado = sit === "GANHOS" ? ` — valor homologado: ${e.resultado ? formatBRL(e.resultado.valorHomologado) : "não registrado"}` : "";
          return `- [${e.id}] ${e.titulo} — ${e.orgaoNome} — etapa: ${ETAPA_LABEL[e.etapaKanban as EtapaKanban]} — situação: ${ROTULO_SITUACAO[sit]} — valor estimado: ${
            e.orcamentoSigiloso ? "sigiloso" : formatBRL(e.valorGlobal ?? e.proposal?.valorGlobalReferencia ?? null)
          }${homologado} — encerra: ${formatDate(e.dataEncerramentoProposta?.toISOString() ?? null)}`;
        });
        return { resultadoTexto: `${filtrados.length} edital(is). ${resumoDasContagens(filtrados)}\n${linhas.join("\n")}` };
      }

      case "detalhar_edital": {
        const editalId = String(input.editalId ?? "");
        const edital = await prisma.edital.findFirst({
          where: { id: editalId, companyId },
          include: { analysis: true, proposal: true, checklistItems: true, resultado: { select: { valorHomologado: true } } },
        });
        if (!edital) return { resultadoTexto: "Edital não encontrado nesta conta." };

        const sit = situacaoDoEdital(edital);
        const partes = [
          `Título: ${edital.titulo}`,
          `Órgão: ${edital.orgaoNome}`,
          `Etapa no Kanban: ${ETAPA_LABEL[edital.etapaKanban as EtapaKanban]}`,
          `Situação: ${ROTULO_SITUACAO[sit]}`,
          `Objeto: ${edital.descricao}`,
          `Valor estimado (de referência, PNCP): ${edital.orcamentoSigiloso ? "sigiloso" : formatBRL(edital.valorGlobal)}`,
          ...(sit === "GANHOS" ? [`Valor homologado: ${edital.resultado ? formatBRL(edital.resultado.valorHomologado) : "ainda não registrado"}`] : []),
          `Encerramento das propostas: ${formatDate(edital.dataEncerramentoProposta?.toISOString() ?? null)}`,
        ];

        if (edital.analysis) {
          partes.push(
            `\nAnálise do Agente Analista:`,
            `- Resumo: ${edital.analysis.resumoObjeto}`,
            `- Habilitação exigida: ${edital.analysis.habilitacao}`,
            `- Pontos de atenção: ${edital.analysis.riscos}`
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
            ...(fonteAtiva("LICITANET") ? [`Segmento (LicitaNet): ${company.licitanetSegmentoNome ?? "não configurado"}`] : []),
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
