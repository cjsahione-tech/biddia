import { prisma } from "@/lib/prisma";
import { askJSON, MODELO_HAIKU } from "@/lib/anthropic";
import { obterTextoCompletoEdital } from "@/lib/agents/pdf-extract";
import { executarAgente3 } from "@/lib/agents/agente3-financeiro";
import type { RamoEstudo } from "@/lib/estudo-viabilidade";

export type RequisitosEstudo = {
  objeto: string;
  criterioJulgamento: string;
  prazoExecucao: string;
  localEntrega: string;
  formaPagamento: string;
  garantiasExigidas: string;
  // Só preenchido quando ramo === "SERVICO".
  equipeMinima: string[];
  certificacoesExigidas: string[];
  // Só preenchido quando ramo === "PRODUTO".
  especificacaoTecnica: string;
  prazoEntrega: string;
  baseadoEmTextoCompleto: boolean;
};

/**
 * Etapa 2 do Estudo de Viabilidade: extrai do texto do edital os campos qualitativos
 * (objeto, critério de julgamento, exigências técnicas, prazos, local de entrega, forma
 * de pagamento e garantias). Itens/quantidades/valores estimados NÃO são reextraídos
 * aqui — se o edital ainda não tem uma Proposal (Agente Financeiro), aciona o agente
 * já existente para montá-la, reaproveitando o mesmo pipeline testado do quadro Kanban
 * em vez de duplicar a lógica de extração de tabela de preços.
 */
export async function extrairRequisitosEstudo(editalId: string, ramo: RamoEstudo): Promise<RequisitosEstudo> {
  const edital = await prisma.edital.findUniqueOrThrow({ where: { id: editalId } });

  const proposalExistente = await prisma.proposal.findUnique({ where: { editalId } });
  if (!proposalExistente) {
    await executarAgente3(editalId).catch((err) => {
      console.error(`Falha ao montar a proposta do edital ${editalId} para o estudo de viabilidade:`, err);
    });
  }

  const { textoEdital, textoTermoReferencia, temTextoCompleto } = await obterTextoCompletoEdital(editalId);

  const contexto = `
Título: ${edital.titulo}
Órgão: ${edital.orgaoNome}
Modalidade: ${edital.modalidade ?? "não informado"}
Descrição/objeto (busca PNCP): ${edital.descricao}
${textoEdital ? `\n=== TEXTO COMPLETO DO EDITAL ===\n${textoEdital}` : ""}
${textoTermoReferencia ? `\n=== TEXTO COMPLETO DO TERMO DE REFERÊNCIA ===\n${textoTermoReferencia}` : ""}
`.trim();

  const instrucaoRamo =
    ramo === "SERVICO"
      ? `O ramo deste estudo é PRESTAÇÃO DE SERVIÇO — preencha "equipeMinima" e "certificacoesExigidas" com o que o
texto exigir. Deixe "especificacaoTecnica" como string vazia e "prazoEntrega" também (use "prazoExecucao" para o
prazo do contrato de serviço).`
      : `O ramo deste estudo é FORNECIMENTO DE PRODUTO — preencha "especificacaoTecnica" e "prazoEntrega" (prazo de
entrega do bem) com o que o texto exigir. Deixe "equipeMinima" e "certificacoesExigidas" como array vazio.`;

  const instrucaoFonte = temTextoCompleto
    ? `Você TEM ACESSO ao texto completo do edital e/ou termo de referência acima — baseie-se neles, citando o item
ou cláusula quando possível. Se alguma informação pedida não estiver no texto, escreva "Não encontrado no texto do
edital" em vez de inventar.`
    : `O texto completo do edital NÃO estava disponível — responda com base apenas nos metadados públicos abaixo e
escreva "Texto do edital indisponível para leitura" nos campos que dependeriam dele.`;

  const result = await askJSON<Omit<RequisitosEstudo, "baseadoEmTextoCompleto">>(
    `Você é um especialista em licitações públicas brasileiras (Lei 14.133/2021) extraindo os requisitos de um
edital para compor um estudo de viabilidade de participação de uma empresa. ${instrucaoFonte}

${instrucaoRamo}

Retorne um objeto JSON com exatamente estas chaves:
{
  "objeto": string (1-2 frases descrevendo o objeto da licitação),
  "criterioJulgamento": string (ex: "menor preço por item", "menor preço global", "maior desconto"),
  "prazoExecucao": string (prazo de execução do contrato, como consta no edital),
  "localEntrega": string (local de entrega do bem ou de prestação do serviço),
  "formaPagamento": string (condições/prazo de pagamento),
  "garantiasExigidas": string (garantia contratual e/ou de execução exigida; "Não exigida" se o edital não pedir),
  "equipeMinima": string[] (cargos e quantidade mínima exigidos — só se ramo for serviço; [] caso contrário),
  "certificacoesExigidas": string[] (certificações/licenças/registros exigidos — só se ramo for serviço; [] caso contrário),
  "especificacaoTecnica": string (especificação técnica exigida do bem — só se ramo for produto; "" caso contrário),
  "prazoEntrega": string (prazo de entrega do bem — só se ramo for produto; "" caso contrário)
}`,
    contexto,
    { model: MODELO_HAIKU, maxTokens: 3000 }
  );

  return { ...result, baseadoEmTextoCompleto: temTextoCompleto };
}
