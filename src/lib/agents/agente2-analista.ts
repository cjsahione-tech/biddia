import { prisma } from "@/lib/prisma";
import { askJSON } from "@/lib/anthropic";
import { buscarDetalheCompra, parseItemUrl } from "@/lib/agents/pncp";
import { withAgentRun, logAudit } from "@/lib/agents/run-tracker";

type AnalysisResult = {
  resumoObjeto: string;
  obrigacoesContratada: string[];
  habilitacao: string[];
  requisitosObrigatorios: string[];
  requisitosAdicionais: string[];
  riscos: string[];
  parecer: string;
};

export async function executarAgente2(editalId: string) {
  return withAgentRun(editalId, "agente2-analista", async () => {
    const edital = await prisma.edital.findUniqueOrThrow({ where: { id: editalId } });

    const pathname = new URL(edital.linkPortal).pathname.replace(/^\/app/, "");
    const { cnpj, ano, sequencial } = parseItemUrl(pathname);
    const detalhe =
      cnpj && ano && sequencial
        ? await buscarDetalheCompra(cnpj, ano, sequencial).catch(() => null)
        : null;

    const contexto = `
Título: ${edital.titulo}
Órgão: ${edital.orgaoNome} (${edital.orgaoCnpj})
Modalidade: ${edital.modalidade ?? "não informado"}
UF/Município: ${edital.uf ?? "?"}/${edital.municipio ?? "?"}
Valor estimado: ${edital.valorGlobal ?? detalhe?.valorTotalEstimado ?? "não informado"}
Descrição/objeto (busca PNCP): ${edital.descricao}
Objeto detalhado (consulta PNCP): ${detalhe?.objetoCompra ?? "não disponível"}
Informação complementar: ${detalhe?.informacaoComplementar ?? "não disponível"}
Amparo legal: ${detalhe?.amparoLegal?.nome ?? detalhe?.amparoLegal?.descricao ?? "não informado"}
Data de abertura da proposta: ${edital.dataAberturaProposta?.toISOString() ?? "não informado"}
Data de encerramento da proposta: ${edital.dataEncerramentoProposta?.toISOString() ?? "não informado"}
`.trim();

    const result = await askJSON<AnalysisResult>(
      `Você é um analista sênior de licitações públicas brasileiras (Lei 14.133/2021 e legislação correlata).
Sua tarefa é ler os metadados públicos de um edital do PNCP e produzir uma leitura preliminar objetiva e clara para
uma empresa que está avaliando participar. Seja direto, use linguagem simples, evite jargão desnecessário.
Retorne um objeto JSON com exatamente estas chaves:
{
  "resumoObjeto": string (1-2 frases explicando o que está sendo licitado),
  "obrigacoesContratada": string[] (principais obrigações da futura contratada),
  "habilitacao": string[] (documentos/condições de habilitação esperados para este tipo de contratação),
  "requisitosObrigatorios": string[] (requisitos obrigatórios claros identificados ou tipicamente exigidos nesta modalidade),
  "requisitosAdicionais": string[] (requisitos adicionais desejáveis, mas não eliminatórios),
  "riscos": string[] (riscos e pontos de atenção para a empresa concorrente),
  "parecer": string (parecer final em 2-3 frases: vale a pena avaliar participar, e por quê)
}
Como nem sempre o texto completo do edital em PDF está disponível, seja transparente quando estiver inferindo
com base na modalidade/objeto em vez de citar um trecho literal do edital.`,
      contexto
    );

    await prisma.analysis.upsert({
      where: { editalId },
      create: {
        editalId,
        resumoObjeto: result.resumoObjeto,
        obrigacoesContratada: JSON.stringify(result.obrigacoesContratada),
        habilitacao: JSON.stringify(result.habilitacao),
        requisitosObrigatorios: JSON.stringify(result.requisitosObrigatorios),
        requisitosAdicionais: JSON.stringify(result.requisitosAdicionais),
        riscos: JSON.stringify(result.riscos),
        parecer: result.parecer,
      },
      update: {
        resumoObjeto: result.resumoObjeto,
        obrigacoesContratada: JSON.stringify(result.obrigacoesContratada),
        habilitacao: JSON.stringify(result.habilitacao),
        requisitosObrigatorios: JSON.stringify(result.requisitosObrigatorios),
        requisitosAdicionais: JSON.stringify(result.requisitosAdicionais),
        riscos: JSON.stringify(result.riscos),
        parecer: result.parecer,
      },
    });

    await logAudit(
      editalId,
      "Agente Analista",
      "Análise do edital",
      "OK",
      `Análise concluída: ${result.resumoObjeto}`
    );

    return result;
  });
}
