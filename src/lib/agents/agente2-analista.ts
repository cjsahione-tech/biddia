import { prisma } from "@/lib/prisma";
import { askJSON, MODELO_HAIKU } from "@/lib/anthropic";
import { obterTextoCompletoEdital } from "@/lib/agents/pdf-extract";
import { withAgentRun, logAudit } from "@/lib/agents/run-tracker";

// Cada grupo é uma seção de habilitação/qualificação TAL COMO o próprio edital a
// organiza (ex: "13.1 Regularidade Fiscal, Trabalhista, Econômico-Financeira e
// Jurídica" vira um grupo só, com todos os itens 13.1.1-13.1.9 dentro) — o Agente
// Secretário usa isso para montar as pastas do jeito que o edital já organiza,
// em vez de reclassificar cada item isoladamente.
export type GrupoHabilitacao = { categoriaEdital: string; itens: string[] };

type AnalysisResult = {
  resumoObjeto: string;
  obrigacoesContratada: string[];
  habilitacao: GrupoHabilitacao[];
  requisitosObrigatorios: string[];
  requisitosAdicionais: string[];
  riscos: string[];
  parecer: string;
};

export async function executarAgente2(editalId: string, opts?: { notaCorrecao?: string }) {
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
${opts?.notaCorrecao ? `\n=== CORREÇÃO PEDIDA PELO USUÁRIO (sobre a sua análise anterior) ===\n${opts.notaCorrecao}\nRefaça a análise levando isso em conta — é prioridade sobre o que você concluiu antes.` : ""}
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
  "habilitacao": [ { "categoriaEdital": string, "itens": string[] } ] — agrupe os documentos/condições de
    habilitação EXATAMENTE como o próprio edital os agrupa em suas seções e subseções (ex: se o edital tem uma
    seção "13.1 Regularidade Fiscal, Trabalhista, Econômico-Financeira e Jurídica" com os itens 13.1.1 a 13.1.9,
    coloque TODOS esses itens num único grupo, com "categoriaEdital": "Regularidade Fiscal, Trabalhista,
    Econômico-Financeira e Jurídica" — não crie subdivisões que o edital não usa). Use o texto do cabeçalho da
    seção tal como aparece no edital, sem o número da seção (ex: "13.1", "14.") e sem o texto de cada item
    individual. Se o edital não tiver uma estrutura clara de seções para habilitação, agrupe usando seu próprio
    julgamento com base nas categorias típicas da Lei 14.133/2021 (regularidade fiscal/trabalhista/econômico-
    financeira/jurídica, qualificação técnica da empresa, qualificação da equipe técnica, garantia do contrato).
  "requisitosObrigatorios": string[] (requisitos obrigatórios identificados no texto, ou típicos da modalidade se não houver texto),
  "requisitosAdicionais": string[] (requisitos adicionais desejáveis, mas não eliminatórios),
  "riscos": string[] (riscos e pontos de atenção para a empresa concorrente),
  "parecer": string (parecer final em 2-3 frases: vale a pena avaliar participar, e por quê)
}`,
      contexto,
      // 8000 em vez de 5000: a habilitação agora vem agrupada em objetos (categoriaEdital +
      // itens), bem mais verboso que a lista plana anterior — editais grandes e cheios de
      // seções de habilitação podiam estourar o teto antigo e truncar o JSON no meio.
      { model: MODELO_HAIKU, maxTokens: 8000 }
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
      opts?.notaCorrecao ? "Correção via chat" : "Análise do edital",
      "OK",
      `Análise ${opts?.notaCorrecao ? "refeita a pedido do usuário" : "concluída"} ${temTextoCompleto ? "com leitura do texto completo do edital" : "apenas com metadados (texto do edital indisponível)"}: ${result.resumoObjeto}`
    );

    return result;
  });
}
