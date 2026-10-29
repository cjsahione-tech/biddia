// Revisão do CONJUNTO de itens extraídos pelo Agente Financeiro (depois de juntar os trechos). A IA só aponta
// problemas; quem aplica é o código, com travas: a revisão NUNCA acrescenta item e NUNCA muda quantidade nem preço.

import { comRegrasComuns } from "@/lib/agents/regras-comuns";

export type RevisaoConjunto = {
  /** Itens que não são itens (total, subtotal, cabeçalho repetido, condição do edital). */
  remover?: { indice: number; motivo?: string }[];
  /** Duplicados (mesmo item repetido): o índice listado é o que sobra a mais; o primeiro fica. */
  unificar?: { indice: number; motivo?: string }[];
  /** Lote errado ou ausente, quando o texto mostra claramente qual é. */
  corrigirLote?: { indice: number; lote: string }[];
  /** Números suspeitos (quantidade zero, total muito diferente de quantidade × unitário). Só registro. */
  conferirManualmente?: { indice: number; motivo?: string }[];
  avisos?: string[];
};

export function promptRevisaoConjunto(totalItens: number): string {
  return comRegrasComuns(`FUNÇÃO
Você é o revisor da lista de itens da proposta. Recebe a lista já extraída (com índices [0..${totalItens - 1}]) e os trechos do
edital de onde ela veio. Seu trabalho é APONTAR problemas, não reescrever a lista.

PASSO A PASSO
1. Procure itens que não são itens: totais, subtotais, cabeçalhos repetidos, condições do edital. Liste em "remover" com o motivo.
2. Procure duplicados (mesmo número de item e mesma descrição). Liste o índice que sobra em "unificar" (o primeiro fica).
3. Procure itens sem lote quando os vizinhos têm lote, ou com lote errado. Liste em "corrigirLote" com o lote correto, APENAS se o
   texto mostrar claramente.
4. Procure números suspeitos (quantidade zero, valor total muito diferente de quantidade × unitário). Liste em
   "conferirManualmente". NÃO corrija o número.
5. NUNCA acrescente itens novos e NUNCA altere preços ou quantidades.

Se estiver tudo certo, devolva as listas vazias.

FORMATO DE SAÍDA (JSON)
{
  "remover": [ { "indice": number, "motivo": string } ],
  "unificar": [ { "indice": number, "motivo": string } ],
  "corrigirLote": [ { "indice": number, "lote": string } ],
  "conferirManualmente": [ { "indice": number, "motivo": string } ],
  "avisos": string[]
}

CONFERÊNCIA FINAL
- Cada entrada de "remover" tem motivo concreto?
- Não pedi para remover mais de 20% dos itens?
- Não inventei item, preço, quantidade ou lote?
- O JSON é válido e sem texto em volta?`);
}

type ItemComLote = { lote?: string | null };

/**
 * Aplica o que o revisor apontou, com travas: só índices que existem; nunca remove mais de 20% da lista (se o revisor
 * pedir mais, não remove nada); só mexe no lote. Quantidade e preço ficam exatamente como foram lidos.
 */
export function aplicarRevisaoConjunto<T extends ItemComLote>(
  itens: T[],
  diff: RevisaoConjunto | null | undefined
): { itens: T[]; removidos: number; lotesCorrigidos: number; conferirManualmente: number[] } {
  const valido = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n < itens.length;

  const aRemover = new Set<number>();
  for (const r of [...(diff?.remover ?? []), ...(diff?.unificar ?? [])]) if (valido(r?.indice)) aRemover.add(r.indice);
  // Trava de segurança: nunca deixa a revisão apagar mais de 20% da lista.
  const podeRemover = aRemover.size <= itens.length * 0.2;

  const novoLote = new Map<number, string>();
  for (const c of diff?.corrigirLote ?? []) {
    if (valido(c?.indice) && typeof c.lote === "string" && c.lote.trim() !== "") novoLote.set(c.indice, c.lote.trim());
  }

  let lotesCorrigidos = 0;
  const resultado: T[] = [];
  itens.forEach((item, i) => {
    if (podeRemover && aRemover.has(i)) return;
    const lote = novoLote.get(i);
    if (lote !== undefined && lote !== (item.lote ?? null)) {
      lotesCorrigidos++;
      resultado.push({ ...item, lote });
    } else {
      resultado.push(item);
    }
  });

  const conferirManualmente = (diff?.conferirManualmente ?? []).map((c) => c?.indice).filter(valido);
  return { itens: resultado, removidos: podeRemover ? aRemover.size : 0, lotesCorrigidos, conferirManualmente };
}
