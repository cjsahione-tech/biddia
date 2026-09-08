import { askJSON, isAIConfigured } from "@/lib/anthropic";

type RelevanciaResult = { relevante: boolean };

/**
 * Avalia se o objeto de um edital tem relação direta com o que a empresa realmente
 * fornece/executa (não apenas a mesma área genérica). Usa um modelo rápido e barato
 * (Haiku) porque é uma classificação simples de sim/não, repetida por edital candidato.
 *
 * Sem chave de IA configurada, não há como avaliar semanticamente — nesse caso o
 * candidato é aceito (a filtragem por palavra-chave e por tipo de objeto já se aplicou
 * antes desta função ser chamada).
 */
export async function editalERelevante(
  objetoSocial: string,
  tituloEdital: string,
  descricaoEdital: string
): Promise<boolean> {
  if (!isAIConfigured()) return true;

  try {
    const result = await askJSON<RelevanciaResult>(
      `Você filtra licitações públicas para uma empresa participar. Dado o objeto social da
empresa e o objeto de uma licitação, diga se a empresa realista e diretamente forneceria ou
executaria aquele objeto. Seja rigoroso: pertencer à mesma área genérica não é suficiente —
o item específico precisa ser algo que a empresa de fato vende ou presta.
Responda em JSON: { "relevante": boolean }`,
      `Objeto social da empresa: ${objetoSocial}\n\nObjeto da licitação: ${tituloEdital} — ${descricaoEdital}`,
      { model: "claude-haiku-4-5-20251001", maxTokens: 200 }
    );
    return !!result.relevante;
  } catch {
    // Falha na chamada de IA (rede, limite, etc.) não deve bloquear a captura do edital;
    // a filtragem por palavra-chave e tipo de objeto já reduziu o ruído antes disso.
    return true;
  }
}
