import { prisma } from "@/lib/prisma";
import { askJSON, MODELO_HAIKU } from "@/lib/anthropic";
import { obterTextoCompletoEdital } from "@/lib/agents/pdf-extract";

export type CargoSugerido = { nome: string; quantidade: number };

/**
 * Etapa 4 (ramo Serviço): varre o edital/termo de referência em busca dos cargos/funções
 * profissionais exigidos para executar o serviço, com a quantidade mínima quando o texto
 * especificar. Quando o edital não indicar quantidade para um cargo, a sugestão vem com
 * quantidade 1 — nunca um número inventado — e cabe ao usuário ajustar pela própria
 * experiência antes de confirmar a etapa.
 */
export async function extrairCargosServico(
  editalId: string
): Promise<{ cargos: CargoSugerido[]; baseadoEmTextoCompleto: boolean }> {
  const edital = await prisma.edital.findUniqueOrThrow({ where: { id: editalId } });
  const { textoEdital, textoTermoReferencia, temTextoCompleto } = await obterTextoCompletoEdital(editalId);

  if (!temTextoCompleto) {
    return { cargos: [], baseadoEmTextoCompleto: false };
  }

  const contexto = `
Título: ${edital.titulo}
Órgão: ${edital.orgaoNome}
Descrição/objeto (busca PNCP): ${edital.descricao}
${textoEdital ? `\n=== TEXTO COMPLETO DO EDITAL ===\n${textoEdital}` : ""}
${textoTermoReferencia ? `\n=== TEXTO COMPLETO DO TERMO DE REFERÊNCIA ===\n${textoTermoReferencia}` : ""}
`.trim();

  const result = await askJSON<{ cargos: CargoSugerido[] }>(
    `Você é um especialista em licitações públicas brasileiras (Lei 14.133/2021) analisando um edital de PRESTAÇÃO
DE SERVIÇO para montar a folha de pagamento de um estudo de viabilidade. Extraia do texto TODOS os cargos/funções
profissionais exigidos para executar o serviço (ex: "Técnico de Laboratório", "Enfermeiro", "Vigilante", "Motorista").

Para cada cargo, informe a quantidade mínima exigida SE o texto especificar (ex: "6 técnicos", "equipe mínima de 2
enfermeiros"). Se o edital exigir o cargo mas não disser a quantidade, use quantidade 1 (o usuário vai ajustar
conforme a experiência dele — nunca invente um número maior). Se o texto não mencionar cargos explicitamente (ex:
edital de serviço sem exigência de equipe mínima detalhada), retorne um array vazio.

Retorne um objeto JSON com exatamente esta chave:
{ "cargos": [{ "nome": string, "quantidade": number }] }`,
    contexto,
    { model: MODELO_HAIKU, maxTokens: 2000 }
  );

  return { cargos: result.cargos ?? [], baseadoEmTextoCompleto: true };
}
