import { askJSON, isAIConfigured, MODELO_HAIKU } from "@/lib/anthropic";
import { classificarTipoObjeto, type TipoObjeto } from "@/lib/agents/classificador-objeto";
import { comRegrasComuns } from "@/lib/agents/regras-comuns";
import { mapComLimite } from "@/lib/concorrencia";

export type ClassificacaoEdital = {
  relevante: boolean;
  tipoObjeto: TipoObjeto;
};

type CandidatoParaClassificar = {
  numeroControle: string;
  titulo: string;
  descricao: string;
};

type RespostaItemIA = {
  numeroControle: string;
  relevante: boolean;
  tipoObjeto: "SERVICO" | "BEM" | "AMBOS" | "INDEFINIDO";
};

// Quantos editais mandar por chamada de IA. Grupos pequenos mantêm a resposta curta e
// confiável; os grupos rodam em paralelo com um teto de concorrência (ver
// LIMITE_GRUPOS_PARALELOS) — sem isso, uma empresa com muitas palavras-chave (até ~100
// candidatos cada) podia disparar dezenas de chamadas à IA de uma vez, estourando limite
// de taxa da Anthropic ou o teto de tempo da função serverless.
const TAMANHO_GRUPO = 12;
const LIMITE_GRUPOS_PARALELOS = 5;

function normalizarTipo(t: RespostaItemIA["tipoObjeto"]): TipoObjeto {
  if (t === "SERVICO" || t === "BEM" || t === "AMBOS") return t;
  return null;
}

// Texto usado quando não foi possível gerar exemplos para a empresa (sem IA, resposta inválida...): a regra geral
// vale para qualquer ramo, sem citar nenhum setor específico.
export const EXEMPLOS_GENERICOS = `a mesma área de atuação não basta. Compare o objeto da licitação com o que o objeto social diz que a empresa faz.
Uma licitação de OUTRA especialidade da mesma área (por exemplo, quem fornece o produto, quem aluga o equipamento, quem faz a obra,
quem presta um serviço parecido mas diferente) NÃO é da empresa, mesmo que use palavras parecidas.`;

const cacheExemplos = new Map<string, string>();
const TETO_CACHE_EXEMPLOS = 200;

/**
 * Monta, a partir do objeto social, os exemplos de "parece igual e não é" que calibram o filtro para o ramo de CADA
 * empresa (antes o filtro tinha exemplos fixos de laboratório de análises clínicas e errava para qualquer outro ramo).
 * Uma chamada barata à IA por empresa, guardada em memória; se falhar, vale a regra geral (EXEMPLOS_GENERICOS).
 */
export async function gerarExemplosDaEmpresa(objetoSocial: string): Promise<string> {
  const chave = objetoSocial.trim();
  if (!chave) return EXEMPLOS_GENERICOS;
  const guardado = cacheExemplos.get(chave);
  if (guardado) return guardado;

  try {
    const r = await askJSON<{ exemplos?: unknown }>(
      `Você calibra um filtro de licitações públicas para UMA empresa. Com base SOMENTE no objeto social abaixo, escreva
exemplos curtos para ajudar o filtro a distinguir o que é da empresa do que só parece ser:
- de 3 a 5 linhas "subdomínios que parecem iguais e não são": cada uma diz o que a empresa faz e o que parece ser a
  mesma coisa mas é outra atividade (outro tipo de empresa seria a contratada);
- 2 linhas de licitações que seriam RELEVANTES e 2 que NÃO seriam.
Não invente atividades que o objeto social não menciona. Se o objeto social for vago, escreva menos linhas em vez de chutar.

Responda em JSON: { "exemplos": string[] } (uma linha de texto por item da lista).`,
      `Objeto social da empresa: ${chave.slice(0, 1500)}`,
      { model: MODELO_HAIKU, maxTokens: 700 }
    );
    const linhas = Array.isArray(r.exemplos) ? r.exemplos.filter((l): l is string => typeof l === "string" && l.trim() !== "") : [];
    const texto = linhas.length > 0 ? linhas.map((l) => `   - ${l.trim()}`).join("\n") : EXEMPLOS_GENERICOS;
    if (cacheExemplos.size >= TETO_CACHE_EXEMPLOS) cacheExemplos.clear();
    cacheExemplos.set(chave, texto);
    return texto;
  } catch (err) {
    console.error("Falha ao gerar os exemplos do filtro de relevância — usando a regra geral:", err);
    return EXEMPLOS_GENERICOS;
  }
}

export function promptRelevancia(exemplosDaEmpresa: string): string {
  return comRegrasComuns(`FUNÇÃO
Você é o filtro de oportunidades do Bidd.IA. Para cada licitação da lista que receber, você decide duas coisas:
(1) se vale a pena a empresa descrita olhar essa licitação e (2) o que a contratada entregaria principalmente.

A PERGUNTA-GUIA
Para cada licitação, faça uma única pergunta: "a EMPRESA descrita seria a CONTRATADA principal deste objeto específico?"
Estar na mesma área não basta. O subdomínio precisa bater.

DADOS QUE VOCÊ RECEBE
- O objeto social da empresa.
- Uma lista numerada de licitações. Cada item traz numeroControle, título e descrição resumida (a descrição pode estar cortada).

PASSO A PASSO (faça para cada licitação, uma de cada vez)
1. Leia o título e a descrição inteiros.
2. Identifique o que seria entregue: um serviço executado, um produto fornecido, os dois, ou não dá para saber.
3. Compare com o objeto social da empresa. Ela realmente executa ou fornece isso?
4. Verifique o subdomínio. Exemplos para a empresa descrita (use como guia, não como lista fechada):
${exemplosDaEmpresa}
5. Decida "relevante":
   - true somente se a empresa seria, de forma realista e direta, a contratada principal daquele objeto.
   - false se a contratada natural seria outro tipo de empresa.
   - NA DÚVIDA REAL entre relevante e não relevante: escolha true. Perder uma oportunidade custa mais caro do que olhar um edital a mais.
6. Decida "tipoObjeto":
   - "SERVICO": prestação de serviço, mão de obra, execução, credenciamento de prestador, realização de exames/laudos.
   - "BEM": fornecimento, aquisição ou compra de produtos, insumos, materiais ou equipamentos. Atenção: "aquisição de
     insumos COM comodato de equipamento e manutenção" continua sendo "BEM". O núcleo é o fornecimento; o comodato e a
     manutenção do equipamento fornecido são acessórios.
   - "AMBOS": use APENAS quando fornecer o bem E prestar o serviço são partes essenciais, de valor relevante e claramente
     separáveis. Na dúvida entre "AMBOS" e um tipo específico, escolha o tipo dominante.
   - "INDEFINIDO": quando o texto realmente não permite saber.

FORMATO DE SAÍDA (JSON, um item por licitação, na mesma ordem da lista)
{ "itens": [ { "numeroControle": string (copie exatamente o valor entre colchetes), "relevante": boolean, "tipoObjeto": "SERVICO" | "BEM" | "AMBOS" | "INDEFINIDO" } ] }

REGRAS ESPECÍFICAS
- A resposta deve ter exatamente um item para cada licitação recebida, nem mais, nem menos.
- Copie o numeroControle caractere por caractere. Se errar uma letra, o sistema perde o item.
- Não escreva justificativa fora do JSON.
- Não use null. Use "INDEFINIDO" quando não souber o tipo.

CONFERÊNCIA FINAL (faça antes de responder)
- Contei os itens da lista e os itens da resposta: o número é o mesmo?
- Todos os numeroControle estão idênticos aos recebidos?
- Nenhum item marcado como relevante só porque "é da mesma área" (mas na dúvida real, true)?
- Nenhum item de aquisição de insumo com comodato marcado como "AMBOS" ou "SERVICO"?
- O JSON é válido e sem texto em volta?`);
}

async function classificarGrupo(
  objetoSocial: string,
  candidatos: CandidatoParaClassificar[],
  exemplosDaEmpresa: string
): Promise<Map<string, ClassificacaoEdital>> {
  const lista = candidatos
    .map(
      (c, i) =>
        `${i + 1}. [numeroControle: ${c.numeroControle}] ${c.titulo} — ${c.descricao}`.slice(0, 600)
    )
    .join("\n");

  const resposta = await askJSON<{ itens: RespostaItemIA[] }>(
    promptRelevancia(exemplosDaEmpresa),
    `Objeto social da empresa: ${objetoSocial}\n\nLicitações:\n${lista}`,
    { model: MODELO_HAIKU, maxTokens: 2000 }
  );

  const mapa = new Map<string, ClassificacaoEdital>();
  for (const item of resposta.itens ?? []) {
    if (!item?.numeroControle) continue;
    mapa.set(item.numeroControle, {
      relevante: !!item.relevante,
      tipoObjeto: normalizarTipo(item.tipoObjeto),
    });
  }
  return mapa;
}

/**
 * Classifica em lote os editais candidatos: relevância (a empresa de fato forneceria
 * aquele objeto?) e tipo (serviço x bem/insumo). Um modelo rápido e barato (Haiku),
 * em grupos processados em paralelo, para dar conta de ~100 candidatos por palavra-chave
 * sem estourar o tempo da requisição.
 *
 * Na dúvida, o edital é ENVIADO (relevante = true): a IA com dúvida, a falha de um grupo e o item que a IA
 * esqueceu de devolver caem todos nesse lado — perder uma oportunidade custa mais que olhar um edital a mais.
 *
 * Sem chave de IA, cai para a heurística por palavra-chave no tipo e considera tudo
 * relevante (a filtragem por palavra-chave já se aplicou antes).
 */
export async function classificarEditaisEmLote(
  objetoSocial: string,
  candidatos: CandidatoParaClassificar[]
): Promise<Map<string, ClassificacaoEdital>> {
  const resultado = new Map<string, ClassificacaoEdital>();
  if (candidatos.length === 0) return resultado;

  if (!isAIConfigured()) {
    for (const c of candidatos) {
      resultado.set(c.numeroControle, {
        relevante: true,
        tipoObjeto: classificarTipoObjeto(c.titulo, c.descricao),
      });
    }
    return resultado;
  }

  const exemplosDaEmpresa = await gerarExemplosDaEmpresa(objetoSocial);

  const grupos: CandidatoParaClassificar[][] = [];
  for (let i = 0; i < candidatos.length; i += TAMANHO_GRUPO) {
    grupos.push(candidatos.slice(i, i + TAMANHO_GRUPO));
  }

  const resultadosPorGrupo = await mapComLimite(grupos, LIMITE_GRUPOS_PARALELOS, (grupo) =>
    classificarGrupo(objetoSocial, grupo, exemplosDaEmpresa).catch((err) => {
      console.error("Falha ao classificar grupo de editais:", err);
      // Fallback do grupo: não descarta por relevância (não dá para avaliar), mas
      // ainda tenta o tipo pela heurística para o filtro de perfil funcionar.
      const fallback = new Map<string, ClassificacaoEdital>();
      for (const c of grupo) {
        fallback.set(c.numeroControle, {
          relevante: true,
          tipoObjeto: classificarTipoObjeto(c.titulo, c.descricao),
        });
      }
      return fallback;
    })
  );

  for (const mapaGrupo of resultadosPorGrupo) {
    for (const [k, v] of mapaGrupo) resultado.set(k, v);
  }

  // Garante que todo candidato tenha uma entrada, mesmo que a IA tenha pulado algum.
  for (const c of candidatos) {
    if (!resultado.has(c.numeroControle)) {
      resultado.set(c.numeroControle, {
        relevante: true,
        tipoObjeto: classificarTipoObjeto(c.titulo, c.descricao),
      });
    }
  }

  return resultado;
}
