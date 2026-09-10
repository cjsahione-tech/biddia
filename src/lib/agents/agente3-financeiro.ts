import { prisma } from "@/lib/prisma";
import { askJSON } from "@/lib/anthropic";
import { obterTextoCompletoEdital } from "@/lib/agents/pdf-extract";
import { withAgentRun, logAudit } from "@/lib/agents/run-tracker";

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

type VerificacaoResult = {
  itensCorrigidos: ItemProposta[];
  divergenciasEncontradas: string[];
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
 * pouco), mas é o suficiente para flagrar quando o modelo devolveu uma lista bem menor
 * do que a tabela real tem — editais com 100+ itens (comum em laboratório, materiais
 * hospitalares etc.) são o caso que mais historicamente vinha sendo cortado pela metade.
 */
function estimarQuantidadeDeItens(texto: string): number {
  return texto.match(/R\$\s*[\d.,]+[^\n]{0,40}?R\$\s*[\d.,]+/g)?.length ?? 0;
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

    const instrucaoFonte = temTextoCompleto
      ? `Você TEM ACESSO a trechos do edital e/ou termo de referência (e possíveis anexos) acima, selecionados
justamente por serem os mais prováveis de conter a tabela de itens. Esses documentos costumam trazer uma planilha
ou lista formal de itens (descrição, unidade, quantidade e, às vezes, valor unitário estimado). PROCURE essa lista
real com atenção — ela pode estar formatada como tabela (colunas que viraram linhas soltas na extração de texto) —
e TRANSCREVA cada item dela exatamente como está, sem arredondar, resumir ou combinar itens parecidos em um só.
Não invente uma composição alternativa se os itens reais estiverem no texto. Marque "itensEncontradosNoTexto":
true nesse caso. A tabela pode ter poucos itens ou várias centenas (planilhas de exames laboratoriais, materiais
hospitalares e afins costumam ter 100, 200 ou mais linhas) — TRANSCREVA A TABELA INTEIRA, DO PRIMEIRO AO ÚLTIMO
ITEM, por mais longa que seja. Isso NÃO é uma tarefa de resumir: é transcrição literal, linha por linha. É
absolutamente proibido selecionar só uma amostra "representativa", parar num número redondo ou pular itens
repetitivos/parecidos para economizar espaço — cada linha da tabela é um item de cobrança real, e faltar um único
item na proposta é um erro grave para quem vai usá-la. Só estime valores de mercado para o(s) campo(s) que
realmente não constarem no texto (ex: quando o edital lista os itens mas não o valor unitário) — e diga isso
explicitamente nas observações.`
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

    let result = await askJSON<FinanceiroResult>(promptExtracao(), contexto, { maxTokens: 16000 });

    // Checagem de completude: conta grosseiramente quantas linhas de tabela existem no
    // texto-fonte e compara com o que o modelo devolveu. Tabelas grandes (100+ itens)
    // eram justamente o cenário em que o modelo tendia a "resumir" em vez de transcrever
    // tudo — em vez de confiar cegamente, tenta de novo UMA vez apontando o número
    // esperado explicitamente antes de aceitar uma lista muito mais curta que o texto.
    const areaFinanceira = [textoAnexosPrecos, textoTermoReferencia, textoEdital].filter(Boolean).join("\n");
    const itensEsperados = estimarQuantidadeDeItens(areaFinanceira);
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
          { maxTokens: 24000 }
        );
        if (retentativa.itens.length > result.itens.length) result = retentativa;
      } catch (err) {
        console.error(`Falha na retentativa de extração completa do edital ${editalId}:`, err);
      }
    }

    // Segunda passada: quando o modelo diz ter encontrado uma tabela real, confere o
    // que ele mesmo extraiu contra o texto-fonte antes de gravar — captura erros de
    // transcrição (dígito trocado, vírgula/ponto invertidos, item duplicado ou
    // esquecido) que passariam despercebidos numa única chamada. Pulado para listas
    // muito grandes: nesse caso o risco de a PRÓPRIA revisão truncar a lista (o mesmo
    // problema que ela deveria corrigir) pesa mais que o ganho de revisar item a item.
    let itensFinais = result.itens;
    let observacoesFinais = result.observacoes;
    const LIMITE_ITENS_PARA_REVISAO = 120;
    if (result.itensEncontradosNoTexto && result.itens.length > 0 && result.itens.length <= LIMITE_ITENS_PARA_REVISAO) {
      try {
        const verificacao = await askJSON<VerificacaoResult>(
          `Você é um revisor financeiro rigoroso. Abaixo estão (1) trechos do edital/TR com a tabela de itens e (2)
uma lista de itens que outro agente extraiu deles. Confira CADA item da lista contra o texto-fonte:
- Corrija quantidade, unidade, descrição ou valor unitário que não baterem exatamente com o texto.
- Remova da lista qualquer item que não exista de fato no texto-fonte.
- Adicione qualquer item da tabela real que ficou faltando na lista.
A lista de entrada já tem ${result.itens.length} itens — sua resposta deve ter pelo menos esse tanto (só menos se
algum item realmente não existir no texto-fonte). Se a lista já estiver correta, devolva-a exatamente como está,
por completo.

${INSTRUCAO_FORMATO_NUMERICO}

Responda em JSON:
{
  "itensCorrigidos": [{ "descricao": string, "unidade": string, "quantidade": number, "valorUnitario": number }],
  "divergenciasEncontradas": string[] (uma frase curta por correção feita; lista vazia se nada precisou de ajuste)
}`,
          `=== TEXTO-FONTE ===\n${textoAnexosPrecos ?? ""}\n${textoTermoReferencia ?? ""}\n${textoEdital ?? ""}\n\n=== LISTA A CONFERIR (${result.itens.length} itens) ===\n${JSON.stringify(result.itens)}`,
          { maxTokens: 16000 }
        );

        // Só aceita a revisão se ela não tiver encolhido a lista de forma suspeita — uma
        // queda grande de itens é sinal mais provável de a própria revisão ter cortado
        // pela metade do que de terem sido descobertos vários itens inventados.
        const encolheuDemais = verificacao.itensCorrigidos?.length < result.itens.length * 0.9;
        if (verificacao.itensCorrigidos?.length > 0 && !encolheuDemais) {
          itensFinais = verificacao.itensCorrigidos;
          if (verificacao.divergenciasEncontradas?.length > 0) {
            observacoesFinais = `${result.observacoes}\n\nRevisão automática ajustou: ${verificacao.divergenciasEncontradas.join("; ")}.`;
          }
        } else if (encolheuDemais) {
          console.warn(
            `[agente3-financeiro] edital ${editalId}: revisão devolveu ${verificacao.itensCorrigidos?.length ?? 0} itens (entrada tinha ${result.itens.length}) — descartada por segurança, mantida a lista original.`
          );
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

    // Mesmo depois da retentativa de completude, a contagem pode ter ficado bem abaixo
    // do estimado no texto-fonte — nesse caso é melhor avisar alto e claro do que deixar
    // o usuário confiar numa lista que pode estar incompleta.
    const possivelmenteIncompleta =
      result.itensEncontradosNoTexto && itensEsperados > 5 && itensComTotal.length < itensEsperados * 0.7;

    const origemLabel = result.itensEncontradosNoTexto
      ? `transcritos do texto do edital${itensComTotal.length <= LIMITE_ITENS_PARA_REVISAO ? ", com revisão automática" : ""}`
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
