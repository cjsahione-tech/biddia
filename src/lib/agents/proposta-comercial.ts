import { prisma } from "@/lib/prisma";
import { askJSON, MODELO_HAIKU } from "@/lib/anthropic";
import { obterTextoCompletoEdital } from "@/lib/agents/pdf-extract";
import { logAudit } from "@/lib/agents/run-tracker";
import { gerarPdfTimbrado, bytesToDataUrl } from "@/lib/agents/pdf";
import { gerarDocxTimbrado, bytesToDocxDataUrl } from "@/lib/agents/docx";
import { formatBRL } from "@/lib/format";
import {
  parseItens,
  parseLotesSelecionados,
  parseColunasExtras,
  aplicarDesconto,
  CAMPOS_EXTRAS_CATALOGO,
  type ChaveCampoExtra,
  type ItemPropostaComDesconto,
} from "@/lib/proposal";

// Anexo de proposta comercial costuma vir perto do fim do edital, junto de outros
// modelos — mesmo motivo de PALAVRAS_CHAVE_ANEXOS em agente4-advogado.ts: sem essas
// palavras-chave, o corte por tamanho manteria só o começo do documento.
const PALAVRAS_CHAVE_PROPOSTA_COMERCIAL = [
  "anexo",
  "modelo de proposta",
  "proposta de preços",
  "proposta comercial",
  "declaro",
  "responsável legal",
  "validade da proposta",
  "assinatura",
];

type ModeloPropostaResult = {
  modeloEncontrado: boolean;
  titulo: string;
  paragrafos: string[];
};

function montarColunasTabela(colunasExtras: ChaveCampoExtra[]): { label: string; largura: number }[] {
  const base = [
    { label: "Nº", largura: 24 },
    { label: "Descrição", largura: 170 },
    { label: "Unid.", largura: 34 },
    { label: "Qtd.", largura: 40 },
    { label: "Valor unit.", largura: 62 },
    { label: "Valor total", largura: 62 },
  ];
  const extras = colunasExtras.map((chave) => ({ label: CAMPOS_EXTRAS_CATALOGO[chave].label, largura: 65 }));
  return [...base, ...extras];
}

function montarLinhasTabela(itens: ItemPropostaComDesconto[], colunasExtras: ChaveCampoExtra[]): string[][] {
  return itens.map((item) => [
    item.numero != null ? String(item.numero) : "-",
    item.descricao,
    item.unidade,
    String(item.quantidade),
    formatBRL(item.valorUnitarioComDesconto),
    formatBRL(item.valorTotalComDesconto),
    ...colunasExtras.map((chave) => {
      const v = item.camposExtras?.[chave];
      return v == null || v === "" ? "-" : String(v);
    }),
  ]);
}

/** Usado quando o edital não especifica um modelo de proposta obrigatório — cabeçalho
 * timbrado + declaração padrão de que os preços incluem todos os custos + validade. */
function montarTemplatePadrao(
  edital: { titulo: string; orgaoNome: string },
  descontoPercentual: number,
  somaComDesconto: number
): { titulo: string; paragrafos: string[] } {
  return {
    titulo: "Proposta Comercial",
    paragrafos: [
      `Apresentamos, para o edital "${edital.titulo}" (${edital.orgaoNome}), nossa proposta comercial conforme detalhamento de itens a seguir.`,
      `O valor global da proposta é de ${formatBRL(somaComDesconto)}${
        descontoPercentual > 0 ? `, já considerando o desconto de ${descontoPercentual}% aplicado sobre os valores unitários` : ""
      }.`,
      "Os preços apresentados incluem todos os custos diretos e indiretos necessários à perfeita execução do objeto, tais como tributos, encargos sociais e trabalhistas, fretes, seguros e demais despesas incidentes, não cabendo qualquer acréscimo posterior.",
      "Esta proposta tem validade de 60 (sessenta) dias corridos, contados da data de abertura da sessão pública, conforme exigido em lei.",
    ],
  };
}

async function buscarModeloDoEdital(
  editalId: string,
  edital: { titulo: string; orgaoNome: string },
  company: { razaoSocial: string; cnpj: string; socioNome: string; socioCpf: string },
  somaComDesconto: number,
  descontoPercentual: number
): Promise<ModeloPropostaResult | null> {
  const { textoEdital, textoTermoReferencia, temTextoCompleto } = await obterTextoCompletoEdital(editalId, {
    palavrasChave: PALAVRAS_CHAVE_PROPOSTA_COMERCIAL,
    tamanhoMax: 45_000,
  });
  if (!temTextoCompleto) return null;

  const contexto = `
Edital: ${edital.titulo} — ${edital.orgaoNome}

Empresa proponente:
Razão social: ${company.razaoSocial}
CNPJ: ${company.cnpj}
Sócio/responsável legal: ${company.socioNome} (CPF ${company.socioCpf})

Valor global da proposta (já com desconto de ${descontoPercentual}% aplicado): ${formatBRL(somaComDesconto)}
${textoEdital ? `\n=== TEXTO COMPLETO DO EDITAL ===\n${textoEdital}` : ""}
${textoTermoReferencia ? `\n=== TEXTO COMPLETO DO TERMO DE REFERÊNCIA ===\n${textoTermoReferencia}` : ""}
`.trim();

  try {
    return await askJSON<ModeloPropostaResult>(
      `Você é o agente financeiro de uma empresa respondendo a uma licitação pública brasileira (Lei 14.133/2021).
Procure, no texto do edital acima, um MODELO DE PROPOSTA COMERCIAL/DE PREÇOS pronto — geralmente um anexo chamado
algo como "ANEXO ... MODELO DE PROPOSTA", "PROPOSTA DE PREÇOS" ou "PROPOSTA COMERCIAL" — que a empresa deveria
preencher e apresentar. NÃO é a tabela de itens/preços em si (ela já foi extraída à parte e é inserida
separadamente) — é o texto declarativo/formal AO REDOR dela: cabeçalho, declarações padrão (ex: "declaramos que os
preços incluem..."), prazo de validade da proposta, local/data, assinatura.

Se encontrar um modelo assim, siga estas regras à risca (documento oficial entregue ao órgão público — a EXATIDÃO
do texto original importa mais que qualquer outra coisa):
1. Reproduza o texto do modelo EXATAMENTE como está no edital — mesma ordem de frases, mesma pontuação, mesma
numeração, mesmo estilo de linguagem. NÃO resuma, NÃO reformule, NÃO corrija nada.
2. Preencha SOMENTE as lacunas do modelo (razão social, CNPJ, valor, validade, responsável legal, local/data) com
os dados fornecidos acima — nunca invente um dado que você não tem com certeza.
3. NÃO inclua a tabela de itens dentro dos parágrafos — ela é inserida automaticamente depois, à parte. Se o
modelo tiver um marcador do tipo "[inserir tabela de itens]" ou similar, pode omitir esse trecho.
4. Divida o resultado em "paragrafos" seguindo os próprios parágrafos/itens do modelo original, na mesma ordem.

Se não encontrar NENHUM modelo de proposta comercial reproduzível no texto, retorne "modeloEncontrado": false —
nunca invente um modelo que não está no edital.

Responda em JSON:
{ "modeloEncontrado": boolean, "titulo": string (nome do anexo como aparece no edital), "paragrafos": string[] }`,
      contexto,
      { model: MODELO_HAIKU, maxTokens: 4000 }
    );
  } catch (err) {
    console.error(`Falha ao buscar modelo de proposta comercial no edital ${editalId}:`, err);
    return null;
  }
}

/**
 * Gera o anexo final de proposta comercial (PDF + DOCX) a partir da proposta já
 * confirmada pelo usuário — segue o modelo literal encontrado no texto do edital quando
 * existe (mesmo rigor de agente4-advogado.ts), ou um template próprio quando o edital
 * não especifica um. A tabela de itens nunca é gerada pela IA: é montada 100% em código
 * a partir dos itens dos lotes selecionados, para nunca haver um número inventado nela.
 * Disparado só por ação explícita do usuário (botão na aba Financeiro), nunca automático.
 */
export async function gerarAnexoPropostaComercial(editalId: string) {
  const edital = await prisma.edital.findUniqueOrThrow({ where: { id: editalId }, include: { company: true } });
  const proposal = await prisma.proposal.findUnique({ where: { editalId } });
  if (!proposal) throw new Error("Este edital ainda não tem uma proposta financeira montada.");

  const todosItens = parseItens(proposal.itensJson);
  const lotesSelecionados = parseLotesSelecionados(proposal.lotesSelecionadosJson);
  const colunasExtras = parseColunasExtras(proposal.colunasExtrasJson);

  // null = todos os lotes selecionados (comportamento padrão); itens sem lote (a
  // maioria dos editais) sempre entram, independente da seleção de lote.
  const itensFiltrados = lotesSelecionados
    ? todosItens.filter((it) => !it.lote || lotesSelecionados.includes(it.lote))
    : todosItens;
  if (itensFiltrados.length === 0) {
    throw new Error("Nenhum item selecionado para incluir no anexo — confira os lotes marcados na aba Financeiro.");
  }

  const itensComDesconto = aplicarDesconto(itensFiltrados, proposal.descontoPercentual);
  const somaComDesconto = itensComDesconto.reduce((acc, i) => acc + i.valorTotalComDesconto, 0);

  const modelo = await buscarModeloDoEdital(
    editalId,
    edital,
    edital.company,
    somaComDesconto,
    proposal.descontoPercentual
  );
  const usouModeloDoEdital = !!modelo?.modeloEncontrado && modelo.paragrafos.length > 0;

  const { titulo, paragrafos } = usouModeloDoEdital
    ? { titulo: modelo!.titulo?.trim() || "Proposta Comercial", paragrafos: modelo!.paragrafos }
    : montarTemplatePadrao(edital, proposal.descontoPercentual, somaComDesconto);

  const colunasPdf = montarColunasTabela(colunasExtras);
  const linhas = montarLinhasTabela(itensComDesconto, colunasExtras);
  const rodapeExtra = usouModeloDoEdital
    ? `Modelo extraído do texto do edital "${edital.titulo}" — ${edital.orgaoNome} — e preenchido automaticamente pela Bidd.IA. Confira os dados preenchidos e o texto original antes do envio.`
    : `Edital não especificou um modelo obrigatório de proposta comercial — anexo gerado com modelo próprio da Bidd.IA. Confira os dados antes do envio.`;

  const [pdfBytes, docxBytes] = await Promise.all([
    gerarPdfTimbrado({ company: edital.company, titulo, paragrafos, tabela: { colunas: colunasPdf, linhas }, rodapeExtra }),
    gerarDocxTimbrado({
      company: edital.company,
      titulo,
      paragrafos,
      tabela: { colunas: colunasPdf.map((c) => ({ label: c.label })), linhas },
      rodapeExtra,
    }),
  ]);

  const nomeBase = `Proposta Comercial - ${edital.titulo}`.replace(/[^a-zA-Z0-9-_ ]/g, "").trim().slice(0, 80);

  const [docPdf, docDocx] = await Promise.all([
    prisma.document.create({
      data: {
        editalId,
        nome: `${nomeBase}.pdf`,
        tipo: "ANEXO_GERADO",
        categoria: "PROPOSTA_COMERCIAL",
        status: "GERADO",
        conteudoBase64: bytesToDataUrl(pdfBytes),
      },
    }),
    prisma.document.create({
      data: {
        editalId,
        nome: `${nomeBase}.docx`,
        tipo: "ANEXO_GERADO",
        categoria: "PROPOSTA_COMERCIAL",
        status: "GERADO",
        conteudoBase64: bytesToDocxDataUrl(docxBytes),
      },
    }),
  ]);

  await logAudit(
    editalId,
    "Agente Financeiro",
    "Anexo de proposta comercial",
    "OK",
    usouModeloDoEdital
      ? `Anexo gerado seguindo o modelo de proposta comercial encontrado no próprio edital, com ${itensComDesconto.length} item(ns)${lotesSelecionados ? " (lotes selecionados)" : ""}, somando ${formatBRL(somaComDesconto)}.`
      : `Edital não especificou um modelo obrigatório de proposta comercial (modelo próprio) — anexo gerado com ${itensComDesconto.length} item(ns)${lotesSelecionados ? " (lotes selecionados)" : ""}, somando ${formatBRL(somaComDesconto)}.`
  );

  return [docPdf, docDocx];
}
