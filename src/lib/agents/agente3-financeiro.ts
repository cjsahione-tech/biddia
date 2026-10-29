import { prisma } from "@/lib/prisma";
import { askJSON, MODELO_HAIKU, MODELO_SONNET } from "@/lib/anthropic";
import { obterTextoCompletoEdital } from "@/lib/agents/pdf-extract";
import { withAgentRun, logAudit } from "@/lib/agents/run-tracker";
import { buscarItensCompra, parseNumeroControlePNCP } from "@/lib/agents/pncp";
import { CAMPOS_EXTRAS_CATALOGO, chaveCampoExtraValida, parseItens, type ChaveCampoExtra, type LoteMeta } from "@/lib/proposal";
import { acharLacunasDeNumeracao, blocosSuspeitos, conferirLinhas, pontuarDefeitos } from "@/lib/agents/financeiro-conferencia";
import { aplicarRevisaoConjunto, promptRevisaoConjunto, type RevisaoConjunto } from "@/lib/agents/financeiro-revisao";
import { preservarEdicoesManuais } from "@/lib/agents/financeiro-edicoes";
import { comRegrasComuns } from "@/lib/agents/regras-comuns";

// Quanto de saída reservar na chamada de IA, em função de quantos itens se espera —
// reservar 16k tokens para um edital de 20 itens só fazia a chamada disputar cota de
// tokens/minuto à toa e demorar mais. ~70 tokens por item + folga.
function maxTokensParaItens(qtdItens: number, teto = 16_000): number {
  return Math.min(teto, Math.max(3_000, Math.round(qtdItens * 70 + 2_000)));
}

type ItemProposta = {
  numero?: number | null;
  descricao: string;
  unidade: string;
  quantidade: number;
  valorUnitario: number;
  lote?: string | null;
  camposExtras?: Partial<Record<ChaveCampoExtra, number | string>>;
  // Só para a conferência (não vão para o banco): o total da linha como o edital imprime, e de qual trecho veio.
  valorTotalLinha?: number | null;
  bloco?: number;
  // true quando o preço veio de uma sugestão de mercado pedida pelo usuário (não do edital).
  precoSugerido?: boolean;
};

type FinanceiroResult = {
  itensEncontradosNoTexto: boolean;
  itens: ItemProposta[];
  observacoes: string;
};

// A revisão devolve só o que está ERRADO (um "diff"), não a lista inteira de novo —
// resposta muito menor, muito mais rápida, e sem risco de a revisão truncar a lista.
type RevisaoDiff = {
  correcoes: {
    indice: number;
    descricao?: string;
    unidade?: string;
    quantidade?: number;
    valorUnitario?: number;
    numero?: number;
    lote?: string;
    camposExtras?: Partial<Record<ChaveCampoExtra, number | string>>;
  }[];
  itensFaltantes: ItemProposta[];
  indicesParaRemover: number[];
};

// Palavras-chave usadas para não perder a tabela de itens/preços quando o texto do
// edital/TR é grande demais para caber inteiro — ela quase nunca está nas primeiras
// páginas (normalmente vem em anexo, depois de todo o texto legal introdutório).
// De propósito, evita termos soltos comuns em qualquer cláusula genérica ("item",
// "unidade") — o que denuncia uma tabela de verdade é a CONCENTRAÇÃO de vários termos
// específicos de preço/quantidade num mesmo trecho, não uma palavra comum ocorrendo
// espalhada pelo documento inteiro.
const PALAVRAS_CHAVE_FINANCEIRO = [
  "quantidade estimada",
  "quant.",
  "qtd",
  "unid.",
  "valor unitário",
  "valor unit",
  "preço unitário",
  "preço unit",
  "valor total estimado",
  "preço total",
  "planilha de preços",
  "planilha orçamentária",
  "orçamento estimado",
  "tabela de preços",
  "composição de custos",
  "cotação de preços",
  "estimativa de preços",
  "mapa de preços",
  "especificação do objeto",
  "descrição do item",
  "lote",
  "grupo",
];

const INSTRUCAO_FORMATO_NUMERICO = `Atenção ao formato numérico brasileiro no texto-fonte: ponto separa milhar e
vírgula separa decimal (ex: "1.234,56" = mil duzentos e trinta e quatro reais e cinquenta e seis centavos, ou seja
1234.56). Não confunda separador de milhar com separador decimal. Na resposta, use sempre notação decimal simples
(ponto, sem separador de milhar): 1234.56, nunca "1.234,56" nem "1234,56".`;

// Teto de caracteres bem maior que o padrão (MAX_CHARS_POR_DOCUMENTO, 35 mil, pensado
// pra uma chamada única) — o Financeiro processa o texto em blocos de 5000 caracteres em
// paralelo, então aguenta um documento bem maior sem custo/latência proibitivos. Editais
// de dezenas/centenas de páginas frequentemente têm a tabela de itens espalhada por um
// trecho maior que 35 mil caracteres; cortar antes de dividir em blocos descartava a
// maior parte da tabela antes mesmo da extração começar — a causa raiz de propostas
// vindo com só uma fração dos itens reais mesmo em editais grandes.
const MAX_CHARS_FINANCEIRO = 220_000;

/**
 * Estimativa grosseira de quantas linhas de tabela de itens/preços existem no
 * texto-fonte — conta trechos com dois valores em R$ próximos um do outro (o padrão
 * "... R$ valor_unitário ... R$ valor_total" de cada linha de uma planilha de preços).
 * Não é uma contagem exata (cabeçalho de página repetido, por exemplo, pode inflar um
 * pouco), mas é o suficiente para (a) flagrar quando o modelo devolveu uma lista bem
 * menor do que a tabela real tem, e (b) decidir se vale a pena dividir a extração em
 * blocos (ver mais abaixo).
 */
function estimarQuantidadeDeItens(texto: string): number {
  return texto.match(/R\$\s*[\d.,]+[^\n]{0,40}?R\$\s*[\d.,]+/g)?.length ?? 0;
}

/** Divide um texto em blocos de até `tamanhoAlvo` caracteres, sem cortar no meio de uma linha. */
function dividirEmBlocosPorLinha(texto: string, tamanhoAlvo: number): string[] {
  if (texto.length <= tamanhoAlvo) return [texto];
  const blocos: string[] = [];
  let inicio = 0;
  while (inicio < texto.length) {
    let fim = Math.min(texto.length, inicio + tamanhoAlvo);
    if (fim < texto.length) {
      const quebra = texto.lastIndexOf("\n", fim);
      if (quebra > inicio) fim = quebra + 1;
    }
    blocos.push(texto.slice(inicio, fim));
    inicio = fim;
  }
  return blocos;
}

// Um trecho de até este tamanho ainda cabe numa única chamada sem o modelo começar a
// "resumir" em vez de transcrever — é o que faz cada bloco (mesmo tabelas pequenas, que
// viram um bloco só) ser tratado com o mesmo cuidado que uma tabela de 200 itens.
const TAMANHO_BLOCO_ITENS = 5_000;

const LISTA_CAMPOS_EXTRAS_CATALOGO = Object.entries(CAMPOS_EXTRAS_CATALOGO)
  .map(([chave, def]) => `"${chave}" (${def.label})`)
  .join(", ");

function montarPromptBloco(indice: number, total: number, reforco?: string, estrutura?: string): string {
  return comRegrasComuns(`FUNÇÃO
Você é o extrator de itens da proposta de preços do Bidd.IA. Você recebe APENAS UM TRECHO (trecho ${indice + 1} de ${total}) de uma
tabela de itens de um edital público brasileiro e devolve TODOS os itens de compra ou serviço que aparecem NESTE TRECHO, um por um,
exatamente como estão escritos (mesmo que a tabela continue antes ou depois dele). Você NÃO calcula, NÃO estima e NÃO sugere preços.
É OBRIGATÓRIO não pular nenhum item do trecho, por mais numeroso ou repetitivo que pareça: isso é transcrição literal linha por
linha, não um resumo. Faltar um item é um erro grave para quem vai usar esta proposta.

PASSO A PASSO
1. Procure as linhas de itens: número do item, descrição, unidade, quantidade e valores. Tabelas de texto podem aparecer
   "quebradas" (cada célula em uma linha): reconstrua cada item juntando as células da mesma linha.
2. Lote: se o trecho tiver um cabeçalho "LOTE X" ou "GRUPO X" antes de uma sequência de itens, preencha "lote" com essa
   identificação em TODOS os itens da sequência, até o próximo cabeçalho. Sem estrutura de lote neste edital, "lote" é null.
   Preencha "numero" com o número do item como aparece na tabela (ex: "Item 3" → 3), ou null se não houver numeração clara.
3. Colunas extras: se a tabela tiver uma coluna que bata com uma destas (e SOMENTE estas — nunca invente outra chave):
   ${LISTA_CAMPOS_EXTRAS_CATALOGO}, preencha "camposExtras" com essas chaves. Colunas que não batem com nenhuma são ignoradas.
4. "valorTotalLinha" é o valor TOTAL do item como está IMPRESSO na própria linha (coluna de valor total/global), copiado
   literalmente — NÃO calcule: se a tabela não tiver essa coluna, use null. Ele serve para conferir depois se quantidade × valor
   unitário fecha.
5. SEM PREÇO NO TEXTO = PREÇO VAZIO: se o edital não traz valor unitário, "valorUnitario" é null. É PROIBIDO sugerir, estimar ou pesquisar preço.
6. Não repita: o mesmo item aparecendo duas vezes no trecho (cabeçalho repetido em outra página) é devolvido uma vez.
7. Não é item: linha de total geral, subtotal, cabeçalho, rodapé, nem condição do edital ("prazo de entrega: 10 dias").
8. Não some, não multiplique, não corrija: se quantidade × unitário não bate com o total do texto, devolva os três como estão escritos.
9. Sem tabela neste trecho = "itens": []. Nunca crie itens para "preencher".
${estrutura ? `
ESTRUTURA DA TABELA (cabeçalho lido no início da tabela, vale para todos os trechos — use-o para saber qual coluna é qual, mesmo que este trecho não mostre o cabeçalho):
${estrutura}
` : ""}
${INSTRUCAO_FORMATO_NUMERICO}
${reforco ?? ""}

FORMATO DE SAÍDA (JSON)
{ "itens": [ { "numero": number | null, "descricao": string, "unidade": string, "quantidade": number, "valorUnitario": number | null,
"valorTotalLinha": number | null, "lote": string | null, "camposExtras"?: object } ] }

CONFERÊNCIA FINAL
- Todo item devolvido existe, com esse número e esta descrição, neste trecho?
- Nenhum preço foi inventado, estimado ou sugerido?
- Nenhum subtotal, total geral, cabeçalho ou condição do edital virou item?
- Itens repetidos foram unificados?
- O JSON é válido e sem texto em volta?`);
}

/**
 * Extrai os itens de UM trecho da tabela. Cada bloco se autocorrige: se o próprio
 * trecho parece conter mais linhas de tabela (pela contagem grosseira de "R$ ... R$")
 * do que vieram na resposta, escala para o Sonnet apontando o total esperado — só
 * para esse bloco, sem pagar o custo de refazer a tabela inteira num modelo mais lento.
 */
async function extrairBlocoDeItens(
  bloco: string,
  indice: number,
  total: number,
  cabecalho: string,
  estrutura?: string
): Promise<ItemProposta[]> {
  const contexto = `${cabecalho}\n\n=== TRECHO ${indice + 1} DE ${total} DA TABELA DE ITENS ===\n${bloco}`;
  const itensEsperadosBloco = estimarQuantidadeDeItens(bloco);

  let itens: ItemProposta[] = [];
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    try {
      // Bloco pequeno e delimitado — Haiku transcreve com fidelidade, é bem mais
      // rápido, e não consome a cota de Sonnet (que fica reservada para a escalada).
      const resultado = await askJSON<{ itens: ItemProposta[] }>(montarPromptBloco(indice, total, undefined, estrutura), contexto, {
        model: MODELO_HAIKU,
        maxTokens: 8000,
      });
      itens = resultado.itens ?? [];
      break;
    } catch (err) {
      console.error(`[agente3-financeiro] falha ao extrair bloco ${indice + 1}/${total} (tentativa ${tentativa + 1}):`, err);
    }
  }

  if (itensEsperadosBloco > 3 && itens.length < itensEsperadosBloco * 0.85) {
    console.warn(
      `[agente3-financeiro] bloco ${indice + 1}/${total}: só ${itens.length} de ~${itensEsperadosBloco} itens esperados — escalando para Sonnet.`
    );
    try {
      const reforcado = await askJSON<{ itens: ItemProposta[] }>(
        montarPromptBloco(
          indice,
          total,
          `\nATENÇÃO: este trecho parece conter aproximadamente ${itensEsperadosBloco} itens (cada linha com dois
valores em R$ é um item), mas uma tentativa anterior encontrou só ${itens.length}. Releia com atenção do início ao
fim deste trecho e devolva a lista COMPLETA — não pare antes do fim.`,
          estrutura
        ),
        contexto,
        { model: MODELO_SONNET, maxTokens: maxTokensParaItens(itensEsperadosBloco) }
      );
      if ((reforcado.itens?.length ?? 0) > itens.length) itens = reforcado.itens;
    } catch (err) {
      console.error(`[agente3-financeiro] falha na escalada do bloco ${indice + 1}/${total}:`, err);
    }
  }

  return itens.map((it) => ({ ...it, bloco: indice }));
}

/**
 * Blocos são extraídos em paralelo, sem contexto uns dos outros — se um cabeçalho
 * "LOTE X" cair num bloco e os itens daquele lote continuarem no bloco seguinte, o
 * segundo bloco não tem como saber em que lote está. Corrige isso depois de juntar
 * todos os blocos, na ordem original: item sem lote herda o último lote visto na
 * sequência (mesma lógica de uma tabela de verdade — vale até o próximo cabeçalho).
 */
function preencherLotePorArrastamento(itens: ItemProposta[]): ItemProposta[] {
  let loteAtual: string | null = null;
  return itens.map((item) => {
    if (item.lote) {
      loteAtual = item.lote;
      return item;
    }
    return loteAtual ? { ...item, lote: loteAtual } : item;
  });
}

/**
 * Classificação rápida e separada (não contamina o prompt de transcrição item a item):
 * quais colunas do catálogo fechado (ver CAMPOS_EXTRAS_CATALOGO) a tabela deste edital
 * usa, se alguma. Roda uma vez só sobre o início da área financeira, onde o cabeçalho da
 * tabela normalmente aparece.
 */
async function detectarColunasExtras(areaFinanceira: string): Promise<{ colunas: ChaveCampoExtra[]; cabecalho: string | null }> {
  if (!areaFinanceira.trim()) return { colunas: [], cabecalho: null };
  const trecho = areaFinanceira.slice(0, 20_000);
  try {
    const resultado = await askJSON<{ colunas: string[]; cabecalho?: string | null }>(
      `Você está olhando um trecho de edital público brasileiro com uma tabela de itens/preços. Faça duas coisas:
1. Diga quais destas colunas, SE ALGUMA, a tabela realmente usa (procure pelo cabeçalho da tabela): ${LISTA_CAMPOS_EXTRAS_CATALOGO}.
Não force encaixe — se a tabela não tiver nenhuma dessas colunas, devolva uma lista vazia.
2. Copie LITERALMENTE a linha de cabeçalho da tabela de itens (os nomes das colunas na ordem em que aparecem, ex:
"Item | Descrição | Unid. | Quant. | Valor unitário | Valor total"), exatamente como está no texto. Se não houver um
cabeçalho claro, use null. Não invente nem reescreva.

Responda em JSON: { "colunas": string[], "cabecalho": string | null } — "colunas" usa exatamente as chaves entre aspas listadas acima.`,
      trecho,
      { model: MODELO_HAIKU, maxTokens: 400 }
    );
    // Só vale o cabeçalho que realmente existe no texto (a IA não pode inventar um que não está lá).
    const normaliza = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
    const cab = resultado.cabecalho?.trim();
    const cabecalho = cab && cab.length >= 8 && cab.length <= 400 && normaliza(trecho).includes(normaliza(cab)) ? cab : null;
    return { colunas: (resultado.colunas ?? []).filter(chaveCampoExtraValida), cabecalho };
  } catch (err) {
    console.error("Falha ao detectar colunas extras da tabela de itens:", err);
    return { colunas: [], cabecalho: null };
  }
}

// Segunda leitura, cuidadosa, SÓ dos trechos onde a conferência achou defeito (linha que não fecha, item que falta
// na sequência). Usa o modelo mais forte com raciocínio estendido e recebe a lista exata do que está errado. O
// resultado só entra se REDUZIR os defeitos da planilha — nunca troca um resultado por outro à toa.
const ORCAMENTO_PENSAR_TOKENS = 3_000;
const MAX_BLOCOS_RELIDOS = 6;
const MIN_MS_PARA_RELER = 14_000;

type ResultadoReleitura = { itens: ItemProposta[]; blocosRelidos: number; defeitosAntes: number; defeitosDepois: number; interrompido: boolean };

export async function relerBlocosSuspeitos(args: {
  itens: ItemProposta[];
  blocosTexto: string[];
  cabecalho: string;
  estrutura?: string;
  /** Instante (ms desde 1970) em que a releitura precisa estar encerrada. */
  limite: number;
}): Promise<ResultadoReleitura> {
  let atual = args.itens;
  const defeitosAntes = pontuarDefeitos(atual);
  const semMudanca: ResultadoReleitura = { itens: atual, blocosRelidos: 0, defeitosAntes, defeitosDepois: defeitosAntes, interrompido: false };
  if (defeitosAntes === 0 || args.blocosTexto.length === 0) return semMudanca;
  if (args.limite - Date.now() < MIN_MS_PARA_RELER) return { ...semMudanca, interrompido: true };

  const problemas = conferirLinhas(atual);
  const lacunas = acharLacunasDeNumeracao(atual);
  const suspeitos = blocosSuspeitos(atual, problemas, lacunas)
    .filter((b) => b >= 0 && b < args.blocosTexto.length)
    .slice(0, MAX_BLOCOS_RELIDOS);
  if (suspeitos.length === 0) return semMudanca;

  // O que está errado em cada trecho, dito com precisão para o modelo saber onde olhar.
  const suspeitasDoBloco = (b: number): string[] => {
    const linhas: string[] = [];
    for (const p of problemas) {
      const it = atual[p.indice];
      if (it?.bloco !== b) continue;
      const nome = `${it.numero != null ? `item ${it.numero}` : "um item"} ("${it.descricao.slice(0, 60)}")`;
      if (p.tipo === "TOTAL_NAO_BATE") {
        linhas.push(
          `${nome}: li quantidade ${it.quantidade} e valor unitário ${it.valorUnitario} (= ${p.calculado}), mas o total impresso na linha é ${p.impresso}. Alguma coluna foi lida errada (quantidade, unidade de medida, unitário ou total) ou o número foi lido com separador errado.`
        );
      } else {
        linhas.push(`${nome}: quantidade ou valor lido é inválido (quantidade ${it.quantidade}, unitário ${it.valorUnitario}).`);
      }
    }
    for (const l of lacunas) {
      if (l.blocos.includes(b)) linhas.push(`Na sequência de numeração${l.lote ? ` do lote ${l.lote}` : ""} faltam os itens de número ${l.faltando.join(", ")} — procure por eles neste trecho (podem não estar aqui, e então não invente).`);
    }
    return linhas;
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, args.limite - Date.now()));
  let interrompido = false;
  try {
    const relidos = await Promise.all(
      suspeitos.map(async (b) => {
        const anteriores = atual
          .filter((it) => it.bloco === b)
          .map((it) => `- item ${it.numero ?? "?"} | ${it.descricao} | ${it.unidade} | qtd ${it.quantidade} | unit ${it.valorUnitario} | total impresso ${it.valorTotalLinha ?? "-"} | lote ${it.lote ?? "-"}`)
          .join("\n");
        try {
          const r = await askJSON<{ itens: ItemProposta[] }>(
            `${montarPromptBloco(b, args.blocosTexto.length, undefined, args.estrutura)}

RELEITURA CUIDADOSA: uma conferência automática achou defeitos na leitura anterior DESTE trecho. Antes de responder,
raciocine coluna por coluna: identifique qual coluna é qual (use o cabeçalho), releia cada linha com problema e confira
que quantidade × valor unitário dá o total impresso. Devolva a lista COMPLETA e corrigida de TODOS os itens deste
trecho (não só dos que tinham defeito).

O que a conferência achou neste trecho:
${suspeitasDoBloco(b).map((s) => `* ${s}`).join("\n")}

Leitura anterior deste trecho (pode conter os erros acima):
${anteriores || "(nenhum item foi lido neste trecho)"}`,
            `${args.cabecalho}\n\n=== TRECHO ${b + 1} DE ${args.blocosTexto.length} DA TABELA DE ITENS ===\n${args.blocosTexto[b]}`,
            {
              model: MODELO_SONNET,
              maxTokens: maxTokensParaItens(Math.max(estimarQuantidadeDeItens(args.blocosTexto[b]), 8), 8_000),
              pensar: ORCAMENTO_PENSAR_TOKENS,
              sinal: controller.signal,
            }
          );
          return { b, itens: (r.itens ?? []).map((it) => ({ ...it, bloco: b })) };
        } catch (err) {
          if (controller.signal.aborted) interrompido = true;
          console.error(`[agente3-financeiro] falha na releitura do trecho ${b + 1}/${args.blocosTexto.length}:`, err);
          return { b, itens: null as ItemProposta[] | null };
        }
      })
    );

    // Aplica um trecho por vez e só fica com a troca se os defeitos da planilha inteira diminuírem.
    for (const { b, itens: novos } of relidos) {
      if (!novos || novos.length === 0) continue;
      // Tira os itens antigos do trecho e põe os novos na posição certa (antes do primeiro item de um trecho
      // posterior), para a ordem da tabela e a herança de lote continuarem corretas.
      const semB = atual.filter((it) => it.bloco !== b);
      const posicao = semB.findIndex((it) => (it.bloco ?? Number.POSITIVE_INFINITY) > b);
      const corte = posicao === -1 ? semB.length : posicao;
      const candidato = preencherLotePorArrastamento([...semB.slice(0, corte), ...novos, ...semB.slice(corte)]);
      if (pontuarDefeitos(candidato) < pontuarDefeitos(atual)) atual = candidato;
    }
  } finally {
    clearTimeout(timer);
  }

  const final = deduplicarItens(atual);
  return { itens: final, blocosRelidos: suspeitos.length, defeitosAntes, defeitosDepois: pontuarDefeitos(final), interrompido };
}

/**
 * Conferência complementar (não substitui a extração por texto) contra a API de itens
 * estruturados do PNCP — só preenche quantidade/valorUnitario quando o item da IA está
 * com o campo ausente/zerado, casando por número do item; nunca sobrescreve um valor já
 * lido com confiança do texto. Best-effort: qualquer falha (rede, edital sem
 * numeroControlePNCP parseável, item sem match) é silenciosa, não derruba a extração.
 * O PNCP não tem campo de lote/grupo por item — essa conferência nunca toca em "lote".
 */
async function conferirComPncp(
  edital: { fonte: string; numeroControlePNCP: string },
  itens: ItemProposta[]
): Promise<ItemProposta[]> {
  if (edital.fonte !== "PNCP") return itens;
  const ids = parseNumeroControlePNCP(edital.numeroControlePNCP);
  if (!ids) return itens;
  // O numeroItem do PNCP é uma sequência única pra toda a compra, sem noção de lote —
  // em edital com lote, o "item 1" do texto costuma reiniciar a numeração a cada lote
  // (Lote 1: itens 1,2,3... Lote 2: itens 1,2,3... de novo). Casar só por número nesse
  // caso pegaria o item errado (de outro lote) e injetaria quantidade/valor incorretos
  // sem aviso nenhum — mais seguro pular a conferência inteira do que arriscar isso.
  if (itens.some((it) => it.lote)) return itens;

  try {
    const itensPncp = await buscarItensCompra(ids.cnpj, ids.ano, ids.sequencial);
    const porNumero = new Map(itensPncp.map((i) => [i.numeroItem, i]));
    return itens.map((item) => {
      if (item.numero == null) return item;
      const ref = porNumero.get(item.numero);
      if (!ref) return item;
      const semQuantidade = item.quantidade == null || Number.isNaN(item.quantidade) || item.quantidade === 0;
      const semValor = item.valorUnitario == null || Number.isNaN(item.valorUnitario) || item.valorUnitario === 0;
      if (!semQuantidade && !semValor) return item;
      return {
        ...item,
        quantidade: semQuantidade ? ref.quantidade : item.quantidade,
        valorUnitario: semValor && ref.valorUnitarioEstimado != null ? ref.valorUnitarioEstimado : item.valorUnitario,
      };
    });
  } catch (err) {
    console.error(`Falha na conferência de itens com o PNCP (edital ${edital.numeroControlePNCP}):`, err);
    return itens;
  }
}

/** Agrupa os itens finais por lote, somando o valorTotal de cada grupo como referência
 * — null (sem lote) não vira um "grupo" no resultado, é só o caso comum de hoje. */
function montarLotes(itens: { lote?: string | null; valorTotal: number }[]): LoteMeta[] {
  const porLote = new Map<string, number>();
  for (const item of itens) {
    if (!item.lote) continue;
    porLote.set(item.lote, (porLote.get(item.lote) ?? 0) + item.valorTotal);
  }
  return Array.from(porLote.entries()).map(([numero, valorReferencia]) => ({
    numero,
    descricao: `Lote ${numero}`,
    valorReferencia,
  }));
}

/**
 * Editais grandes às vezes citam a mesma relação de itens duas vezes no documento (ex:
 * uma vez na planilha de preços de verdade, outra num anexo/especificação que só lista
 * os nomes sem valor) — como agora o texto-fonte não é mais cortado antes de dividir em
 * blocos (ver MAX_CHARS_FINANCEIRO), os dois trechos podem virar itens duplicados.
 * Agrupa por lote+descrição (não só descrição — o mesmo nome de item pode aparecer em
 * lotes diferentes de verdade) e mantém a versão com preço válido quando há duplicata.
 */
function deduplicarItens(itens: ItemProposta[]): ItemProposta[] {
  const porChave = new Map<string, ItemProposta>();
  for (const item of itens) {
    const chave = `${item.lote ?? ""}::${item.descricao.trim().toLowerCase()}`;
    const existente = porChave.get(chave);
    if (!existente) {
      porChave.set(chave, item);
      continue;
    }
    const existenteTemPreco = existente.valorUnitario != null && existente.valorUnitario > 0;
    const novoTemPreco = item.valorUnitario != null && item.valorUnitario > 0;
    if (!existenteTemPreco && novoTemPreco) porChave.set(chave, item);
  }
  return Array.from(porChave.values());
}

/**
 * Alguns editais (comum em registro de preços) publicam só descrição/unidade/quantidade
 * na tabela — sem valor unitário de referência, porque é a própria empresa licitante que
 * propõe o preço. Sem tratar isso, o item fica com valorUnitario nulo/zero e a "proposta"
 * sai toda R$ 0,00, o que é enganoso. Quando a maioria dos itens está nessa situação,
 * pede uma estimativa de preço de mercado plausível para preencher a lacuna.
 */
export async function preencherPrecosFaltantes(
  edital: { titulo: string; descricao: string },
  itens: ItemProposta[]
): Promise<{ itens: ItemProposta[]; qtdEstimados: number }> {
  const semPreco = itens
    .map((it, i) => ({ it, i }))
    .filter(({ it }) => it.valorUnitario == null || Number.isNaN(it.valorUnitario) || it.valorUnitario === 0);
  if (semPreco.length === 0) return { itens, qtdEstimados: 0 };

  // Em lotes de 60 itens, em paralelo: uma resposta única com centenas de preços passava do limite de tamanho, era
  // cortada, e a falha silenciosa deixava a proposta inteira em R$ 0,00. Se um lote falhar, só os itens dele ficam sem preço.
  const TAMANHO_LOTE_PRECOS = 60;
  const lotes: typeof semPreco[] = [];
  for (let k = 0; k < semPreco.length; k += TAMANHO_LOTE_PRECOS) lotes.push(semPreco.slice(k, k + TAMANHO_LOTE_PRECOS));

  const mapa = new Map<number, number>();
  await Promise.all(
    lotes.map(async (lote) => {
      const lista = lote.map(({ it, i }) => `[${i}] ${it.descricao} | ${it.unidade} | qtd ${it.quantidade}`).join("\n");
      try {
        const resultado = await sugerirPrecosDoLote(edital, lista, lote.length);
        for (const p of resultado.precos ?? []) {
          if (typeof p.indice === "number" && typeof p.valorUnitario === "number" && p.valorUnitario > 0) mapa.set(p.indice, p.valorUnitario);
        }
      } catch (err) {
        console.error(`Falha ao estimar preços de mercado de ${lote.length} item(ns) sem valor unitário publicado:`, err);
      }
    })
  );
  const preenchidos = itens.map((it, i) => (mapa.has(i) ? { ...it, valorUnitario: mapa.get(i)!, precoSugerido: true } : it));
  return { itens: preenchidos, qtdEstimados: mapa.size };
}

async function sugerirPrecosDoLote(
  edital: { titulo: string; descricao: string },
  lista: string,
  qtdItens: number
): Promise<{ precos: { indice: number; valorUnitario: number }[] }> {
  return askJSON<{ precos: { indice: number; valorUnitario: number }[] }>(
      `Você é o agente financeiro de uma empresa respondendo a uma licitação pública brasileira. O edital publicou a
lista de itens e quantidades estimadas, mas NÃO publicou valores unitários de referência para eles — é a própria
empresa licitante que precisa propor um preço competitivo por item, dentro da realidade de mercado brasileira atual.

Objeto da licitação: ${edital.titulo} — ${edital.descricao}

Para cada item abaixo, sugira um valor unitário em reais plausível e competitivo, coerente com o que empresas do
ramo cobrariam por um item/serviço equivalente no Brasil hoje.

${INSTRUCAO_FORMATO_NUMERICO}

Responda em JSON: { "precos": [{ "indice": number, "valorUnitario": number }] }`,
      lista,
      { model: MODELO_SONNET, maxTokens: maxTokensParaItens(qtdItens, 8_000) }
    );
}

export async function executarAgente3(editalId: string) {
  return withAgentRun(editalId, "agente3-financeiro", async () => {
    const edital = await prisma.edital.findUniqueOrThrow({ where: { id: editalId } });

    const valorReferencia = edital.valorGlobal;
    if (!valorReferencia) {
      await logAudit(
        editalId,
        "Agente Financeiro",
        "Busca de tabela de referência",
        "ALERTA",
        "O PNCP não publicou valor total estimado para este edital. A proposta foi montada sem uma base de valor de referência confirmada.",
      );
    }

    const { textoEdital, textoTermoReferencia, textoAnexosPrecos, temTextoCompleto } =
      await obterTextoCompletoEdital(editalId, {
        palavrasChave: PALAVRAS_CHAVE_FINANCEIRO,
        tamanhoMax: MAX_CHARS_FINANCEIRO,
      });

    const areaFinanceira = [textoAnexosPrecos, textoTermoReferencia, textoEdital].filter(Boolean).join("\n");
    const itensEsperados = estimarQuantidadeDeItens(areaFinanceira);

    // Prazo da execução (a função da Vercel morre em 60s; o pipeline desiste em ~52s): a releitura cuidadosa só
    // roda se ainda houver tempo, e é interrompida antes de estourar.
    const inicioMs = Date.now();
    const LIMITE_RELEITURA_MS = inicioMs + 46_000;

    let result: FinanceiroResult;
    let colunasExtras: ChaveCampoExtra[] = [];
    let blocosTexto: string[] = [];
    let estruturaTabela: string | undefined;
    const cabecalhoEdital = `Objeto: ${edital.titulo}\nDescrição: ${edital.descricao}`;

    if (temTextoCompleto) {
      // SEMPRE divide em blocos e extrai em paralelo — mesmo uma tabela pequena vira
      // "1 bloco", mas passa pelo mesmo prompt insistente e pela mesma autocorreção que
      // uma tabela de 200 itens. Isso existe porque uma chamada única sobre a tabela
      // inteira, em vez de blocos delimitados, era exatamente onde o modelo às vezes
      // "resumia" no meio de uma lista de tamanho médio em vez de transcrever tudo.
      const cabecalho = cabecalhoEdital;
      const blocos = dividirEmBlocosPorLinha(areaFinanceira, TAMANHO_BLOCO_ITENS);
      blocosTexto = blocos;
      console.log(`[agente3-financeiro] edital ${editalId}: ~${itensEsperados} itens estimados — extraindo em ${blocos.length} bloco(s).`);

      // Primeiro "olha" a tabela (cabeçalho e colunas) e só depois lê os trechos, passando o cabeçalho para cada um:
      // um trecho do meio da tabela não mostra o cabeçalho e, sem ele, a IA chuta qual coluna é qual.
      const estrutura = await detectarColunasExtras(areaFinanceira);
      colunasExtras = estrutura.colunas;
      estruturaTabela = estrutura.cabecalho ?? undefined;
      const itensPorBloco = await Promise.all(
        blocos.map((bloco, i) => extrairBlocoDeItens(bloco, i, blocos.length, cabecalho, estruturaTabela))
      );
      const itens = deduplicarItens(preencherLotePorArrastamento(itensPorBloco.flat()));

      // Edital que publica a tabela sem coluna de preço (comum em registro de preços): o preço fica VAZIO, como no
      // edital. A Bidd.IA não inventa preço sozinha — a sugestão de preço de mercado é opcional, pedida pelo usuário
      // (botão "Sugerir preços de mercado" na aba Financeiro) e marcada como sugestão.
      const semPreco = itens.filter((i) => i.valorUnitario == null || i.valorUnitario === 0).length;
      const avisoPreco =
        semPreco > 0
          ? ` O edital não publicou valor unitário de referência para ${semPreco} item(ns) — eles ficaram sem preço. Preencha na tela ou, se quiser, peça a sugestão de preços de mercado (ela é só uma sugestão, não vem do edital).`
          : "";

      result = {
        itensEncontradosNoTexto: itens.length > 0,
        itens,
        observacoes:
          itens.length > 0
            ? `Tabela de itens transcrita do texto do edital${blocos.length > 1 ? ` (extraída em ${blocos.length} trechos)` : ""}. Revise antes do envio.${avisoPreco}`
            : "Li o texto do edital, mas não encontrei tabela de itens e preços. Se a tabela está em algum anexo ou página específica, diga no chat do Agente Financeiro quais são as páginas, ou importe a sua planilha.",
      };
    } else {
      // Sem o texto do edital não há como saber a lista real: a proposta fica SEM itens, nunca com uma "composição
      // plausível" inventada.
      result = {
        itensEncontradosNoTexto: false,
        itens: [],
        observacoes:
          "Não consegui ler o texto deste edital, então não montei a lista de itens (a Bidd.IA não inventa itens). Quando os arquivos do edital estiverem disponíveis, o Agente Financeiro tenta de novo; você também pode importar a sua planilha.",
      };
    }

    // Segunda passada de revisão: a IA só APONTA problemas da lista extraída (item que não é item, duplicado, lote
    // errado, número suspeito) — nunca acrescenta item nem muda preço ou quantidade. Os números são conferidos pela
    // aritmética (adiante), não pela opinião de um revisor.
    let itensFinais = result.itens;
    let observacoesFinais = result.observacoes;
    const LIMITE_ITENS_PARA_REVISAO = 300;
    if (result.itensEncontradosNoTexto && result.itens.length > 0 && result.itens.length <= LIMITE_ITENS_PARA_REVISAO) {
      try {
        const listaIndexada = result.itens
          .map((it, i) => `[${i}] ${it.descricao} | ${it.unidade} | qtd ${it.quantidade} | unit ${it.valorUnitario} | total impresso ${it.valorTotalLinha ?? "-"} | lote ${it.lote ?? "-"}`)
          .join("\n");

        const diff = await askJSON<RevisaoConjunto>(
          promptRevisaoConjunto(result.itens.length),
          `=== TEXTO-FONTE ===\n${textoAnexosPrecos ?? ""}\n${textoTermoReferencia ?? ""}\n${textoEdital ?? ""}\n\n=== LISTA EXTRAÍDA (${result.itens.length} itens) ===\n${listaIndexada}`,
          // Conferência mecânica e resposta pequena (só o diff) — Haiku dá conta e é rápido.
          { model: MODELO_HAIKU, maxTokens: 4_000 }
        );

        const aplicada = aplicarRevisaoConjunto(result.itens, diff);
        itensFinais = aplicada.itens;
        if (aplicada.conferirManualmente.length > 0) {
          console.log(`[agente3-financeiro] edital ${editalId}: revisão apontou ${aplicada.conferirManualmente.length} item(ns) com número suspeito.`);
        }
        const partes: string[] = [];
        if (aplicada.removidos > 0) partes.push(`${aplicada.removidos} item(ns) que não eram itens (ou repetidos) removido(s)`);
        if (aplicada.lotesCorrigidos > 0) partes.push(`${aplicada.lotesCorrigidos} lote(s) corrigido(s)`);
        if (partes.length > 0) observacoesFinais = `${result.observacoes}\n\nRevisão automática: ${partes.join(", ")}.`;
      } catch (err) {
        // A revisão é um reforço de qualidade, não um requisito — se falhar, segue com
        // o resultado da primeira passada em vez de derrubar o agente inteiro.
        console.error(`Falha na revisão dos itens do edital ${editalId}:`, err);
      }
    }

    // "Pensar antes de soltar a planilha": confere as contas da lista (quantidade × unitário = total impresso na
    // linha, numeração sem buracos) e, se algo não fechar, relê SÓ aquele trecho com o modelo forte e raciocínio
    // estendido. A troca só vale se reduzir os defeitos. Nada disso vira texto para o usuário: só o resultado
    // melhor entra na planilha e o balanço fica no registro do servidor.
    if (result.itensEncontradosNoTexto && itensFinais.length > 0) {
      try {
        const releitura = await relerBlocosSuspeitos({
          itens: itensFinais,
          blocosTexto,
          cabecalho: cabecalhoEdital,
          estrutura: estruturaTabela,
          limite: LIMITE_RELEITURA_MS,
        });
        itensFinais = releitura.itens;
        console.log(
          `[agente3-financeiro] edital ${editalId}: conferência ${releitura.defeitosAntes} → ${releitura.defeitosDepois} defeito(s), ${releitura.blocosRelidos} trecho(s) relido(s)${releitura.interrompido ? ", releitura interrompida por tempo" : ""}, ${Date.now() - inicioMs}ms.`
        );
      } catch (err) {
        console.error(`Falha na releitura cuidadosa dos itens do edital ${editalId}:`, err);
      }
    }

    // Conferência complementar contra a API de itens do PNCP — só preenche lacunas,
    // nunca sobrescreve o que a IA já leu com confiança (ver conferirComPncp).
    itensFinais = await conferirComPncp(edital, itensFinais);

    const itensExtraidos = itensFinais.map((item) => {
      // Item sem preço no edital: valor unitário null vira 0 (a tela mostra o campo vazio para preencher).
      const valorUnitario = typeof item.valorUnitario === 'number' && Number.isFinite(item.valorUnitario) ? item.valorUnitario : 0;
      return {
        numero: item.numero ?? null,
        descricao: item.descricao,
        unidade: item.unidade,
        quantidade: item.quantidade,
        valorUnitario,
        valorTotal: Number((item.quantidade * valorUnitario).toFixed(2)),
        lote: item.lote ?? null,
        camposExtras: item.camposExtras,
        editadoManualmente: false,
      };
    });
    // Preços que a pessoa editou à mão na tela continuam valendo quando o agente roda de novo.
    const propostaAnterior = await prisma.proposal.findUnique({ where: { editalId }, select: { itensJson: true } });
    const itensComTotal = preservarEdicoesManuais(itensExtraidos, propostaAnterior ? parseItens(propostaAnterior.itensJson) : []);
    const somaItens = itensComTotal.reduce((acc, i) => acc + i.valorTotal, 0);
    const lotes = montarLotes(itensComTotal);

    await prisma.proposal.upsert({
      where: { editalId },
      create: {
        editalId,
        valorGlobalReferencia: valorReferencia ?? somaItens,
        itensJson: JSON.stringify(itensComTotal),
        observacoes: observacoesFinais,
        baseadoEmTextoCompleto: temTextoCompleto,
        lotesJson: lotes.length > 0 ? JSON.stringify(lotes) : null,
        colunasExtrasJson: colunasExtras.length > 0 ? JSON.stringify(colunasExtras) : null,
      },
      update: {
        valorGlobalReferencia: valorReferencia ?? somaItens,
        itensJson: JSON.stringify(itensComTotal),
        observacoes: observacoesFinais,
        baseadoEmTextoCompleto: temTextoCompleto,
        lotesJson: lotes.length > 0 ? JSON.stringify(lotes) : null,
        colunasExtrasJson: colunasExtras.length > 0 ? JSON.stringify(colunasExtras) : null,
      },
    });

    // Quando os itens vieram do texto real mas a soma diverge muito do valor
    // publicado, vale sinalizar — pode ser um erro de extração, ou o edital real ter
    // um total diferente do que está resumido no PNCP (ambos úteis de saber).
    const divergenciaSignificativa =
      result.itensEncontradosNoTexto && valorReferencia && valorReferencia > 0
        ? Math.abs(somaItens - valorReferencia) / valorReferencia > 0.3
        : false;

    // Mesmo depois da retentativa/divisão, a contagem pode ter ficado bem abaixo do
    // estimado no texto-fonte — nesse caso é melhor avisar alto e claro do que deixar o
    // usuário confiar numa lista que pode estar incompleta.
    const possivelmenteIncompleta =
      result.itensEncontradosNoTexto && itensEsperados > 5 && itensComTotal.length < itensEsperados * 0.7;

    const origemLabel = result.itensEncontradosNoTexto
      ? "transcritos do texto do edital, com revisão automática"
      : "nenhum item: o texto do edital estava indisponível";

    await logAudit(
      editalId,
      "Agente Financeiro",
      "Montagem da proposta",
      divergenciaSignificativa || possivelmenteIncompleta ? "ALERTA" : "OK",
      `Proposta montada com ${itensComTotal.length} item(ns) (${origemLabel})${lotes.length > 0 ? `, em ${lotes.length} lote(s)` : ""}, somando R$ ${somaItens.toFixed(2)}.` +
        (possivelmenteIncompleta
          ? ` O texto-fonte parece ter aproximadamente ${itensEsperados} linhas de tabela — a lista capturada pode estar incompleta, confira contra o PDF original antes de enviar.`
          : "") +
        (divergenciaSignificativa
          ? ` A soma diverge mais de 30% do valor de referência publicado (R$ ${valorReferencia!.toFixed(2)}) — confira antes de enviar a proposta.`
          : "")
    );

    return { itens: itensComTotal, valorGlobalReferencia: valorReferencia ?? somaItens };
  });
}

/**
 * Correção via chat: em vez de refazer a extração inteira (lenta e arriscada para uma
 * tabela grande), pede só um diff sobre a proposta já montada — igual à revisão
 * automática do fim de executarAgente3, mas guiado pela observação do usuário.
 */
export async function corrigirAgente3ViaChat(editalId: string, notaCorrecao: string): Promise<string> {
  const proposal = await prisma.proposal.findUnique({ where: { editalId } });
  if (!proposal) {
    await executarAgente3(editalId);
    return "Ainda não havia proposta montada para este edital — gerei a proposta base primeiro. Se o problema continuar, me diga de novo.";
  }

  const edital = await prisma.edital.findUniqueOrThrow({ where: { id: editalId } });
  const itensAtuais: ItemProposta[] = JSON.parse(proposal.itensJson);
  const { textoEdital, textoTermoReferencia, textoAnexosPrecos } = await obterTextoCompletoEdital(editalId, {
    palavrasChave: PALAVRAS_CHAVE_FINANCEIRO,
    tamanhoMax: MAX_CHARS_FINANCEIRO,
  });

  // Quando a proposta já está bem abaixo do que o texto-fonte sugere, um diff não dá
  // conta — o "itensFaltantes" ficaria grande demais pra resposta (estoura o limite de
  // tokens) e o modelo perde a referência do que já existe, oscilando entre tentativas
  // (adiciona um lote, remove outro). Nesse caso é mais confiável descartar e reextrair
  // do zero pelo pipeline com blocos e autocorreção — a mesma rota que já lida bem com
  // tabelas grandes — em vez de insistir num ajuste incremental.
  const areaFinanceira = [textoAnexosPrecos, textoTermoReferencia, textoEdital].filter(Boolean).join("\n");
  const itensEsperados = estimarQuantidadeDeItens(areaFinanceira);
  if (itensEsperados > 5 && itensAtuais.length < itensEsperados * 0.7) {
    await executarAgente3(editalId);
    const refeita = await prisma.proposal.findUnique({ where: { editalId } });
    const qtdNova = refeita ? (JSON.parse(refeita.itensJson) as ItemProposta[]).length : 0;
    await logAudit(
      editalId,
      "Agente Financeiro",
      "Correção via chat",
      "OK",
      `Observação do usuário: "${notaCorrecao}". Proposta estava bem incompleta (${itensAtuais.length} de ~${itensEsperados} itens esperados) — reextraída do zero, agora com ${qtdNova} item(ns).`
    );
    return `A proposta estava bem incompleta (${itensAtuais.length} de ~${itensEsperados} itens esperados pelo texto do edital) — refiz a extração inteira do zero em vez de só corrigir. Agora tem ${qtdNova} item(ns).`;
  }

  const listaIndexada = itensAtuais
    .map((it, i) => `[${i}] ${it.descricao} | ${it.unidade} | qtd ${it.quantidade} | unit ${it.valorUnitario} | lote ${it.lote ?? "-"}`)
    .join("\n");

  // A observação do usuário pode trazer embutido um trecho de anexo (ex: um PDF enviado
  // no chat com a tabela real a usar) — conta como fonte de itens tanto quanto o texto do
  // próprio edital, então soma nas duas estimativas para não subdimensionar o espaço de
  // resposta quando a tabela pedida for bem maior que a lista atual da proposta.
  const itensEsperadosNaObservacao = estimarQuantidadeDeItens(notaCorrecao);
  const baseParaTokens = Math.max(itensAtuais.length, itensEsperados, itensEsperadosNaObservacao);

  const diff = await askJSON<RevisaoDiff>(
    `Você é o agente financeiro de uma empresa. Abaixo estão (1) trechos do edital/TR com a tabela de itens, (2) a
lista de itens JÁ na proposta, com índices [0..${itensAtuais.length - 1}], e (3) uma observação do usuário apontando
um problema para você corrigir — a observação pode conter só uma instrução curta, ou pode trazer embutido um trecho
de documento (ex: um anexo que o usuário enviou) com a tabela real a usar. Aplique a correção pedida e devolva
SOMENTE o que precisa mudar — não repita a lista inteira:
- "correcoes": para cada item que precisa mudar, um objeto com o "indice" e SÓ os campos a corrigir.
- "itensFaltantes": itens que faltam na lista (inclusive os que o usuário pediu para adicionar).
- "indicesParaRemover": índices de itens que devem sair da lista.

Se o usuário pedir para SUBSTITUIR a tabela inteira por outra (ex: por um trecho de anexo que ele mandou), isso
significa colocar TODOS os itens da tabela nova em "itensFaltantes" e TODOS os índices [0..${itensAtuais.length - 1}]
da lista atual em "indicesParaRemover" — não é uma correção pontual, é uma troca completa. Transcreva a tabela nova
LITERALMENTE, item por item, sem pular nenhum — é o mesmo cuidado de uma extração normal.

${INSTRUCAO_FORMATO_NUMERICO}

Responda em JSON:
{
  "correcoes": [{ "indice": number, "descricao"?: string, "unidade"?: string, "quantidade"?: number, "valorUnitario"?: number, "lote"?: string }],
  "itensFaltantes": [{ "descricao": string, "unidade": string, "quantidade": number, "valorUnitario": number, "lote"?: string }],
  "indicesParaRemover": [number]
}`,
    `=== TEXTO-FONTE ===\n${textoAnexosPrecos ?? ""}\n${textoTermoReferencia ?? ""}\n${textoEdital ?? ""}\n\n=== LISTA ATUAL DA PROPOSTA (${itensAtuais.length} itens) ===\n${listaIndexada}\n\n=== OBSERVAÇÃO DO USUÁRIO ===\n${notaCorrecao}`,
    // O teto varia com o MAIOR entre a lista atual, o texto-fonte do edital e o que veio
    // na observação (ex: anexo do usuário) — usar só itensAtuais.length subdimensionava o
    // espaço de resposta numa troca de tabela inteira por uma bem maior, cortando o JSON
    // no meio e derrubando a correção inteira por falha de parse.
    { model: MODELO_HAIKU, maxTokens: maxTokensParaItens(baseParaTokens, 16_000) }
  );

  const revisados = itensAtuais.map((item, i) => {
    const c = diff.correcoes?.find((x) => x.indice === i);
    if (!c) return item;
    return {
      numero: typeof c.numero === "number" ? c.numero : item.numero,
      descricao: c.descricao ?? item.descricao,
      unidade: c.unidade ?? item.unidade,
      quantidade: typeof c.quantidade === "number" ? c.quantidade : item.quantidade,
      valorUnitario: typeof c.valorUnitario === "number" ? c.valorUnitario : item.valorUnitario,
      lote: c.lote ?? item.lote,
      // Mescla campo a campo (ver mesmo padrão na revisão automática logo acima).
      camposExtras: c.camposExtras ? { ...item.camposExtras, ...c.camposExtras } : item.camposExtras,
      // A correção via chat sobrescreveu este item — deixa de ser um valor que o
      // usuário editou manualmente (ver itensComTotal abaixo, que preserva esta flag
      // pros itens que o diff não tocou).
      editadoManualmente: false,
    };
  });
  const remover = new Set(diff.indicesParaRemover ?? []);
  const faltantes = (diff.itensFaltantes ?? []).filter(
    (f) => f && f.descricao && typeof f.quantidade === "number" && typeof f.valorUnitario === "number"
  );
  let itensFinais = [...revisados.filter((_, i) => !remover.has(i)), ...faltantes];

  // Sugestão de preço de mercado SÓ quando o usuário pede (a Bidd.IA não inventa preço sozinha). Itens editados à mão
  // e itens que já têm preço nunca são tocados; os preenchidos ficam marcados como "sugestão".
  let qtdEstimados = 0;
  const pediuSugestaoDePreco = /sugir|sugest|estim|pre[çc]os?\s+(de|do)\s+mercado|valor(es)?\s+(de|do)\s+mercado/i.test(notaCorrecao);
  if (pediuSugestaoDePreco && itensFinais.some((i) => i.valorUnitario == null || i.valorUnitario === 0)) {
    const preenchido = await preencherPrecosFaltantes(edital, itensFinais);
    itensFinais = preenchido.itens;
    qtdEstimados = preenchido.qtdEstimados;
  }

  const itensComTotal = itensFinais.map((item) => {
    const valorUnitario = typeof item.valorUnitario === "number" && Number.isFinite(item.valorUnitario) ? item.valorUnitario : 0;
    return {
      numero: item.numero ?? null,
      descricao: item.descricao,
      unidade: item.unidade,
      quantidade: item.quantidade,
      valorUnitario,
      valorTotal: Number((item.quantidade * valorUnitario).toFixed(2)),
      lote: item.lote ?? null,
      camposExtras: item.camposExtras,
      // Preserva a marcação de quem editou manualmente um preço via FinanceTab (ver
      // PATCH /proposal/itens) pros itens que esta correção via chat não tocou —
      // itens novos (faltantes) e os efetivamente corrigidos ficam false naturalmente.
      editadoManualmente: "editadoManualmente" in item ? !!item.editadoManualmente : false,
      ...("precoSugerido" in item && item.precoSugerido ? { precoSugerido: true } : {}),
    };
  });
  const somaItens = itensComTotal.reduce((acc, i) => acc + i.valorTotal, 0);
  const lotes = montarLotes(itensComTotal);

  await prisma.proposal.update({
    where: { editalId },
    data: {
      valorGlobalReferencia: edital.valorGlobal ?? somaItens,
      itensJson: JSON.stringify(itensComTotal),
      observacoes: `${proposal.observacoes ?? ""}\n\nCorreção via chat: "${notaCorrecao}"`.trim(),
      lotesJson: lotes.length > 0 ? JSON.stringify(lotes) : null,
    },
  });

  const partes: string[] = [];
  if (diff.correcoes?.length) partes.push(`${diff.correcoes.length} item(ns) corrigido(s)`);
  if (faltantes.length) partes.push(`${faltantes.length} item(ns) adicionado(s)`);
  if (remover.size) partes.push(`${remover.size} item(ns) removido(s)`);
  if (qtdEstimados > 0) partes.push(`${qtdEstimados} item(ns) sem preço no edital, com valor de mercado sugerido`);
  const resumo =
    partes.length > 0
      ? `Ajustei a proposta: ${partes.join(", ")}.`
      : "Revisei a proposta, mas não encontrei nada para mudar com base na sua observação — pode detalhar melhor o que está errado?";

  await logAudit(editalId, "Agente Financeiro", "Correção via chat", "OK", `Observação do usuário: "${notaCorrecao}". ${resumo}`);

  return resumo;
}
