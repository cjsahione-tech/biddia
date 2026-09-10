import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  searchEditaisPorPalavraChave,
  linkPortalCompra,
  buscarDetalheCompra,
  buscarArquivosCompra,
  selecionarDocumentosPrincipais,
  baixarArquivoPncp,
  parseItemUrl,
  type PncpSearchItem,
  type PncpArquivo,
} from "@/lib/agents/pncp";
import { classificarTipoObjeto, empresaAtende, type TipoObjeto } from "@/lib/agents/classificador-objeto";
import { classificarEditaisEmLote } from "@/lib/agents/relevancia";
import { askJSON } from "@/lib/anthropic";
import { extrairTextoPdf, base64ParaBytes } from "@/lib/agents/pdf-extract";
import { logAudit } from "@/lib/agents/run-tracker";
import { mapComLimite } from "@/lib/concorrencia";

// Quantos editais trazer por palavra-chave, na ordem do PNCP (última atualização
// primeiro) — o mesmo recorte que o site do PNCP mostra nas primeiras páginas.
const MAX_POR_PALAVRA_CHAVE = 100;

/**
 * Baixa (em segundo plano) os PDFs de editais já captados que ainda estão só com o
 * link de origem. Roda depois da resposta da busca, para não deixar o usuário esperando
 * dezenas de downloads — e também é acionado na aprovação de um edital, garantindo que
 * o texto esteja disponível para os agentes mesmo se o download em background não tiver
 * terminado.
 */
export async function baixarDocumentosPendentes(editalIds: string[]) {
  if (editalIds.length === 0) return;
  const docs = await prisma.document.findMany({
    where: {
      editalId: { in: editalIds },
      tipo: "DOCUMENTO_PNCP",
      conteudoBase64: null,
      origemUrl: { not: null },
    },
  });

  await mapComLimite(docs, 6, async (doc) => {
    const arquivo = await baixarArquivoPncp(doc.origemUrl!).catch(() => null);
    if (!arquivo) return;
    await prisma.document
      .update({
        where: { id: doc.id },
        data: {
          conteudoBase64: `data:${arquivo.contentType};base64,${Buffer.from(arquivo.bytes).toString("base64")}`,
        },
      })
      .catch((err) => console.error(`Falha ao salvar PDF baixado do documento ${doc.id}:`, err));
  });
}

/**
 * Agente Comercial: varre o PNCP com as palavras-chave da empresa e replica na
 * plataforma as oportunidades da busca, na mesma ordem do site do PNCP. Não lista
 * editais cujo tipo (compra de bem x prestação de serviço) não bate com o que a
 * empresa declarou atender no cadastro, nem os que a IA considera sem relação direta
 * com o objeto social.
 */
export async function executarAgente1(companyId: string) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    include: { keywords: true },
  });
  if (!company) throw new Error("Empresa não encontrada");
  if (company.keywords.length === 0) {
    return { novos: 0, analisados: 0, mensagem: "Nenhuma palavra-chave cadastrada." };
  }

  // 1. Busca no PNCP, preservando a ordem de cada busca (última atualização primeiro).
  let falhas = 0;
  const vistos = new Set<string>();
  const candidatos: { item: PncpSearchItem; keyword: string }[] = [];
  for (const kw of company.keywords) {
    let items: PncpSearchItem[];
    try {
      items = await searchEditaisPorPalavraChave(kw.term, MAX_POR_PALAVRA_CHAVE);
    } catch (err) {
      console.error(`Agente Comercial: falha ao buscar "${kw.term}" no PNCP:`, err);
      falhas++;
      continue;
    }
    for (const item of items) {
      if (vistos.has(item.numero_controle_pncp)) continue;
      vistos.add(item.numero_controle_pncp);
      candidatos.push({ item, keyword: kw.term });
    }
  }

  if (falhas === company.keywords.length) {
    return {
      novos: 0,
      analisados: 0,
      mensagem: "O PNCP está indisponível no momento. Tente buscar novamente em alguns instantes.",
    };
  }

  const analisados = candidatos.length;

  // 2. Descarta os que já estão na plataforma.
  const jaExistentes = new Set(
    (
      await prisma.edital.findMany({
        where: {
          companyId: company.id,
          numeroControlePNCP: { in: candidatos.map((c) => c.item.numero_controle_pncp) },
        },
        select: { numeroControlePNCP: true },
      })
    ).map((e) => e.numeroControlePNCP)
  );
  const novosCandidatos = candidatos.filter((c) => !jaExistentes.has(c.item.numero_controle_pncp));

  // 3. Classifica em lote (relevância + tipo do objeto) com IA.
  const classificacoes = await classificarEditaisEmLote(
    company.objetoSocial,
    novosCandidatos.map((c) => ({
      numeroControle: c.item.numero_controle_pncp,
      titulo: c.item.title,
      descricao: c.item.description || "",
    }))
  );

  // 4. Filtra: precisa ser relevante E do tipo que a empresa atende.
  let descartadosPerfil = 0;
  let descartadosRelevancia = 0;
  const aprovados = novosCandidatos.filter((c) => {
    const cl = classificacoes.get(c.item.numero_controle_pncp);
    if (!cl) return true;
    if (!cl.relevante) {
      descartadosRelevancia++;
      return false;
    }
    if (!empresaAtende(cl.tipoObjeto, company)) {
      descartadosPerfil++;
      return false;
    }
    return true;
  });

  // 5. Para os aprovados: busca valor/sigilo e a lista de arquivos, e cria o edital +
  // os registros de documento (o download dos PDFs em si fica para o passo 6).
  const criadosIds: string[] = [];
  await mapComLimite(aprovados, 8, async (c) => {
    const item = c.item;
    const cl = classificacoes.get(item.numero_controle_pncp);
    const descricao = item.description || "(sem descrição disponível)";
    const { cnpj, ano, sequencial } = parseItemUrl(item.item_url);

    let valorGlobal: number | null = item.valor_global;
    let orcamentoSigiloso = false;
    let arquivos: PncpArquivo[] = [];
    if (cnpj && ano && sequencial) {
      const [detalhe, arqs] = await Promise.all([
        buscarDetalheCompra(cnpj, ano, sequencial).catch(() => null),
        buscarArquivosCompra(cnpj, ano, sequencial).catch(() => [] as PncpArquivo[]),
      ]);
      arquivos = arqs;
      if (detalhe) {
        orcamentoSigiloso = !!detalhe.indicadorOrcamentoSigiloso;
        if (!orcamentoSigiloso && detalhe.valorTotalEstimado != null) valorGlobal = detalhe.valorTotalEstimado;
        if (orcamentoSigiloso) valorGlobal = null;
      }
    }

    const edital = await prisma.edital
      .create({
        data: {
          companyId: company.id,
          numeroControlePNCP: item.numero_controle_pncp,
          titulo: item.title,
          descricao,
          tipoObjeto: cl?.tipoObjeto ?? classificarTipoObjeto(item.title, descricao),
          orgaoNome: item.orgao_nome,
          orgaoCnpj: item.orgao_cnpj,
          municipio: item.municipio_nome,
          uf: item.uf,
          modalidade: item.modalidade_licitacao_nome,
          situacao: item.situacao_nome,
          dataPublicacao: item.data_publicacao_pncp ? new Date(item.data_publicacao_pncp) : null,
          dataAtualizacaoPncp: item.data_atualizacao_pncp ? new Date(item.data_atualizacao_pncp) : null,
          dataAberturaProposta: item.data_inicio_vigencia ? new Date(item.data_inicio_vigencia) : null,
          dataEncerramentoProposta: item.data_fim_vigencia ? new Date(item.data_fim_vigencia) : null,
          valorGlobal,
          orcamentoSigiloso,
          linkPortal: linkPortalCompra(item.item_url),
          keywordMatched: c.keyword,
        },
      })
      .catch((err) => {
        // Corrida rara: dois cliques em "Buscar" quase juntos podem tentar criar o
        // mesmo edital — a chave única cuida disso, aqui só ignoramos.
        console.error(`Falha ao criar edital ${item.numero_controle_pncp}:`, err);
        return null;
      });
    if (!edital) return;
    criadosIds.push(edital.id);

    const { edital: docEdital, termoReferencia, anexosPrecos } = selecionarDocumentosPrincipais(arquivos);
    const docs: { doc: PncpArquivo; categoria: "EDITAL" | "TERMO_REFERENCIA" | "ANEXO_PRECOS" }[] = [];
    if (docEdital) docs.push({ doc: docEdital, categoria: "EDITAL" });
    if (termoReferencia) docs.push({ doc: termoReferencia, categoria: "TERMO_REFERENCIA" });
    for (const d of anexosPrecos) docs.push({ doc: d, categoria: "ANEXO_PRECOS" });

    for (const { doc, categoria } of docs) {
      await prisma.document.create({
        data: {
          editalId: edital.id,
          nome: doc.titulo,
          tipo: "DOCUMENTO_PNCP",
          categoria,
          status: "DISPONIVEL",
          origemUrl: doc.url,
          conteudoBase64: null,
        },
      });
    }
  });

  // 6. Baixa os PDFs em segundo plano — o usuário já vê os editais na lista sem esperar.
  if (criadosIds.length > 0) {
    const ids = [...criadosIds];
    after(() => baixarDocumentosPendentes(ids));
  }

  const partes = [`${criadosIds.length} novo(s) edital(is) captado(s) do PNCP.`];
  const descartados = descartadosPerfil + descartadosRelevancia;
  if (descartados > 0) {
    partes.push(
      `${descartados} não listado(s): ${descartadosPerfil} fora do tipo que a empresa atende, ${descartadosRelevancia} sem relação direta com o objeto social.`
    );
  }
  if (falhas > 0) partes.push(`${falhas} palavra-chave indisponível no PNCP no momento.`);

  return {
    novos: criadosIds.length,
    analisados,
    descartadosPerfil,
    descartadosRelevancia,
    mensagem: partes.join(" "),
  };
}

type DadosExtraidosDoPdf = {
  titulo: string | null;
  descricao: string | null;
  orgaoNome: string | null;
  orgaoCnpj: string | null;
  municipio: string | null;
  uf: string | null;
  modalidade: string | null;
  tipoObjeto: TipoObjeto;
  valorGlobal: number | null;
  orcamentoSigiloso: boolean;
  dataEncerramentoProposta: string | null;
};

const DADOS_VAZIOS: DadosExtraidosDoPdf = {
  titulo: null,
  descricao: null,
  orgaoNome: null,
  orgaoCnpj: null,
  municipio: null,
  uf: null,
  modalidade: null,
  tipoObjeto: null,
  valorGlobal: null,
  orcamentoSigiloso: false,
  dataEncerramentoProposta: null,
};

async function extrairDadosDoEdital(texto: string): Promise<DadosExtraidosDoPdf> {
  try {
    return await askJSON<DadosExtraidosDoPdf>(
      `Você lê o texto extraído de um PDF de edital/aviso de licitação pública brasileira e extrai dados
estruturados dele. Use APENAS o que estiver explícito no texto — quando um dado não aparecer, retorne null
para ele em vez de adivinhar.

Retorne um objeto JSON com exatamente estas chaves:
{
  "titulo": string ou null (título/objeto resumido da licitação, ex: "Pregão Eletrônico nº 12/2026 — Aquisição de..."),
  "descricao": string ou null (descrição do objeto em 1-2 frases),
  "orgaoNome": string ou null (nome do órgão/entidade licitante),
  "orgaoCnpj": string ou null (CNPJ do órgão licitante, só dígitos e pontuação como aparecer no texto),
  "municipio": string ou null,
  "uf": string ou null (sigla de 2 letras),
  "modalidade": string ou null (ex: "Pregão Eletrônico", "Concorrência", "Dispensa de Licitação"),
  "tipoObjeto": "SERVICO" | "BEM" | null (se o objeto principal é contratação de serviço ou aquisição de bem/insumo; null se não der para saber ou for misto),
  "valorGlobal": number ou null (valor total estimado em reais, sem "R$" nem separadores; null se sigiloso ou não informado),
  "orcamentoSigiloso": boolean (true se o texto disser explicitamente que o orçamento é sigiloso),
  "dataEncerramentoProposta": string ou null (data-limite para envio de propostas, em ISO 8601, se encontrada)
}`,
      texto,
      { maxTokens: 1500 }
    );
  } catch (err) {
    console.error("Falha ao extrair dados estruturados do edital enviado manualmente:", err);
    return DADOS_VAZIOS;
  }
}

/**
 * Captação manual: o usuário já encontrou o edital por conta própria (em qualquer
 * portal) e envia o PDF direto pela plataforma. O Agente Comercial extrai o texto e os
 * dados estruturados do próprio arquivo — sem depender do PNCP — e aprova o edital na
 * hora, já que a escolha de participar foi feita pelo usuário ao enviar o documento.
 * A partir daí o restante do pipeline (Analista, Financeiro, Advogado, Secretário,
 * Auditor) roda automaticamente, do mesmo jeito que roda para um edital aprovado vindo
 * da busca automática.
 */
export async function capturarEditalManual(
  companyId: string,
  input: { nomeArquivo: string; arquivoBase64: string }
) {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });

  const bytes = base64ParaBytes(input.arquivoBase64);
  const texto = await extrairTextoPdf(bytes);
  if (!texto) {
    throw new Error(
      "Não foi possível ler texto neste PDF. Verifique se não é um arquivo digitalizado apenas como imagem (sem texto selecionável)."
    );
  }

  const dados = await extrairDadosDoEdital(texto.slice(0, 35_000));
  const tituloFallback = input.nomeArquivo.replace(/\.pdf$/i, "").trim() || "Edital enviado manualmente";
  const titulo = dados.titulo?.trim() || tituloFallback;
  const descricao = dados.descricao?.trim() || "Edital enviado manualmente pelo usuário — objeto ainda não identificado automaticamente.";

  const edital = await prisma.edital.create({
    data: {
      companyId: company.id,
      fonte: "MANUAL",
      // Não existe número de controle PNCP para um edital captado manualmente; gera um
      // identificador interno só para satisfazer a chave única da tabela.
      numeroControlePNCP: `MANUAL-${randomUUID()}`,
      titulo,
      descricao,
      tipoObjeto: dados.tipoObjeto ?? classificarTipoObjeto(titulo, descricao),
      orgaoNome: dados.orgaoNome?.trim() || "Não informado no PDF enviado",
      orgaoCnpj: dados.orgaoCnpj?.trim() || "Não informado",
      municipio: dados.municipio?.trim() || null,
      uf: dados.uf?.trim() || null,
      modalidade: dados.modalidade?.trim() || null,
      dataEncerramentoProposta: dados.dataEncerramentoProposta ? new Date(dados.dataEncerramentoProposta) : null,
      valorGlobal: dados.orcamentoSigiloso ? null : dados.valorGlobal,
      orcamentoSigiloso: dados.orcamentoSigiloso,
      linkPortal: "",
      status: "APROVADO",
      decidedAt: new Date(),
    },
  });

  await prisma.document.create({
    data: {
      editalId: edital.id,
      nome: input.nomeArquivo || "Edital.pdf",
      tipo: "DOCUMENTO_USUARIO",
      categoria: "EDITAL",
      status: "DISPONIVEL",
      conteudoBase64: input.arquivoBase64,
    },
  });

  await logAudit(
    edital.id,
    "Agente Comercial",
    "Captação manual",
    "OK",
    `Edital adicionado manualmente pelo usuário a partir do arquivo "${input.nomeArquivo}". Aprovado automaticamente — o restante do pipeline (análise, proposta, anexos, checklist e auditoria) foi disparado em seguida.`
  );

  return edital;
}
