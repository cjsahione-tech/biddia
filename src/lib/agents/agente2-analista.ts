import { prisma } from "@/lib/prisma";
import { askJSON } from "@/lib/anthropic";
import { obterTextoCompletoEdital } from "@/lib/agents/pdf-extract";
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

    // Não busca mais o detalhe da contratação no PNCP aqui: o valor já está gravado no
    // edital e o texto completo do PDF (abaixo) cobre objeto/informação complementar
    // com muito mais precisão — a chamada extra ao PNCP só somava latência.
    const { textoEdital, textoTermoReferencia, temTextoCompleto } =
      await obterTextoCompletoEdital(editalId);

    const contexto = `
Título: ${edital.titulo}
Órgão: ${edital.orgaoNome} (${edital.orgaoCnpj})
Modalidade: ${edital.modalidade ?? "não informado"}
UF/Município: ${edital.uf ?? "?"}/${edital.municipio ?? "?"}
Valor estimado: ${edital.valorGlobal ?? "não informado"}
Descrição/objeto (busca PNCP): ${edital.descricao}
Data de abertura da proposta: ${edital.dataAberturaProposta?.toISOString() ?? "não informado"}
Data de encerramento da proposta: ${edital.dataEncerramentoProposta?.toISOString() ?? "não informado"}
${textoEdital ? `\n=== TEXTO COMPLETO DO EDITAL (extraído do PDF oficial) ===\n${textoEdital}` : ""}
${textoTermoReferencia ? `\n=== TEXTO COMPLETO DO TERMO DE REFERÊNCIA (extraído do PDF oficial) ===\n${textoTermoReferencia}` : ""}
`.trim();

    const instrucaoFonte = temTextoCompleto
      ? `Você TEM ACESSO ao texto completo do edital e/ou do termo de referência (marcados acima entre "===").
Baseie sua análise NELES, não em suposições — cite trechos ou seções específicas sempre que possível
(ex: "conforme item 8.2 do edital..."). Se alguma informação pedida não estiver no texto fornecido, diga
explicitamente "não encontrado no texto do edital" em vez de inventar.`
      : `O texto completo do edital NÃO estava disponível para leitura — você está trabalhando apenas com os
metadados públicos resumidos abaixo. Seja transparente disso: não afirme haver lido cláusulas específicas,
e sinalize que a leitura completa do PDF pelo usuário continua necessária antes de decidir participar.`;

    const result = await askJSON<AnalysisResult>(
      `Você é um analista sênior de licitações públicas brasileiras (Lei 14.133/2021 e legislação correlata).
Sua tarefa é produzir uma leitura objetiva e clara do edital para uma empresa que está avaliando participar.
Seja direto, use linguagem simples, evite jargão desnecessário.

${instrucaoFonte}

Retorne um objeto JSON com exatamente estas chaves:
{
  "resumoObjeto": string (1-2 frases explicando o que está sendo licitado),
  "obrigacoesContratada": string[] (principais obrigações da futura contratada),
  "habilitacao": string[] (documentos/condições de habilitação exigidos, citando o item do edital quando souber),
  "requisitosObrigatorios": string[] (requisitos obrigatórios identificados no texto, ou típicos da modalidade se não houver texto),
  "requisitosAdicionais": string[] (requisitos adicionais desejáveis, mas não eliminatórios),
  "riscos": string[] (riscos e pontos de atenção para a empresa concorrente),
  "parecer": string (parecer final em 2-3 frases: vale a pena avaliar participar, e por quê)
}`,
      contexto,
      { maxTokens: 6000 }
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
        baseadoEmTextoCompleto: temTextoCompleto,
      },
      update: {
        resumoObjeto: result.resumoObjeto,
        obrigacoesContratada: JSON.stringify(result.obrigacoesContratada),
        habilitacao: JSON.stringify(result.habilitacao),
        requisitosObrigatorios: JSON.stringify(result.requisitosObrigatorios),
        requisitosAdicionais: JSON.stringify(result.requisitosAdicionais),
        riscos: JSON.stringify(result.riscos),
        parecer: result.parecer,
        baseadoEmTextoCompleto: temTextoCompleto,
      },
    });

    await logAudit(
      editalId,
      "Agente Analista",
      "Análise do edital",
      "OK",
      `Análise concluída ${temTextoCompleto ? "com leitura do texto completo do edital" : "apenas com metadados (texto do edital indisponível)"}: ${result.resumoObjeto}`
    );

    return result;
  });
}
