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

// Acima deste tamanho estimado de tabela, uma única chamada tentando transcrever tudo
// de uma vez demora demais (uma tabela real de ~200 itens levou perto de 90s numa
// chamada só) — o suficiente para estourar o teto de 60s da Vercel por invocação. Em
// vez disso, divide a tabela em blocos e extrai cada um em paralelo: cada chamada fica
// pequena (rápida) e o tempo total passa a ser o do bloco mais lento, não a soma deles.
const LIMIAR_ITENS_PARA_DIVIDIR = 45;
const TAMANHO_BLOCO_ITENS = 5_000;

async function extrairBlocoDeItens(
  bloco: string,
  indice: number,
  total: number,
  cabecalho: string
): Promise<ItemProposta[]> {
  const prompt = `Você é o agente financeiro de uma empresa, extraindo a tabela de itens/preços de um edital
público brasileiro. Abaixo está APENAS UM TRECHO de uma tabela maior (trecho ${indice + 1} de ${total}) —
TRANSCREVA TODOS os itens presentes NESTE TRECHO, um por um, exatamente como estão (mesmo que a tabela continue
antes ou depois dele, fora do que foi te mostrado). Não invente itens que não estejam neste trecho, e não pule
nenhum item que esteja nele, por mais repetitivo que pareça.

${INSTRUCAO_FORMATO_NUMERICO}

Responda em JSON: { "itens": [{ "descricao": string, "unidade": string, "quantidade": number, "valorUnitario": number }] }
Se este trecho não contiver nenhuma linha de tabela reconhecível, devolva "itens": [].`;

  const contexto = `${cabecalho}\n\n=== TRECHO ${indice + 1} DE ${total} DA TABELA DE ITENS ===\n${bloco}`;

  for (let tentativa = 0; tentativa < 2; tentativa++) {
    try {
      // Bloco pequeno e delimitado — Haiku transcreve com fidelidade, é bem mais
      // rápido, e não consome a cota de Sonnet (que fica reservada para o resto).
      const resultado = await askJSON<{ itens: ItemProposta[] }>(prompt, contexto, {
        model: MODELO_HAIKU,
        maxTokens: 8000,
      });
      return resultado.itens ?? [];
    } catch (err) {
      console.error(`[agente3-financeiro] falha ao extrair bloco ${indice + 1}/${total} (tentativa ${tentativa + 1}):`, err);
    }
  }
  return [];
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
      await obterTextoCompletoEdital(editalId, { palavrasChave: PALAVRAS_CHAVE_FINANCEIRO });

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
    const dividido = temTextoCompleto && itensEsperados > LIMIAR_ITENS_PARA_DIVIDIR;

    if (dividido) {
      // Tabela grande: divide em blocos e extrai cada um em paralelo, em vez de uma
      // única chamada lenta demais para o teto de execução da Vercel.
      const cabecalho = `Objeto: ${edital.titulo}\nDescrição: ${edital.descricao}`;
      const blocos = dividirEmBlocosPorLinha(areaFinanceira, TAMANHO_BLOCO_ITENS);
      console.log(`[agente3-financeiro] edital ${editalId}: tabela grande (~${itensEsperados} itens estimados) — dividindo em ${blocos.length} blocos.`);

      const itensPorBloco = await Promise.all(
        blocos.map((bloco, i) => extrairBlocoDeItens(bloco, i, blocos.length, cabecalho))
      );
      const itens = itensPorBloco.flat();

      result = {
        itensEncontradosNoTexto: itens.length > 0,
        itens,
        observacoes:
          itens.length > 0
            ? `Tabela de itens extraída em ${blocos.length} trechos (documento com tabela extensa, ~${itensEsperados} itens) e combinada. Revise a lista contra o edital antes do envio.`
            : "Não foi possível extrair itens da tabela detectada no texto — monte a proposta manualmente a partir do PDF original.",
      };
    } else {
      const instrucaoFonte = temTextoCompleto
        ? `Você TEM ACESSO a trechos do edital e/ou termo de referência (e possíveis anexos) acima, selecionados
justamente por serem os mais prováveis de conter a tabela de itens. Esses documentos costumam trazer uma planilha
ou lista formal de itens (descrição, unidade, quantidade e, às vezes, valor unitário estimado). PROCURE essa lista
real com atenção — ela pode estar formatada como tabela (colunas que viraram linhas soltas na extração de texto) —
e TRANSCREVA cada item dela exatamente como está, sem arredondar, resumir ou combinar itens parecidos em um só.
Não invente uma composição alternativa se os itens reais estiverem no texto. Marque "itensEncontradosNoTexto":
true nesse caso, e liste TODOS os itens encontrados. Isso NÃO é uma tarefa de resumir: é transcrição literal, linha
por linha. É proibido selecionar só uma amostra "representativa" ou pular itens repetitivos/parecidos para
economizar espaço. Só estime valores de mercado para o(s) campo(s) que realmente não constarem no texto (ex:
quando o edital lista os itens mas não o valor unitário) — e diga isso explicitamente nas observações.`
        : `O texto completo do edital não estava disponível — você não tem como saber a lista real de itens. Monte
uma composição PLAUSÍVEL com base no objeto e no valor de referência (quando houver), e marque
"itensEncontradosNoTexto": false. Nesse caso (e só nesse caso), a soma dos itens deve fechar aproximadamente no
valor de referência informado. Deixe claro nas observações que isso é uma estimativa e precisa ser conferida pelo
usuário contra o edital real antes do envio.`;

      const promptExtracao = (reforcoCompletude?: string) => `Você é o agente financeiro de uma empresa que está
estruturando uma proposta comercial para um edital público brasileiro. Sua prioridade nº 1 é EXATIDÃO E
COMPLETUDE: os números da proposta precisam bater exatamente com o que está escrito no edital/TR sempre que essa
informação existir no texto, e a lista de itens precisa ser a tabela INTEIRA — nunca aproxime, arredonde ou
resuma um valor ou uma lista que estão explícitos na fonte.

${instrucaoFonte}

${INSTRUCAO_FORMATO_NUMERICO}
${reforcoCompletude ?? ""}

Responda em JSON:
{
  "itensEncontradosNoTexto": boolean,
  "itens": [{ "descricao": string, "unidade": string, "quantidade": number, "valorUnitario": number }],
  "observacoes": string (explique a origem dos números — transcrito do edital ou estimado — e alerte para revisão antes do envio)
}
Gere quantos itens o edital realmente listar (não há limite artificial de quantidade, nem para cima nem para
baixo); se não houver uma lista real, gere entre 2 e 20 itens plausíveis. Use números puros (sem "R$" ou
separadores de milhar) em quantidade e valorUnitario.`;

      // Transcrever uma tabela é tarefa mecânica: Haiku dá conta (é o mesmo modelo que
      // já cuida da extração em blocos das tabelas grandes) e é bem mais rápido. A
      // revisão em diff logo abaixo é a rede de segurança para os números. Se a lista
      // vier curta demais, a retentativa mais abaixo sobe para o Sonnet.
      result = await askJSON<FinanceiroResult>(promptExtracao(), contexto, {
        model: temTextoCompleto ? MODELO_HAIKU : MODELO_SONNET,
        maxTokens: maxTokensParaItens(Math.max(itensEsperados, 20)),
      });

      // Checagem de completude: mesmo abaixo do limiar de divisão, o modelo pode ter
      // "resumido" em vez de transcrever tudo — tenta de novo UMA vez apontando o total
      // esperado explicitamente antes de aceitar uma lista muito mais curta que o texto.
      if (result.itensEncontradosNoTexto && itensEsperados > 5 && result.itens.length < itensEsperados * 0.7) {
        console.warn(
          `[agente3-financeiro] edital ${editalId}: extração parece incompleta (${result.itens.length}/${itensEsperados} itens estimados) — tentando novamente com o total esperado explícito.`
        );
        try {
          const retentativa = await askJSON<FinanceiroResult>(
            promptExtracao(
              `\nATENÇÃO: uma tentativa anterior devolveu só ${result.itens.length} itens, mas o texto-fonte acima
parece conter aproximadamente ${itensEsperados} linhas de tabela (cada linha com dois valores em R$ é um item
separado). Releia o texto do início ao fim da tabela e devolva a lista COMPLETA — não pare antes do fim.`
            ),
            contexto,
            { model: MODELO_SONNET, maxTokens: maxTokensParaItens(itensEsperados, 24_000) }
          );
          if (retentativa.itens.length > result.itens.length) result = retentativa;
        } catch (err) {
          console.error(`Falha na retentativa de extração completa do edital ${editalId}:`, err);
        }
      }
    }

    // Segunda passada de revisão: confere a lista extraída contra o texto-fonte e
    // devolve só um "diff" (o que corrigir/adicionar/remover) — rápido e sem risco de
    // truncar a lista. Roda no caminho não-dividido, para listas de tamanho moderado.
    let itensFinais = result.itens;
    let observacoesFinais = result.observacoes;
    const LIMITE_ITENS_PARA_REVISAO = 60;
    if (!dividido && result.itensEncontradosNoTexto && result.itens.length > 0 && result.itens.length <= LIMITE_ITENS_PARA_REVISAO) {
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
      ? `transcritos do texto do edital${dividido ? ` em ${Math.ceil(areaFinanceira.length / TAMANHO_BLOCO_ITENS)} blocos` : ", com revisão automática"}`
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
