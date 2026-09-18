import { prisma } from "@/lib/prisma";
import { askJSON, MODELO_HAIKU, MODELO_SONNET } from "@/lib/anthropic";
import { obterTextoCompletoEdital } from "@/lib/agents/pdf-extract";
import { withAgentRun, logAudit } from "@/lib/agents/run-tracker";

// Quanto de saída reservar na chamada de IA, em função de quantos itens se espera —
// reservar 16k tokens para um edital de 20 itens só fazia a chamada disputar cota de
// tokens/minuto à toa e demorar mais. ~70 tokens por item + folga.
function maxTokensParaItens(qtdItens: number, teto = 16_000): number {
  return Math.min(teto, Math.max(3_000, Math.round(qtdItens * 70 + 2_000)));
}

type ItemProposta = {
  descricao: string;
  unidade: string;
  quantidade: number;
  valorUnitario: number;
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

function montarPromptBloco(indice: number, total: number, reforco?: string): string {
  return `Você é o agente financeiro de uma empresa, extraindo a tabela de itens/preços de um edital
público brasileiro. Abaixo está APENAS UM TRECHO de uma tabela (trecho ${indice + 1} de ${total}) — TRANSCREVA
TODOS os itens presentes NESTE TRECHO, um por um, exatamente como estão (mesmo que a tabela continue antes ou
depois dele, fora do que foi te mostrado). Não invente itens que não estejam neste trecho, e É OBRIGATÓRIO não
pular nenhum item que esteja nele, por mais numeroso ou repetitivo que pareça — isso é transcrição literal linha
por linha, não um resumo. Faltar um item na lista é um erro grave para quem vai usar esta proposta.

${INSTRUCAO_FORMATO_NUMERICO}
${reforco ?? ""}

Responda em JSON: { "itens": [{ "descricao": string, "unidade": string, "quantidade": number, "valorUnitario": number }] }
Se este trecho não contiver nenhuma linha de tabela reconhecível, devolva "itens": [].`;
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
  cabecalho: string
): Promise<ItemProposta[]> {
  const contexto = `${cabecalho}\n\n=== TRECHO ${indice + 1} DE ${total} DA TABELA DE ITENS ===\n${bloco}`;
  const itensEsperadosBloco = estimarQuantidadeDeItens(bloco);

  let itens: ItemProposta[] = [];
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    try {
      // Bloco pequeno e delimitado — Haiku transcreve com fidelidade, é bem mais
      // rápido, e não consome a cota de Sonnet (que fica reservada para a escalada).
      const resultado = await askJSON<{ itens: ItemProposta[] }>(montarPromptBloco(indice, total), contexto, {
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
fim deste trecho e devolva a lista COMPLETA — não pare antes do fim.`
        ),
        contexto,
        { model: MODELO_SONNET, maxTokens: maxTokensParaItens(itensEsperadosBloco) }
      );
      if ((reforcado.itens?.length ?? 0) > itens.length) itens = reforcado.itens;
    } catch (err) {
      console.error(`[agente3-financeiro] falha na escalada do bloco ${indice + 1}/${total}:`, err);
    }
  }

  return itens;
}

/**
 * Alguns editais (comum em registro de preços) publicam só descrição/unidade/quantidade
 * na tabela — sem valor unitário de referência, porque é a própria empresa licitante que
 * propõe o preço. Sem tratar isso, o item fica com valorUnitario nulo/zero e a "proposta"
 * sai toda R$ 0,00, o que é enganoso. Quando a maioria dos itens está nessa situação,
 * pede uma estimativa de preço de mercado plausível para preencher a lacuna.
 */
async function preencherPrecosFaltantes(
  edital: { titulo: string; descricao: string },
  itens: ItemProposta[]
): Promise<{ itens: ItemProposta[]; qtdEstimados: number }> {
  const semPreco = itens
    .map((it, i) => ({ it, i }))
    .filter(({ it }) => it.valorUnitario == null || Number.isNaN(it.valorUnitario));
  if (semPreco.length === 0) return { itens, qtdEstimados: 0 };

  const lista = semPreco.map(({ it, i }) => `[${i}] ${it.descricao} | ${it.unidade} | qtd ${it.quantidade}`).join("\n");
  try {
    const resultado = await askJSON<{ precos: { indice: number; valorUnitario: number }[] }>(
      `Você é o agente financeiro de uma empresa respondendo a uma licitação pública brasileira. O edital publicou a
lista de itens e quantidades estimadas, mas NÃO publicou valores unitários de referência para eles — é a própria
empresa licitante que precisa propor um preço competitivo por item, dentro da realidade de mercado brasileira atual.

Objeto da licitação: ${edital.titulo} — ${edital.descricao}

Para cada item abaixo, sugira um valor unitário em reais plausível e competitivo, coerente com o que empresas do
ramo cobrariam por um item/serviço equivalente no Brasil hoje.

${INSTRUCAO_FORMATO_NUMERICO}

Responda em JSON: { "precos": [{ "indice": number, "valorUnitario": number }] }`,
      lista,
      { model: MODELO_SONNET, maxTokens: maxTokensParaItens(semPreco.length, 8_000) }
    );
    const mapa = new Map((resultado.precos ?? []).map((p) => [p.indice, p.valorUnitario]));
    const preenchidos = itens.map((it, i) => (mapa.has(i) ? { ...it, valorUnitario: mapa.get(i)! } : it));
    return { itens: preenchidos, qtdEstimados: mapa.size };
  } catch (err) {
    console.error("Falha ao estimar preços de mercado para itens sem valor unitário publicado:", err);
    return { itens, qtdEstimados: 0 };
  }
}

/**
 * Editais grandes às vezes citam a mesma relação de itens duas vezes no documento (ex:
 * uma vez na planilha de preços de verdade, outra num anexo/especificação que só lista
 * os nomes sem valor) — como agora o texto-fonte não é mais cortado antes de dividir em
 * blocos (ver MAX_CHARS_FINANCEIRO), os dois trechos podem virar itens duplicados.
 * Agrupa por descrição e mantém a versão com preço válido quando há duplicata.
 */
function deduplicarItens(itens: ItemProposta[]): ItemProposta[] {
  const porDescricao = new Map<string, ItemProposta>();
  for (const item of itens) {
    const chave = item.descricao.trim().toLowerCase();
    const existente = porDescricao.get(chave);
    if (!existente) {
      porDescricao.set(chave, item);
      continue;
    }
    const existenteTemPreco = existente.valorUnitario != null && existente.valorUnitario > 0;
    const novoTemPreco = item.valorUnitario != null && item.valorUnitario > 0;
    if (!existenteTemPreco && novoTemPreco) porDescricao.set(chave, item);
  }
  return Array.from(porDescricao.values());
}

export async function executarAgente3(editalId: string) {
  return withAgentRun(editalId, "agente3-financeiro", async () => {
    const edital = await prisma.edital.findUniqueOrThrow({ where: { id: editalId } });
    const analysis = await prisma.analysis.findUnique({ where: { editalId } });

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

    // Anexo de preços primeiro: é o candidato mais provável a conter a tabela de itens
    // de verdade, então entra logo no início do contexto (modelos tendem a dar mais
    // peso ao que aparece cedo quando o texto é longo).
    const contexto = `
Objeto: ${edital.titulo}
Descrição: ${edital.descricao}
Resumo do objeto (análise): ${analysis?.resumoObjeto ?? "não disponível"}
Valor global de referência publicado no PNCP: ${valorReferencia ?? "não publicado"}
${textoAnexosPrecos ? `\n=== TRECHOS DE ANEXO(S) COM POSSÍVEL TABELA DE ITENS/PREÇOS ===\n${textoAnexosPrecos}` : ""}
${textoTermoReferencia ? `\n=== TRECHOS RELEVANTES DO TERMO DE REFERÊNCIA ===\n${textoTermoReferencia}` : ""}
${textoEdital ? `\n=== TRECHOS RELEVANTES DO EDITAL ===\n${textoEdital}` : ""}
`.trim();

    const areaFinanceira = [textoAnexosPrecos, textoTermoReferencia, textoEdital].filter(Boolean).join("\n");
    const itensEsperados = estimarQuantidadeDeItens(areaFinanceira);

    let result: FinanceiroResult;

    if (temTextoCompleto) {
      // SEMPRE divide em blocos e extrai em paralelo — mesmo uma tabela pequena vira
      // "1 bloco", mas passa pelo mesmo prompt insistente e pela mesma autocorreção que
      // uma tabela de 200 itens. Isso existe porque uma chamada única sobre a tabela
      // inteira, em vez de blocos delimitados, era exatamente onde o modelo às vezes
      // "resumia" no meio de uma lista de tamanho médio em vez de transcrever tudo.
      const cabecalho = `Objeto: ${edital.titulo}\nDescrição: ${edital.descricao}`;
      const blocos = dividirEmBlocosPorLinha(areaFinanceira, TAMANHO_BLOCO_ITENS);
      console.log(`[agente3-financeiro] edital ${editalId}: ~${itensEsperados} itens estimados — extraindo em ${blocos.length} bloco(s).`);

      const itensPorBloco = await Promise.all(
        blocos.map((bloco, i) => extrairBlocoDeItens(bloco, i, blocos.length, cabecalho))
      );
      let itens = deduplicarItens(itensPorBloco.flat());

      // Edital publicou a tabela sem coluna de preço (comum em registro de preços) —
      // sem isso, todo item ficaria com valorTotal zerado, o que é enganoso.
      const semPrecoAntes = itens.filter((i) => i.valorUnitario == null).length;
      let avisoPreco = "";
      if (itens.length > 0 && semPrecoAntes / itens.length > 0.5) {
        const { itens: preenchidos, qtdEstimados } = await preencherPrecosFaltantes(edital, itens);
        itens = preenchidos;
        if (qtdEstimados > 0) {
          avisoPreco = ` O edital não publicou valor unitário de referência para ${qtdEstimados} item(ns) — a Bidd.IA sugeriu preços de mercado plausíveis para eles; ajuste antes de enviar a proposta.`;
        }
      }

      result = {
        itensEncontradosNoTexto: itens.length > 0,
        itens,
        observacoes:
          itens.length > 0
            ? `Tabela de itens transcrita do texto do edital${blocos.length > 1 ? ` (extraída em ${blocos.length} trechos)` : ""} e conferida linha a linha. Revise antes do envio.${avisoPreco}`
            : "Não foi possível identificar itens de uma tabela de preços no texto — monte a proposta manualmente a partir do PDF original.",
      };
    } else {
      // Sem texto do edital: não há como saber a lista real, então monta uma
      // composição plausível com base no objeto e no valor de referência (quando houver).
      const promptEstimativa = `Você é o agente financeiro de uma empresa que está estruturando uma proposta
comercial para um edital público brasileiro. O texto completo do edital não estava disponível — você não tem como
saber a lista real de itens. Monte uma composição PLAUSÍVEL com base no objeto e no valor de referência (quando
houver), e marque "itensEncontradosNoTexto": false. A soma dos itens deve fechar aproximadamente no valor de
referência informado. Deixe claro nas observações que isso é uma estimativa e precisa ser conferida pelo usuário
contra o edital real antes do envio.

Responda em JSON:
{
  "itensEncontradosNoTexto": false,
  "itens": [{ "descricao": string, "unidade": string, "quantidade": number, "valorUnitario": number }],
  "observacoes": string
}
Gere entre 2 e 20 itens plausíveis. Use números puros (sem "R$" ou separadores de milhar) em quantidade e valorUnitario.`;

      result = await askJSON<FinanceiroResult>(promptEstimativa, contexto, {
        model: MODELO_SONNET,
        maxTokens: 4_000,
      });
    }

    // Segunda passada de revisão: confere a lista extraída contra o texto-fonte e
    // devolve só um "diff" (o que corrigir/adicionar/remover) — rápido e sem risco de
    // truncar a lista.
    let itensFinais = result.itens;
    let observacoesFinais = result.observacoes;
    const LIMITE_ITENS_PARA_REVISAO = 300;
    if (result.itensEncontradosNoTexto && result.itens.length > 0 && result.itens.length <= LIMITE_ITENS_PARA_REVISAO) {
      try {
        const listaIndexada = result.itens
          .map((it, i) => `[${i}] ${it.descricao} | ${it.unidade} | qtd ${it.quantidade} | unit ${it.valorUnitario}`)
          .join("\n");

        const diff = await askJSON<RevisaoDiff>(
          `Você é um revisor financeiro rigoroso. Abaixo estão (1) trechos do edital/TR com a tabela de itens e (2)
uma lista de itens JÁ extraída, com índices [0..${result.itens.length - 1}]. Confira a lista contra o texto-fonte
e devolva SOMENTE o que precisa mudar — não repita a lista inteira:
- "correcoes": para cada item cujo texto/quantidade/unidade/valor unitário não bate com a fonte, um objeto com o
  "indice" e SÓ os campos a corrigir.
- "itensFaltantes": itens que existem na tabela do texto mas não estão na lista.
- "indicesParaRemover": índices de itens que NÃO existem de fato no texto-fonte.
Se estiver tudo certo, devolva as três listas vazias.

${INSTRUCAO_FORMATO_NUMERICO}

Responda em JSON:
{
  "correcoes": [{ "indice": number, "descricao"?: string, "unidade"?: string, "quantidade"?: number, "valorUnitario"?: number }],
  "itensFaltantes": [{ "descricao": string, "unidade": string, "quantidade": number, "valorUnitario": number }],
  "indicesParaRemover": [number]
}`,
          `=== TEXTO-FONTE ===\n${textoAnexosPrecos ?? ""}\n${textoTermoReferencia ?? ""}\n${textoEdital ?? ""}\n\n=== LISTA EXTRAÍDA (${result.itens.length} itens) ===\n${listaIndexada}`,
          // Conferência mecânica e resposta pequena (só o diff) — Haiku dá conta e é rápido.
          { model: MODELO_HAIKU, maxTokens: 4_000 }
        );

        const ajustes: string[] = [];
        const revisados = result.itens.map((item, i) => {
          const c = diff.correcoes?.find((x) => x.indice === i);
          if (!c) return item;
          ajustes.push(`item "${item.descricao}" ajustado`);
          return {
            descricao: c.descricao ?? item.descricao,
            unidade: c.unidade ?? item.unidade,
            quantidade: typeof c.quantidade === "number" ? c.quantidade : item.quantidade,
            valorUnitario: typeof c.valorUnitario === "number" ? c.valorUnitario : item.valorUnitario,
          };
        });

        const remover = new Set(diff.indicesParaRemover ?? []);
        const faltantes = (diff.itensFaltantes ?? []).filter(
          (f) => f && f.descricao && typeof f.quantidade === "number" && typeof f.valorUnitario === "number"
        );
        // Trava de segurança: nunca deixa a revisão apagar mais de 20% da lista.
        const podeRemover = remover.size <= result.itens.length * 0.2;
        itensFinais = [...revisados.filter((_, i) => !(podeRemover && remover.has(i))), ...faltantes];

        if (ajustes.length + faltantes.length + (podeRemover ? remover.size : 0) > 0) {
          const partes = [];
          if (ajustes.length) partes.push(`${ajustes.length} item(ns) corrigido(s)`);
          if (faltantes.length) partes.push(`${faltantes.length} item(ns) que faltavam adicionado(s)`);
          if (podeRemover && remover.size) partes.push(`${remover.size} item(ns) inexistente(s) removido(s)`);
          observacoesFinais = `${result.observacoes}\n\nRevisão automática: ${partes.join(", ")}.`;
        }
      } catch (err) {
        // A revisão é um reforço de qualidade, não um requisito — se falhar, segue com
        // o resultado da primeira passada em vez de derrubar o agente inteiro.
        console.error(`Falha na revisão dos itens do edital ${editalId}:`, err);
      }
    }

    const itensComTotal = itensFinais.map((item) => ({
      ...item,
      valorTotal: Number((item.quantidade * item.valorUnitario).toFixed(2)),
    }));
    const somaItens = itensComTotal.reduce((acc, i) => acc + i.valorTotal, 0);

    await prisma.proposal.upsert({
      where: { editalId },
      create: {
        editalId,
        valorGlobalReferencia: valorReferencia ?? somaItens,
        itensJson: JSON.stringify(itensComTotal),
        observacoes: observacoesFinais,
        baseadoEmTextoCompleto: !!result.itensEncontradosNoTexto,
      },
      update: {
        valorGlobalReferencia: valorReferencia ?? somaItens,
        itensJson: JSON.stringify(itensComTotal),
        observacoes: observacoesFinais,
        baseadoEmTextoCompleto: !!result.itensEncontradosNoTexto,
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
      : "estimados, texto do edital indisponível";

    await logAudit(
      editalId,
      "Agente Financeiro",
      "Montagem da proposta",
      divergenciaSignificativa || possivelmenteIncompleta ? "ALERTA" : "OK",
      `Proposta montada com ${itensComTotal.length} item(ns) (${origemLabel}), somando R$ ${somaItens.toFixed(2)}.` +
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
    .map((it, i) => `[${i}] ${it.descricao} | ${it.unidade} | qtd ${it.quantidade} | unit ${it.valorUnitario}`)
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
  "correcoes": [{ "indice": number, "descricao"?: string, "unidade"?: string, "quantidade"?: number, "valorUnitario"?: number }],
  "itensFaltantes": [{ "descricao": string, "unidade": string, "quantidade": number, "valorUnitario": number }],
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
      descricao: c.descricao ?? item.descricao,
      unidade: c.unidade ?? item.unidade,
      quantidade: typeof c.quantidade === "number" ? c.quantidade : item.quantidade,
      valorUnitario: typeof c.valorUnitario === "number" ? c.valorUnitario : item.valorUnitario,
    };
  });
  const remover = new Set(diff.indicesParaRemover ?? []);
  const faltantes = (diff.itensFaltantes ?? []).filter(
    (f) => f && f.descricao && typeof f.quantidade === "number" && typeof f.valorUnitario === "number"
  );
  let itensFinais = [...revisados.filter((_, i) => !remover.has(i)), ...faltantes];

  // Mesma checagem de "edital sem coluna de preço" da extração cheia — o usuário pode
  // estar reportando exatamente esse sintoma (proposta com tudo R$ 0,00) via chat.
  const semPrecoAntes = itensFinais.filter((i) => i.valorUnitario == null).length;
  let qtdEstimados = 0;
  if (itensFinais.length > 0 && semPrecoAntes / itensFinais.length > 0.5) {
    const preenchido = await preencherPrecosFaltantes(edital, itensFinais);
    itensFinais = preenchido.itens;
    qtdEstimados = preenchido.qtdEstimados;
  }

  const itensComTotal = itensFinais.map((item) => ({
    ...item,
    valorTotal: Number((item.quantidade * item.valorUnitario).toFixed(2)),
  }));
  const somaItens = itensComTotal.reduce((acc, i) => acc + i.valorTotal, 0);

  await prisma.proposal.update({
    where: { editalId },
    data: {
      valorGlobalReferencia: edital.valorGlobal ?? somaItens,
      itensJson: JSON.stringify(itensComTotal),
      observacoes: `${proposal.observacoes ?? ""}\n\nCorreção via chat: "${notaCorrecao}"`.trim(),
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
