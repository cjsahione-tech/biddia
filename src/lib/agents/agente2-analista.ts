import { prisma } from "@/lib/prisma";
import { askJSON, MODELO_HAIKU } from "@/lib/anthropic";
import { obterTextoCompletoEdital } from "@/lib/agents/pdf-extract";
import { withAgentRun, logAudit } from "@/lib/agents/run-tracker";
import { comRegrasComuns } from "@/lib/agents/regras-comuns";
import {
  normalizarGruposHabilitacao,
  normalizarLista,
  normalizarObrigacoes,
  normalizarPontosDeAtencao,
  normalizarPrazos,
  paraTexto,
  serializarObrigacoes,
} from "@/lib/analise-dados";

// Cada grupo é uma seção de habilitação/qualificação TAL COMO o próprio edital a
// organiza (ex: "13.1 Regularidade Fiscal, Trabalhista, Econômico-Financeira e
// Jurídica" vira um grupo só, com todos os itens 13.1.1-13.1.9 dentro) — o Agente
// Secretário usa isso para montar as pastas do jeito que o edital já organiza,
// em vez de reclassificar cada item isoladamente.
export type GrupoHabilitacao = { categoriaEdital: string; itens: string[] };

// Um prazo do edital: "tipo" é o que o prazo representa (ex: "Entrega do objeto"), "prazo" o
// valor exatamente como o edital escreve (ex: "30 dias corridos após a ordem de serviço" ou
// "15/10/2026 às 09:00"), "referencia" a cláusula/seção de onde veio (null quando não há).
export type PrazoEdital = { tipo: string; prazo: string; referencia: string | null };

type AnalysisResult = {
  resumoObjeto: string;
  prazos: PrazoEdital[];
  obrigacoesContratada: string[];
  obrigacoesContratante: string[];
  habilitacao: GrupoHabilitacao[];
  requisitosObrigatorios: string[];
  requisitosAdicionais: string[];
  pontosDeAtencao: unknown[];
  avisos: string[];
};

// Prazos ficam espalhados pelo edital inteiro (sessão, impugnação, recursos, entrega,
// pagamento, garantia...) — sem estas palavras-chave, o corte de documentos longos
// mantinha só começo e fim do texto e perdia justamente o miolo onde as cláusulas de
// prazo estão. Mistura também os termos das demais seções da análise.
const PALAVRAS_CHAVE_ANALISE = [
  "prazo",
  "dias",
  "data",
  "horas",
  "vigência",
  "validade",
  "entrega",
  "pagamento",
  "recurso",
  "impugna",
  "esclarecimento",
  "sessão",
  "abertura",
  "garantia",
  "assinatura",
  "habilitação",
  "objeto",
  "obrigações",
  "contratada",
  "contratante",
  "órgão",
  "fiscaliza",
  "penalidade",
  "sanção",
  "multa",
];

/**
 * Prompt do Analista. Entrega SÓ a leitura do edital (objeto, prazos, obrigações das duas partes, habilitação,
 * requisitos e pontos de atenção) — sem parecer: quem decide participar é a pessoa, com base nesta leitura.
 */
export function promptAnalista(instrucaoFonte: string): string {
  return comRegrasComuns(`FUNÇÃO
Você é o Analista de licitações do Bidd.IA. Você lê o texto de um edital (e de seus anexos) e separa, de forma objetiva e
fiel, o que a equipe precisa saber: objeto, prazos, obrigações de cada parte, exigências de habilitação, requisitos e pontos
de atenção. Você NÃO dá parecer, NÃO recomenda participar ou não participar e NÃO calcula preços.

${instrucaoFonte}

PASSO A PASSO (siga nesta ordem)
1. Reconheça o documento: modalidade (pregão, concorrência, dispensa, credenciamento etc.), órgão e número do edital, se constarem.
2. "resumoObjeto": o que será contratado, em 3 a 6 frases — o que é, para quem, onde, por quanto tempo e em que regime (itens,
   lotes, global), apenas se constar. Sem frases de marketing.
3. "prazos": TODOS os prazos e datas do edital, sem deixar nenhum de fora, em ordem aproximadamente cronológica do processo.
   Procure ATIVAMENTE no texto inteiro: abertura da sessão e recebimento de propostas; esclarecimentos e impugnação; envio de
   documentos de habilitação / proposta ajustada; recursos e contrarrazões; validade da proposta; assinatura do contrato/ata e
   retirada da nota de empenho; vigência; prazo de execução; prazo de entrega (e de troca de item recusado); recebimento
   provisório/definitivo; prazo de pagamento; garantia (produto e contratual); amostras/demonstração/visita técnica;
   regularização fiscal (ME/EPP); prazos de sanções. Copie o prazo EXATAMENTE como o edital escreve (número, unidade, "dias
   úteis" ou "corridos", marco de contagem) e cite em "referencia" a cláusula/item (ou null). Se um prazo não está no texto,
   NÃO o liste.
4. "obrigacoesContratada": tudo o que a empresa vencedora terá que fazer DEPOIS de ganhar (entrega, local, garantia, manutenção,
   equipe, frequência, relatórios, penalidades relevantes). Uma obrigação por item, em frase curta, terminando com o item do edital
   entre parênteses, ex.: "Entregar os exames em até 48 horas (item 8.2)".
5. "obrigacoesContratante": tudo o que o ÓRGÃO contratante se compromete a fazer (pagar no prazo, fornecer informações ou acesso,
   designar fiscal/gestor, emitir ordem de serviço ou nota de empenho, receber o objeto, reajuste/reequilíbrio). Mesmo formato do
   item anterior. Só o que o texto diz: se o edital não traz obrigações da contratante, devolva lista vazia.
6. "habilitacao": todas as exigências de habilitação, agrupadas EXATAMENTE como o edital as agrupa em suas seções (use o título da
   seção como "categoriaEdital", sem o número). Em "itens", UM item por documento ou condição, com o nome do documento exigido fiel
   ao edital (ex.: "Certidão Negativa de Débitos Municipais"); quando houver condição, escreva-a no mesmo texto (ex.: "Balanço
   patrimonial com índices LG, SG e LC maiores que 1"); quando só valer para um caso, diga (ex.: "— somente ME/EPP", "— somente lote 3").
   "Certidões federal, estadual e municipal" são três itens. Se o edital não tiver seção clara, agrupe pelas categorias da Lei
   14.133/2021. NUNCA omita uma exigência por achar que é óbvia. Se remeter a outro documento ("conforme Anexo V"), leia o anexo
   se ele estiver no texto.
7. "requisitosObrigatorios": o que desclassifica ou inabilita quando faltar (inclui o que não é documento: visita técnica
   obrigatória, amostra, equipe mínima, certificação).
8. "requisitosAdicionais": o que apenas pontua, melhora a proposta ou é desejável (não eliminatório).
9. "pontosDeAtencao": pontos que podem prejudicar a empresa — exigências incomuns ou restritivas, prazos curtos, garantias altas,
   multas pesadas, pagamento lento, amostra, visita técnica, cláusulas ambíguas, inconsistências entre edital e anexos. Cada ponto:
   "descricao", "trecho" (o trecho curto do edital que o causa — sem trecho de apoio, NÃO crie o ponto) e "gravidade" ("alta",
   "media" ou "baixa").
10. "avisos": o que você NÃO conseguiu ler ou que está ambíguo, cortado ou contraditório (inclusive conflito entre o corpo do edital
    e um anexo — registre os dois textos). Se o texto parece incompleto, diga qual parte falta.

FORMATO DE SAÍDA (JSON, exatamente estas chaves)
{
  "resumoObjeto": string,
  "prazos": [ { "tipo": string, "prazo": string, "referencia": string | null } ],
  "obrigacoesContratada": string[],
  "obrigacoesContratante": string[],
  "habilitacao": [ { "categoriaEdital": string, "itens": string[] } ],
  "requisitosObrigatorios": string[],
  "requisitosAdicionais": string[],
  "pontosDeAtencao": [ { "descricao": string, "trecho": string, "gravidade": "alta" | "media" | "baixa" } ],
  "avisos": string[]
}

REGRAS ESPECÍFICAS
- Se o edital tiver lotes com exigências diferentes, diga a qual lote cada exigência se aplica.
- Não calcule valores nem monte preços (é do Financeiro) e não escreva declarações (é do Advogado).
- Não dê parecer nem recomendação: apenas a leitura.

CONFERÊNCIA FINAL (faça antes de responder)
- Percorri o edital inteiro procurando habilitação e prazos, ou só a primeira seção que apareceu?
- Toda data e prazo listados existem no texto?
- Cada ponto de atenção tem um trecho de apoio?
- Se o texto parece incompleto, está escrito em "avisos"?
- O JSON é válido, completo e sem texto em volta?`);
}

export async function executarAgente2(editalId: string, opts?: { notaCorrecao?: string }) {
  return withAgentRun(editalId, "agente2-analista", async () => {
    const edital = await prisma.edital.findUniqueOrThrow({ where: { id: editalId } });

    // Não busca mais o detalhe da contratação no PNCP aqui: o valor já está gravado no
    // edital e o texto completo do PDF (abaixo) cobre objeto/informação complementar
    // com muito mais precisão — a chamada extra ao PNCP só somava latência.
    const { textoEdital, textoTermoReferencia, temTextoCompleto } =
      await obterTextoCompletoEdital(editalId, { palavrasChave: PALAVRAS_CHAVE_ANALISE, tamanhoMax: 70_000 });

    const contexto = `
Título: ${edital.titulo}
Órgão: ${edital.orgaoNome} (${edital.orgaoCnpj})
Modalidade: ${edital.modalidade ?? "não informado"}
UF/Município: ${edital.uf ?? "?"}/${edital.municipio ?? "?"}
Valor estimado: ${edital.valorGlobal ?? "não informado"}
Descrição/objeto (busca PNCP): ${edital.descricao}
Data de abertura da proposta: ${edital.dataAberturaProposta?.toISOString() ?? "não informado"}
Data de encerramento da proposta: ${edital.dataEncerramentoProposta?.toISOString() ?? "não informado"}
${textoEdital ? `\n=== TEXTO COMPLETO DO EDITAL (extraído do PDF oficial) ===\n${textoEdital}` : ""}
${textoTermoReferencia ? `\n=== TEXTO COMPLETO DO TERMO DE REFERÊNCIA (extraído do PDF oficial) ===\n${textoTermoReferencia}` : ""}
${opts?.notaCorrecao ? `\n=== CORREÇÃO PEDIDA PELO USUÁRIO (sobre a sua análise anterior) ===\n${opts.notaCorrecao}\nRefaça a análise levando isso em conta — é prioridade sobre o que você concluiu antes, mas só vale o que o texto do edital sustenta; se a nota pedir algo que o texto não sustenta, diga isso em "avisos" e não invente.` : ""}
`.trim();

    const instrucaoFonte = temTextoCompleto
      ? `Você TEM ACESSO ao texto completo do edital e/ou do termo de referência (marcados acima entre "===").
Baseie sua leitura NELES, não em suposições — cite o item ou a seção sempre que possível. Se alguma informação pedida
não estiver no texto fornecido, deixe o campo vazio e explique em "avisos" (não invente).`
      : `O texto completo do edital NÃO estava disponível para leitura — você está trabalhando apenas com os
metadados públicos resumidos acima. Não afirme ter lido cláusulas específicas: preencha só o que os metadados sustentam
(objeto e as datas informadas), deixe as demais listas vazias e diga em "avisos" que a leitura completa do PDF continua
necessária.`;

    const result = await askJSON<AnalysisResult>(promptAnalista(instrucaoFonte), contexto, {
      model: MODELO_HAIKU,
      // 8000: a habilitação vem agrupada em objetos e há várias listas — editais grandes e cheios de seções
      // podiam estourar um teto menor e truncar o JSON no meio.
      maxTokens: 8000,
    });

    // O que a IA devolve passa por aqui antes de ser gravado: grupo de habilitação sem "itens", objeto no
    // lugar de texto etc. quebravam a tela (React: objeto como filho) e o Agente Secretário.
    const obrigacoes = normalizarObrigacoes({ contratada: result.obrigacoesContratada, contratante: result.obrigacoesContratante });
    // Avisos de leitura entram junto dos pontos de atenção (a tela mostra tudo num lugar só, sem coluna nova no banco).
    const avisos = normalizarLista(result.avisos).map((a) => `Aviso de leitura: ${a}`);
    const dadosSeguros = {
      resumoObjeto: paraTexto(result.resumoObjeto),
      obrigacoesContratada: serializarObrigacoes(obrigacoes),
      habilitacao: JSON.stringify(normalizarGruposHabilitacao(result.habilitacao)),
      requisitosObrigatorios: JSON.stringify(normalizarLista(result.requisitosObrigatorios)),
      requisitosAdicionais: JSON.stringify(normalizarLista(result.requisitosAdicionais)),
      riscos: JSON.stringify([...normalizarPontosDeAtencao(result.pontosDeAtencao), ...avisos]),
      // O Analista não dá mais parecer (a coluna continua existindo, vazia).
      parecer: "",
      prazos: JSON.stringify(normalizarPrazos(result.prazos)),
      baseadoEmTextoCompleto: temTextoCompleto,
    };

    await prisma.analysis.upsert({
      where: { editalId },
      create: {
        editalId,
        ...dadosSeguros,
      },
      update: {
        ...dadosSeguros,
      },
    });

    await logAudit(
      editalId,
      "Agente Analista",
      opts?.notaCorrecao ? "Correção via chat" : "Análise do edital",
      "OK",
      `Análise ${opts?.notaCorrecao ? "refeita a pedido do usuário" : "concluída"} ${temTextoCompleto ? "com leitura do texto completo do edital" : "apenas com metadados (texto do edital indisponível)"}: ${paraTexto(result.resumoObjeto)}`
    );

    return result;
  });
}
