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

type LeituraPrincipal = {
  resumoObjeto: string;
  prazos: PrazoEdital[];
  obrigacoesContratada: string[];
  obrigacoesContratante: string[];
  requisitosObrigatorios: string[];
  requisitosAdicionais: string[];
  pontosDeAtencao: unknown[];
  avisos: string[];
};

type LeituraHabilitacao = {
  habilitacao: GrupoHabilitacao[];
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

// A leitura da habilitação olha só as seções de habilitação do edital (texto bem menor).
const PALAVRAS_CHAVE_HABILITACAO = [
  "habilitação",
  "regularidade",
  "certidão",
  "qualificação",
  "balanço",
  "atestado",
  "declaração",
  "jurídica",
  "fiscal",
  "trabalhista",
  "econômico",
  "documentos",
];

// Duas leituras em PARALELO (o tempo é o da mais lenta, não a soma) e com a resposta bem enxuta: a IA gasta a maior parte do
// tempo ESCREVENDO a resposta, então o que mais acelera é pedir só o essencial, em frases curtas e com limite de itens. Uma
// versão anterior pedia tudo numa resposta só, grande demais: batia no teto de tokens, vinha cortada e era refeita várias vezes.
const MAX_TOKENS_LEITURA_PRINCIPAL = 4_500;
const MAX_TOKENS_HABILITACAO = 3_000;
const TAMANHO_TEXTO_PRINCIPAL = 60_000;
const TAMANHO_TEXTO_HABILITACAO = 45_000;

/**
 * Leitura principal do edital: objeto, prazos, obrigações das duas partes, requisitos e pontos de atenção — sem parecer:
 * quem decide participar é a pessoa, com base nesta leitura.
 */
export function promptAnalista(instrucaoFonte: string): string {
  return comRegrasComuns(`FUNÇÃO
Você é o Analista de licitações do Bidd.IA. Você lê o texto de um edital (e de seus anexos) e separa, de forma objetiva e
fiel, o que a equipe precisa saber: objeto, prazos, obrigações de cada parte, requisitos e pontos de atenção. Você NÃO dá
parecer, NÃO recomenda participar ou não participar, NÃO calcula preços e NÃO lista a habilitação (outra leitura cuida dela).
Seja CONCISO: frases curtas e diretas, sem repetir o que já disse em outro campo.

${instrucaoFonte}

O QUE ENTREGAR (e os limites — escolha o que mais importa se passar deles)
1. "resumoObjeto": o que será contratado, em 2 a 4 frases (o que é, para quem, onde, por quanto tempo, em que regime), só o que consta.
2. "prazos": até 20 prazos e datas do edital, em ordem do processo: abertura da sessão e propostas; esclarecimentos e impugnação;
   envio de documentos/proposta ajustada; recursos; validade da proposta; assinatura do contrato/ata; vigência; execução; entrega;
   recebimento; pagamento; garantia; amostras/visita técnica. Cada um: "tipo" (o que é), "prazo" (copiado como o edital escreve, com
   unidade e se são dias úteis ou corridos) e "referencia" (item do edital, ou null). Prazo que não está no texto, NÃO liste.
3. "obrigacoesContratada": até 12 obrigações da empresa vencedora DEPOIS de ganhar (entrega, local, garantia, manutenção, equipe,
   relatórios, penalidades relevantes). Uma frase curta cada, com o item entre parênteses, ex.: "Entregar os exames em até 48 horas (item 8.2)".
4. "obrigacoesContratante": até 8 obrigações do ÓRGÃO contratante (pagar no prazo, fornecer informações/acesso, designar fiscal,
   emitir ordem de serviço/empenho, receber o objeto). Mesmo formato. Se o edital não traz, lista vazia.
5. "requisitosObrigatorios": até 10 exigências que desclassificam ou inabilitam quando faltam e NÃO são documentos de habilitação
   (visita técnica, amostra, equipe mínima, certificação, condição de participação).
6. "requisitosAdicionais": até 6 itens que só pontuam ou são desejáveis (não eliminatórios).
7. "pontosDeAtencao": até 8 pontos que podem prejudicar a empresa (exigência restritiva, prazo curto, garantia alta, multa pesada,
   pagamento lento, cláusula ambígua, conflito entre edital e anexo). Cada um: "descricao" (uma frase), "trecho" (até 15 palavras do
   edital que o causam — sem trecho de apoio, NÃO crie o ponto) e "gravidade" ("alta", "media" ou "baixa").
8. "avisos": até 3 avisos do que você NÃO conseguiu ler ou está ambíguo/cortado/contraditório. Se o texto parece incompleto, diga qual parte falta.

FORMATO DE SAÍDA (JSON, exatamente estas chaves)
{
  "resumoObjeto": string,
  "prazos": [ { "tipo": string, "prazo": string, "referencia": string | null } ],
  "obrigacoesContratada": string[],
  "obrigacoesContratante": string[],
  "requisitosObrigatorios": string[],
  "requisitosAdicionais": string[],
  "pontosDeAtencao": [ { "descricao": string, "trecho": string, "gravidade": "alta" | "media" | "baixa" } ],
  "avisos": string[]
}

CONFERÊNCIA FINAL
- Toda data e prazo listados existem no texto?
- Cada ponto de atenção tem um trecho de apoio?
- Sem parecer, sem recomendação, sem habilitação?
- O JSON é válido, completo e sem texto em volta?`);
}

/**
 * Leitura da habilitação: só os documentos e condições de habilitação, agrupados como o edital agrupa (o Secretário monta o
 * checklist e as pastas a partir disto). Nomes curtos dos documentos — o texto literal das exigências é do Auditor de Habilitação.
 */
export function promptHabilitacao(instrucaoFonte: string): string {
  return comRegrasComuns(`FUNÇÃO
Você é o Analista de licitações do Bidd.IA, lendo SÓ a parte de HABILITAÇÃO de um edital. Liste os documentos e condições que a
empresa precisa apresentar para ser habilitada, agrupados exatamente como o edital agrupa. Seja CONCISO: nomes curtos.

${instrucaoFonte}

O QUE ENTREGAR
1. "habilitacao": grupos { "categoriaEdital", "itens" }. "categoriaEdital" é o título da seção como no edital (sem o número). Em
   "itens", UM item por documento ou condição, com o nome do documento exigido, fiel ao edital (ex.: "Certidão Negativa de Débitos
   Municipais"). Quando houver condição, escreva-a curta no mesmo item (ex.: "Balanço patrimonial com índices LG, SG e LC maiores que 1");
   quando só valer para um caso, diga (ex.: "— somente ME/EPP", "— somente lote 3"). "Certidões federal, estadual e municipal" são TRÊS
   itens. Se o edital não tiver seção clara, agrupe pelas categorias da Lei 14.133/2021. NUNCA omita uma exigência por achar que é óbvia.
2. "avisos": até 3 avisos do que você NÃO conseguiu ler ou está ambíguo/cortado (ex.: "o texto da seção de habilitação parece incompleto").

FORMATO DE SAÍDA (JSON, exatamente estas chaves)
{ "habilitacao": [ { "categoriaEdital": string, "itens": string[] } ], "avisos": string[] }

CONFERÊNCIA FINAL
- Cada documento exigido é um item separado e com nome curto?
- Os grupos têm os mesmos títulos do edital?
- O JSON é válido e sem texto em volta?`);
}

export async function executarAgente2(editalId: string, opts?: { notaCorrecao?: string }) {
  return withAgentRun(editalId, "agente2-analista", async () => {
    const edital = await prisma.edital.findUniqueOrThrow({ where: { id: editalId } });

    // Não busca mais o detalhe da contratação no PNCP aqui: o valor já está gravado no
    // edital e o texto completo do PDF (abaixo) cobre objeto/informação complementar
    // com muito mais precisão — a chamada extra ao PNCP só somava latência. O texto dos PDFs fica guardado depois da
    // primeira leitura, então pedir as duas versões (geral e de habilitação) não lê o PDF duas vezes.
    const [principal, habilitacaoTexto] = await Promise.all([
      obterTextoCompletoEdital(editalId, { palavrasChave: PALAVRAS_CHAVE_ANALISE, tamanhoMax: TAMANHO_TEXTO_PRINCIPAL }),
      obterTextoCompletoEdital(editalId, { palavrasChave: PALAVRAS_CHAVE_HABILITACAO, tamanhoMax: TAMANHO_TEXTO_HABILITACAO }),
    ]);
    const temTextoCompleto = principal.temTextoCompleto;

    const cabecalho = `
Título: ${edital.titulo}
Órgão: ${edital.orgaoNome} (${edital.orgaoCnpj})
Modalidade: ${edital.modalidade ?? "não informado"}
UF/Município: ${edital.uf ?? "?"}/${edital.municipio ?? "?"}
Valor estimado: ${edital.valorGlobal ?? "não informado"}
Descrição/objeto (busca PNCP): ${edital.descricao}
Data de abertura da proposta: ${edital.dataAberturaProposta?.toISOString() ?? "não informado"}
Data de encerramento da proposta: ${edital.dataEncerramentoProposta?.toISOString() ?? "não informado"}`.trim();
    const correcao = opts?.notaCorrecao
      ? `\n=== CORREÇÃO PEDIDA PELO USUÁRIO (sobre a sua análise anterior) ===\n${opts.notaCorrecao}\nRefaça levando isso em conta — é prioridade sobre o que você concluiu antes, mas só vale o que o texto do edital sustenta; se a nota pedir algo que o texto não sustenta, diga isso em "avisos" e não invente.`
      : "";
    const montarContexto = (t: typeof principal) =>
      `${cabecalho}
${t.textoEdital ? `\n=== TEXTO COMPLETO DO EDITAL (extraído do PDF oficial) ===\n${t.textoEdital}` : ""}
${t.textoTermoReferencia ? `\n=== TEXTO COMPLETO DO TERMO DE REFERÊNCIA (extraído do PDF oficial) ===\n${t.textoTermoReferencia}` : ""}${correcao}`.trim();

    const instrucaoFonte = temTextoCompleto
      ? `Você TEM ACESSO ao texto completo do edital e/ou do termo de referência (marcados acima entre "===").
Baseie sua leitura NELES, não em suposições — cite o item ou a seção sempre que possível. Se alguma informação pedida
não estiver no texto fornecido, deixe o campo vazio e explique em "avisos" (não invente).`
      : `O texto completo do edital NÃO estava disponível para leitura — você está trabalhando apenas com os
metadados públicos resumidos acima. Não afirme ter lido cláusulas específicas: preencha só o que os metadados sustentam
(objeto e as datas informadas), deixe as demais listas vazias e diga em "avisos" que a leitura completa do PDF continua
necessária.`;

    // As duas leituras andam juntas: o tempo total é o da mais lenta.
    const [leitura, habilitacao] = await Promise.all([
      askJSON<LeituraPrincipal>(promptAnalista(instrucaoFonte), montarContexto(principal), {
        model: MODELO_HAIKU,
        maxTokens: MAX_TOKENS_LEITURA_PRINCIPAL,
      }),
      askJSON<LeituraHabilitacao>(promptHabilitacao(instrucaoFonte), montarContexto(habilitacaoTexto), {
        model: MODELO_HAIKU,
        maxTokens: MAX_TOKENS_HABILITACAO,
      }),
    ]);

    // O que a IA devolve passa por aqui antes de ser gravado: grupo de habilitação sem "itens", objeto no
    // lugar de texto etc. quebravam a tela (React: objeto como filho) e o Agente Secretário.
    const obrigacoes = normalizarObrigacoes({ contratada: leitura.obrigacoesContratada, contratante: leitura.obrigacoesContratante });
    // Avisos de leitura entram junto dos pontos de atenção (a tela mostra tudo num lugar só, sem coluna nova no banco).
    const avisos = [...normalizarLista(leitura.avisos), ...normalizarLista(habilitacao.avisos)].map((a) => `Aviso de leitura: ${a}`);
    const dadosSeguros = {
      resumoObjeto: paraTexto(leitura.resumoObjeto),
      obrigacoesContratada: serializarObrigacoes(obrigacoes),
      habilitacao: JSON.stringify(normalizarGruposHabilitacao(habilitacao.habilitacao)),
      requisitosObrigatorios: JSON.stringify(normalizarLista(leitura.requisitosObrigatorios)),
      requisitosAdicionais: JSON.stringify(normalizarLista(leitura.requisitosAdicionais)),
      riscos: JSON.stringify([...normalizarPontosDeAtencao(leitura.pontosDeAtencao), ...avisos]),
      // O Analista não dá mais parecer (a coluna continua existindo, vazia).
      parecer: "",
      prazos: JSON.stringify(normalizarPrazos(leitura.prazos)),
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
      `Análise ${opts?.notaCorrecao ? "refeita a pedido do usuário" : "concluída"} ${temTextoCompleto ? "com leitura do texto completo do edital" : "apenas com metadados (texto do edital indisponível)"}: ${paraTexto(leitura.resumoObjeto)}`
    );

    return leitura;
  });
}
