import type { SituacaoExigencia, StatusHabilitacao } from "@/lib/habilitacao";

// "Revisar manualmente": quando o resultado da auditoria parece bom (Habilitada / Habilitada com ressalvas) mas os
// sinais dizem que a leitura pode ter deixado exigências de fora, o sistema NÃO afirma — pede revisão de uma pessoa.
// "Não habilitada" não passa por aqui: já é a resposta conservadora.
//
// Limites calibrados nas 10 auditorias concluídas até 21/10/2026 (somente leitura do banco):
//   - exigências encontradas: de 4 a 59; as 9 auditorias sólidas têm 10 ou mais; a única com 4 era também a única
//     com leitura incompleta e resultado "100%" — exatamente o caso que não pode ser dado como certo.
//   - categorias do núcleo (fiscal, jurídica, trabalhista): as 10 têm as três.
//   - exigências em que a conferência não teve certeza: de 0% a 50% (mediana ~21%); 4 das 10 passam de 30%.
//     O limite de 50% só pega os extremos (e como esse caso já sai "Não habilitada", nada muda para ele).

/** Menos exigências do que isto num resultado "bom" é suspeito: um edital de habilitação costuma ter mais. */
export const MIN_EXIGENCIAS_CONFIAVEL = 8;
/** Categorias que praticamente todo edital exige (Lei 14.133, art. 62–69). Sem nenhuma exigência de uma delas, a leitura pode ter falhado. */
export const CATEGORIAS_DO_NUCLEO: { id: string; nome: string }[] = [
  { id: "juridica", nome: "habilitação jurídica" },
  { id: "fiscal", nome: "regularidade fiscal" },
  { id: "trabalhista", nome: "regularidade trabalhista" },
];
/** A partir desta fração de exigências com conferência incerta, o resultado não é confiável. */
export const LIMITE_FRACAO_INCERTAS = 0.5;
/** Com menos itens que isto a fração não significa nada. */
export const MIN_ITENS_PARA_FRACAO = 5;

export type LinhaParaConfianca = { categoria: string; situacao: SituacaoExigencia; certeza: boolean };

export type AvaliacaoDeConfianca = { revisar: boolean; motivos: string[] };

export function avaliarConfianca(opts: {
  linhas: LinhaParaConfianca[];
  statusCalculado: StatusHabilitacao;
  /** Avisos já prontos vindos da leitura (anexo em link externo, documentos que se contradizem): cada um pede revisão. */
  avisos?: string[];
}): AvaliacaoDeConfianca {
  if (opts.statusCalculado === "NAO_HABILITADA") return { revisar: false, motivos: [] };

  const motivos: string[] = [];
  const total = opts.linhas.length;

  if (total < MIN_EXIGENCIAS_CONFIAVEL) {
    motivos.push(
      `Foram encontradas só ${total} exigência(s) de habilitação — um edital costuma ter mais. A leitura pode ter deixado exigências de fora.`
    );
  }

  const presentes = new Set(opts.linhas.map((l) => l.categoria));
  const ausentes = CATEGORIAS_DO_NUCLEO.filter((c) => !presentes.has(c.id));
  if (ausentes.length > 0) {
    motivos.push(`Nenhuma exigência de ${ausentes.map((c) => c.nome).join(", ")} foi encontrada, e quase todo edital exige.`);
  }

  const consideradas = opts.linhas.filter((l) => l.situacao !== "NAO_SE_APLICA");
  const incertas = consideradas.filter((l) => !l.certeza).length;
  if (consideradas.length >= MIN_ITENS_PARA_FRACAO && incertas / consideradas.length >= LIMITE_FRACAO_INCERTAS) {
    motivos.push(
      `Em ${incertas} de ${consideradas.length} exigências a conferência não teve certeza de qual documento da empresa atende.`
    );
  }

  motivos.push(...(opts.avisos ?? []));

  return { revisar: motivos.length > 0, motivos };
}

/** Lê os motivos gravados na auditoria (JSON); qualquer coisa inválida vira lista vazia. */
export function lerMotivosDeRevisao(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
