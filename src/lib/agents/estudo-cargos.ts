import { prisma } from "@/lib/prisma";
import { askJSON, MODELO_HAIKU } from "@/lib/anthropic";
import { obterTextoCompletoEdital } from "@/lib/agents/pdf-extract";

export type CargoSugerido = { nome: string; quantidade: number };

/** Formato bruto pedido ao modelo — carrega uma citação textual como evidência de onde a
 * quantidade veio, para poder ser conferida contra o texto-fonte antes de confiar nela. */
export type CargoBrutoModelo = { nome: string; quantidade: number; evidenciaQuantidade?: string };

function normalizarParaBusca(texto: string): string {
  return texto.toLowerCase().replace(/\s+/g, " ");
}

/** Palavras que costumam aparecer perto de uma contagem de pessoal real — exigir pelo
 * menos uma delas na citação bloqueia números "tecnicamente presentes no texto" mas que
 * não têm nada a ver com quantidade de gente (ex: um valor monetário, um percentual). */
const INDICADORES_QUANTIDADE_PESSOAL = [
  "equipe",
  "profissional",
  "profissionais",
  "técnic",
  "enfermeir",
  "mínima",
  "mínimo",
  "quantidade",
  "posto",
  "vaga",
  "contratar",
  "disponibilizar",
  "composta",
  "colaborador",
  "empregado",
  "funcionário",
];

/** Um número "solto" na citação (não preso a outra numeração) — ex.: rejeita "11" dentro
 * de "11.1.34" (número de cláusula/item) ou "5" dentro de "5.000,00" (valor monetário),
 * mas aceita "6" em "equipe mínima de 6 (seis) técnicos". */
export function numeroEhAutonomo(evidencia: string, numero: number): boolean {
  const padrao = new RegExp(`(?<![\\d.,])\\b${numero}\\b(?![.,]\\d)`);
  return padrao.test(evidencia);
}

/**
 * Modelos de linguagem ocasionalmente "calculam" ou "encontram" uma quantidade a partir
 * de sinais que nada têm a ver com contagem de pessoal — observado na prática durante o
 * desenvolvimento: volume de exames/mês citado como se fosse headcount, e números de
 * cláusula do próprio edital (ex: "11.1.34") lidos como se fossem uma quantidade. Por
 * isso toda quantidade > 1 exige uma citação literal do texto que (1) realmente existe no
 * texto-fonte, (2) contém o número como um token autônomo (não parte de uma cláusula ou
 * valor monetário) e (3) menciona algo relacionado a pessoal — sem as três condições, cai
 * para 1 (o padrão seguro) em vez de propagar um número inventado para a UI.
 */
export function conferirEvidencias(cargos: CargoBrutoModelo[], textoFonte: string): CargoSugerido[] {
  const textoBusca = normalizarParaBusca(textoFonte);
  return cargos.map((c) => {
    if (c.quantidade <= 1) return { nome: c.nome, quantidade: c.quantidade };
    const quantidadeArredondada = Math.round(c.quantidade);
    const evidencia = (c.evidenciaQuantidade ?? "").trim();
    const evidenciaLower = evidencia.toLowerCase();

    const evidenciaExisteNoTexto = evidencia.length >= 3 && textoBusca.includes(normalizarParaBusca(evidencia));
    const numeroAutonomo = numeroEhAutonomo(evidencia, quantidadeArredondada);
    const mencionaPessoal = INDICADORES_QUANTIDADE_PESSOAL.some((p) => evidenciaLower.includes(p));

    if (!evidenciaExisteNoTexto || !numeroAutonomo || !mencionaPessoal) {
      console.warn(
        `Cargo "${c.nome}": quantidade ${c.quantidade} sem evidência verificável no texto ("${evidencia}") — usando 1.`
      );
      return { nome: c.nome, quantidade: 1 };
    }
    return { nome: c.nome, quantidade: quantidadeArredondada };
  });
}

/** Palavras-chave para guiar a seleção de trecho quando o edital/TR é grande demais para
 * caber inteiro no prompt — sem isso, um documento longo (comum: edital + TR num único
 * PDF de 100+ páginas) tem a seção de dimensionamento de equipe cortada fora só porque
 * ela não fica nas primeiras dezenas de milhares de caracteres. */
const PALAVRAS_CHAVE_EQUIPE = [
  "equipe",
  "quadro de pessoal",
  "quadro funcional",
  "mão de obra",
  "postos de trabalho",
  "posto de serviço",
  "recursos humanos",
  "dimensionamento",
  "quantitativo de pessoal",
  "profissionais",
  "cargo",
  "função",
  "escala de trabalho",
  "carga horária",
  "regime de trabalho",
  "jornada",
  "CLT",
  "responsável técnico",
  "encarregado",
];

const TAMANHO_MAX_TEXTO = 60_000;
const MAX_CARGOS = 40;

/** Exportado só para teste unitário puro (sem IA/DB) — dedupe, arredondamento e teto de
 * quantidade de linhas aplicados ao que o modelo devolve. */
export function normalizarCargos(cargos: CargoSugerido[]): CargoSugerido[] {
  const porNome = new Map<string, number>();
  for (const c of cargos) {
    const nome = (c.nome ?? "").trim();
    if (!nome) continue;
    const quantidade = Number.isFinite(c.quantidade) && c.quantidade > 0 ? Math.round(c.quantidade) : 1;
    const chave = nome.toLowerCase();
    // Some cargo repetido em partes diferentes do texto (edital + TR, ou mencionado duas
    // vezes) soma as quantidades em vez de duplicar a linha — mantém o primeiro nome
    // como escrito (capitalização original), a chave é só para deduplicar.
    porNome.set(chave, (porNome.get(chave) ?? 0) + quantidade);
  }
  // Mantém o nome como apareceu na primeira ocorrência.
  const nomesOriginais = new Map<string, string>();
  for (const c of cargos) {
    const nome = (c.nome ?? "").trim();
    if (!nome) continue;
    const chave = nome.toLowerCase();
    if (!nomesOriginais.has(chave)) nomesOriginais.set(chave, nome);
  }

  return Array.from(porNome.entries())
    .map(([chave, quantidade]) => ({ nome: nomesOriginais.get(chave) ?? chave, quantidade }))
    .slice(0, MAX_CARGOS);
}

/**
 * Etapa 4 (ramo Serviço): varre o edital/termo de referência em busca dos cargos/funções
 * profissionais exigidos para executar o serviço, com a quantidade mínima quando o texto
 * especificar. Quando o edital não indicar quantidade para um cargo, a sugestão vem com
 * quantidade 1 — nunca um número inventado — e cabe ao usuário ajustar pela própria
 * experiência antes de confirmar a etapa.
 *
 * `equipeMinimaHint` é o array de texto livre já extraído na Etapa 2 (Requisitos) — quando
 * presente, é passado como contexto adicional para o modelo estruturar melhor (nome do
 * cargo + quantidade) em vez de reextrair do zero, reduzindo divergência entre as duas
 * etapas sobre a mesma informação.
 */
export async function extrairCargosServico(
  editalId: string,
  equipeMinimaHint?: string[]
): Promise<{ cargos: CargoSugerido[]; baseadoEmTextoCompleto: boolean }> {
  const edital = await prisma.edital.findUniqueOrThrow({ where: { id: editalId } });
  const { textoEdital, textoTermoReferencia, temTextoCompleto } = await obterTextoCompletoEdital(editalId, {
    palavrasChave: PALAVRAS_CHAVE_EQUIPE,
    tamanhoMax: TAMANHO_MAX_TEXTO,
  });

  if (!temTextoCompleto) {
    return { cargos: [], baseadoEmTextoCompleto: false };
  }

  const hintTexto =
    equipeMinimaHint && equipeMinimaHint.length > 0
      ? `\n=== EQUIPE MÍNIMA JÁ IDENTIFICADA ANTERIORMENTE (Etapa de Requisitos, texto livre) ===\n${equipeMinimaHint.join("\n")}`
      : "";

  const contexto = `
Título: ${edital.titulo}
Órgão: ${edital.orgaoNome}
Descrição/objeto (busca PNCP): ${edital.descricao}
${textoEdital ? `\n=== TEXTO DO EDITAL (trecho relevante) ===\n${textoEdital}` : ""}
${textoTermoReferencia ? `\n=== TEXTO DO TERMO DE REFERÊNCIA (trecho relevante) ===\n${textoTermoReferencia}` : ""}
${hintTexto}
`.trim();

  const result = await askJSON<{ cargos: CargoBrutoModelo[] }>(
    `Você é um especialista em licitações públicas brasileiras (Lei 14.133/2021) analisando um edital de PRESTAÇÃO
DE SERVIÇO para montar a folha de pagamento de um estudo de viabilidade. Extraia do texto TODOS os cargos/funções
profissionais OPERACIONAIS exigidos para EXECUTAR o serviço (ex: "Técnico de Laboratório", "Enfermeiro", "Vigilante",
"Motorista", "Auxiliar de Limpeza"). Se houver uma seção "equipe mínima já identificada" abaixo, use-a como ponto de
partida e reconcilie com o texto completo — ela pode estar incompleta ou pouco estruturada.

NÃO inclua papéis puramente administrativos/societários da empresa licitante que não sejam exigidos na equipe de
execução (ex: sócio-administrador, contador da licitante) — a menos que o edital explicitamente exija a presença
dessa pessoa na equipe alocada ao serviço (ex: "Responsável Técnico" que precisa estar fisicamente na execução).

NÃO inclua termos genéricos/guarda-chuva ("Técnico", "Colaborador", "Equipe técnica", "Profissional de saúde") no
lugar de um cargo específico já coberto (ex: se você já extraiu "Técnico de Laboratório", não crie também um
"Técnico" avulso com parte da mesma quantidade). A ÚNICA exceção: quando o texto der um número agregado para um
GRUPO/regime (ex: "plantão 24h... sendo no mínimo 10 colaboradores, distribuídos em turnos") sem dizer quais cargos
específicos compõem esse total, crie UMA linha separada com um nome que reflita a MESMA generalidade do texto (ex:
"Colaboradores em regime de plantão (24h)") — NUNCA atribua esse número agregado a um dos cargos específicos que
você já extraiu, mesmo que pareça razoável (ex: NÃO some esses 10 a "Técnico de Laboratório" nem crie "Técnico de
Plantão" com esse número — o texto não disse que são técnicos).

REGRA CRÍTICA sobre quantidade — leia com atenção, é a parte que mais erra:
- A quantidade DEFAULT é 1 para todo cargo exigido. Só use um número maior que 1 quando o texto afirmar
  EXPLICITAMENTE uma quantidade de PESSOAS para aquele cargo/grupo específico (ex: "6 técnicos de laboratório",
  "equipe mínima de 2 enfermeiros", "no mínimo 10 colaboradores em regime de plantão").
- É TERMINANTEMENTE PROIBIDO calcular ou estimar uma quantidade a partir de outros números do texto (volume de
  exames/mês, valor do contrato, população atendida, número de leitos, carga horária, percentuais etc.), e é
  TERMINANTEMENTE PROIBIDO transferir um número agregado de um grupo/regime genérico para um cargo específico que o
  texto não associou a esse número. Se você não encontrar um número EXPLICITAMENTE associado a uma contagem de
  PESSOAS para aquele cargo exato, a quantidade é 1 — sem exceção.
- NUNCA cite um número de item/cláusula/seção do próprio edital (ex: "11.1.34", "2.2.7") como se fosse uma
  quantidade — esses números identificam parágrafos, não pessoas.
- Toda quantidade maior que 1 exige o campo "evidenciaQuantidade": uma citação literal (copiada exatamente, sem
  parafrasear) da frase completa que relaciona esse número a uma contagem de pessoas para aquele cargo. Se você não
  consegue copiar uma citação literal que faça essa relação, a quantidade correta é 1.
- Se o edital detalhar turnos/postos com números explícitos que somam ao todo (ex: "2 postos, 3 vigilantes por
  posto"), some-os e cite o trecho de onde tirou cada parcela na evidência.

Se o texto não mencionar cargos explicitamente, retorne um array vazio — não invente uma equipe típica do setor.

Retorne um objeto JSON com exatamente esta chave:
{ "cargos": [{ "nome": string, "quantidade": number, "evidenciaQuantidade": string (opcional, obrigatório se quantidade > 1) }] }`,
    contexto,
    { model: MODELO_HAIKU, maxTokens: 2500 }
  );

  const cargosVerificados = conferirEvidencias(result.cargos ?? [], contexto);
  return { cargos: normalizarCargos(cargosVerificados), baseadoEmTextoCompleto: true };
}
