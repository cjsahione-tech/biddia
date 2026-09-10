import { askJSON, isAIConfigured, MODELO_HAIKU } from "@/lib/anthropic";
import { classificarTipoObjeto, type TipoObjeto } from "@/lib/agents/classificador-objeto";

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
// confiável; vários grupos rodam em paralelo, então o custo em tempo é o do maior grupo.
const TAMANHO_GRUPO = 12;

function normalizarTipo(t: RespostaItemIA["tipoObjeto"]): TipoObjeto {
  if (t === "SERVICO" || t === "BEM" || t === "AMBOS") return t;
  return null;
}

async function classificarGrupo(
  objetoSocial: string,
  candidatos: CandidatoParaClassificar[]
): Promise<Map<string, ClassificacaoEdital>> {
  const lista = candidatos
    .map(
      (c, i) =>
        `${i + 1}. [numeroControle: ${c.numeroControle}] ${c.titulo} — ${c.descricao}`.slice(0, 600)
    )
    .join("\n");

  const resposta = await askJSON<{ itens: RespostaItemIA[] }>(
    `Você filtra e classifica licitações públicas para uma empresa participar. Para CADA licitação da lista,
avalie duas coisas. A pergunta-guia é sempre: "a EMPRESA descrita seria a CONTRATADA principal deste objeto?"

1. "relevante": true só se a empresa realista e diretamente seria a contratada daquele objeto específico —
   não basta ser da mesma área, e o SUBDOMÍNIO precisa bater. "Análises clínicas" = exames laboratoriais de
   pacientes (sangue, urina, microbiologia clínica, anatomia patológica, sorologia etc.); é coisa diferente de
   "análises de água / efluentes / ambientais", "análises de solo / asfalto / materiais de obra", "análises de
   alimentos" e "ensaios industriais (ISO 17025)". Um laboratório de análises clínicas NÃO é a contratada de um
   edital de análise de água, e vice-versa.
   Exemplos para um laboratório de análises clínicas (que PRESTA serviço de exames de pacientes):
   - "credenciamento de laboratório para realizar exames laboratoriais / análises clínicas dos pacientes do
     SUS" / "contratação de laboratório para exames de sangue e urina" → RELEVANTE
   - "aquisição de reagentes / insumos / kits laboratoriais", "comodato de equipamento com fornecimento de
     reagentes", "locação de equipamento de laboratório", "reforma do laboratório", "análises físico-químicas e
     microbiológicas de água tratada", "análise de solo/asfalto para obras" → NÃO RELEVANTE (a contratada seria
     uma distribuidora de reagentes, uma locadora de equipamento, uma construtora ou um laboratório ambiental —
     não um laboratório de análises clínicas de pacientes).

2. "tipoObjeto" — o que a contratada PRINCIPALMENTE entrega:
   - "SERVICO": prestação de serviço, mão de obra, execução, credenciamento de prestador, realização de exames/laudos
   - "BEM": fornecimento/aquisição/compra de produtos, insumos, reagentes, materiais ou equipamentos. IMPORTANTE:
     "aquisição de reagentes/insumos COM comodato de equipamento e manutenção" continua sendo BEM — o núcleo é o
     fornecimento; comodato e manutenção do próprio equipamento fornecido são acessórios.
   - "AMBOS": use APENAS quando fornecimento de bem E prestação de serviço são partes essenciais, vultosas e
     claramente separáveis do contrato (ex: fornecer equipamentos E operá-los com equipe própria dedicada). Na
     dúvida entre "AMBOS" e um tipo específico, escolha SEMPRE o tipo dominante.
   - "INDEFINIDO": não dá para saber pelo texto.

Responda em JSON, um item por licitação, na mesma ordem:
{ "itens": [ { "numeroControle": string (copie exatamente o valor entre colchetes), "relevante": boolean, "tipoObjeto": "SERVICO" | "BEM" | "AMBOS" | "INDEFINIDO" } ] }`,
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

  const grupos: CandidatoParaClassificar[][] = [];
  for (let i = 0; i < candidatos.length; i += TAMANHO_GRUPO) {
    grupos.push(candidatos.slice(i, i + TAMANHO_GRUPO));
  }

  const resultadosPorGrupo = await Promise.all(
    grupos.map((grupo) =>
      classificarGrupo(objetoSocial, grupo).catch((err) => {
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
    )
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
