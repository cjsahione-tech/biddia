import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import {
  searchEditaisPorPalavraChave,
  linkPortalCompra,
  buscarDetalheCompra,
  buscarArquivosCompra,
  selecionarDocumentosPrincipais,
  parseItemUrl,
  type PncpSearchItem,
  type PncpArquivo,
} from "@/lib/agents/pncp";
import {
  buscarPublicacoesLicitaNet,
  parseDataBr,
  linkBoletimSegmento,
  type LicitaNetPublication,
} from "@/lib/agents/licitanet";
import { classificarTipoObjeto, empresaAtende, type TipoObjeto } from "@/lib/agents/classificador-objeto";
import { classificarEditaisEmLote } from "@/lib/agents/relevancia";
import { askJSON, MODELO_HAIKU } from "@/lib/anthropic";
import { extrairTextoPdf, base64ParaBytes } from "@/lib/agents/pdf-extract";
import { baixarAnexo } from "@/lib/storage";
import { baixarEPersistirDocumento } from "@/lib/agents/document-download";
import { logAudit } from "@/lib/agents/run-tracker";
import { houveRetificacao } from "@/lib/edital-retificacao";
import { mapComLimite } from "@/lib/concorrencia";

// Quantos editais trazer por palavra-chave (PNCP) ou por segmento (LicitaNet), na ordem
// de cada fonte — o mesmo recorte que os sites de origem mostram nas primeiras páginas.
const MAX_POR_PALAVRA_CHAVE = 100;
const MAX_POR_SEGMENTO_LICITANET = 100;

/**
 * Baixa (com retry — ver baixarArquivoPncp/baixarArquivoLicitaNet) e persiste os
 * documentos ainda pendentes de um ou mais editais. Nunca lança: falhas (mesmo após as
 * tentativas) são agrupadas por edital e registradas com UM logAudit por edital ao
 * final, em vez de seguirem em silêncio — quem chama esta função sempre roda ANTES de
 * qualquer análise por IA (ver dispararPipeline em pipeline.ts), então esse log já
 * garante que uma análise feita sem o PDF completo fica visível no histórico do edital.
 */
export async function baixarDocumentosPendentes(editalIds: string[]) {
  if (editalIds.length === 0) return;
  const docs = await prisma.document.findMany({
    where: {
      editalId: { in: editalIds },
      tipo: { in: ["DOCUMENTO_PNCP", "DOCUMENTO_LICITANET"] },
      conteudoBase64: null,
      storagePath: null,
      origemUrl: { not: null },
    },
    include: { edital: { select: { companyId: true } } },
  });

  const falhasPorEdital = new Map<string, string[]>();
  await mapComLimite(docs, 6, async (doc) => {
    try {
      await baixarEPersistirDocumento(
        { id: doc.id, editalId: doc.editalId, nome: doc.nome, tipo: doc.tipo, origemUrl: doc.origemUrl! },
        doc.edital.companyId
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "erro desconhecido";
      console.error(`Falha ao baixar documento ${doc.id} (edital ${doc.editalId}):`, err);
      const lista = falhasPorEdital.get(doc.editalId) ?? [];
      lista.push(`${doc.nome}: ${msg}`);
      falhasPorEdital.set(doc.editalId, lista);
    }
  });

  for (const [editalId, falhas] of falhasPorEdital) {
    await logAudit(
      editalId,
      "Agente Comercial",
      "Download de anexos",
      "ALERTA",
      `${falhas.length} anexo(s) não puderam ser baixados mesmo após tentar de novo: ${falhas.join("; ")}. A análise pode ter sido feita sem o conteúdo completo desses arquivos.`
    );
  }
}

type CandidatoPncp = { fonte: "PNCP"; numeroControle: string; titulo: string; descricao: string; item: PncpSearchItem; keyword: string };
type CandidatoLicitaNet = { fonte: "LICITANET"; numeroControle: string; titulo: string; descricao: string; item: LicitaNetPublication };
type Candidato = CandidatoPncp | CandidatoLicitaNet;

function tituloLicitaNet(item: LicitaNetPublication): string {
  return `${item.disputeModeText ?? "Licitação"} nº ${item.biddingProcess}`;
}

/**
 * Agente Comercial: varre o PNCP com as palavras-chave da empresa e o LicitaNet com o
 * segmento cadastrado da empresa, e replica na plataforma as oportunidades encontradas.
 * Não lista editais cujo tipo (compra de bem x prestação de serviço) não bate com o que
 * a empresa declarou atender no cadastro, nem os que a IA considera sem relação direta
 * com o objeto social.
 */
export async function executarAgente1(companyId: string) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    include: { keywords: true },
  });
  if (!company) throw new Error("Empresa não encontrada");
  if (company.keywords.length === 0 && !company.licitanetSegmentoId) {
    return {
      novos: 0,
      analisados: 0,
      mensagem: "Nenhuma palavra-chave (PNCP) nem segmento LicitaNet cadastrados.",
    };
  }

  // 1a. Busca no PNCP, preservando a ordem de cada busca (última atualização primeiro).
  let falhasPncp = 0;
  const vistos = new Set<string>();
  const candidatos: Candidato[] = [];
  for (const kw of company.keywords) {
    let items: PncpSearchItem[];
    try {
      items = await searchEditaisPorPalavraChave(kw.term, MAX_POR_PALAVRA_CHAVE);
    } catch (err) {
      console.error(`Agente Comercial: falha ao buscar "${kw.term}" no PNCP:`, err);
      falhasPncp++;
      continue;
    }
    for (const item of items) {
      if (vistos.has(item.numero_controle_pncp)) continue;
      vistos.add(item.numero_controle_pncp);
      candidatos.push({
        fonte: "PNCP",
        numeroControle: item.numero_controle_pncp,
        titulo: item.title,
        descricao: item.description || "",
        item,
        keyword: kw.term,
      });
    }
  }

  // 1b. Busca no LicitaNet pelo segmento cadastrado da empresa — fonte independente do
  // PNCP, então uma falha aqui não impede o restante da busca (e vice-versa).
  let falhaLicitaNet: string | null = null;
  if (company.licitanetSegmentoId) {
    try {
      const publicacoes = await buscarPublicacoesLicitaNet(company.licitanetSegmentoId, MAX_POR_SEGMENTO_LICITANET);
      for (const item of publicacoes) {
        const numeroControle = `LICITANET-${item.identifier}`;
        if (vistos.has(numeroControle)) continue;
        vistos.add(numeroControle);
        candidatos.push({
          fonte: "LICITANET",
          numeroControle,
          titulo: tituloLicitaNet(item),
          descricao: item.description || "",
          item,
        });
      }
    } catch (err) {
      console.error(`Agente Comercial: falha ao buscar no LicitaNet (segmento ${company.licitanetSegmentoId}):`, err);
      falhaLicitaNet = err instanceof Error ? err.message : "erro desconhecido";
    }
  }

  const analisados = candidatos.length;

  // 2. Descarta os que já estão na plataforma ou que o usuário já excluiu antes (o card
  // saiu do quadro, mas a chave fica registrada em EditalExcluido pra não voltar).
  const [jaExistentesRows, jaExcluidosRows] = await Promise.all([
    prisma.edital.findMany({
      where: {
        companyId: company.id,
        numeroControlePNCP: { in: candidatos.map((c) => c.numeroControle) },
      },
      select: { id: true, numeroControlePNCP: true, dataAtualizacaoPncp: true },
    }),
    prisma.editalExcluido.findMany({
      where: {
        companyId: company.id,
        numeroControlePNCP: { in: candidatos.map((c) => c.numeroControle) },
      },
      select: { numeroControlePNCP: true },
    }),
  ]);
  const jaExistentesPorChave = new Map(jaExistentesRows.map((e) => [e.numeroControlePNCP, e]));
  const jaExistentes = new Set(jaExistentesRows.map((e) => e.numeroControlePNCP));
  const jaExcluidos = new Set(jaExcluidosRows.map((e) => e.numeroControlePNCP));
  const novosCandidatos = candidatos.filter(
    (c) => !jaExistentes.has(c.numeroControle) && !jaExcluidos.has(c.numeroControle)
  );

  // 2b. Para editais do PNCP já capturados antes: o próprio PNCP marca
  // data_atualizacao_pncp toda vez que o órgão retifica a contratação — se essa data
  // avançou desde a última captura, é uma retificação real (novo anexo, mudança de
  // data/valor). Atualiza os campos que o PNCP já manda de graça na própria busca (sem
  // gastar as chamadas extras de detalhe/arquivos) e reseta "visualizado" pro usuário
  // saber que precisa revisar de novo.
  let retificados = 0;
  await mapComLimite(
    candidatos.filter((c): c is CandidatoPncp => c.fonte === "PNCP" && jaExistentes.has(c.numeroControle)),
    8,
    async (c) => {
      const existente = jaExistentesPorChave.get(c.numeroControle);
      if (!existente) return;
      const item = c.item;
      const novaData = item.data_atualizacao_pncp ? new Date(item.data_atualizacao_pncp) : null;
      if (!houveRetificacao(existente.dataAtualizacaoPncp, novaData)) return;

      await prisma.edital.update({
        where: { id: existente.id },
        data: {
          titulo: item.title,
          descricao: item.description || "(sem descrição disponível)",
          valorGlobal: item.valor_global,
          dataAtualizacaoPncp: novaData,
          dataAberturaProposta: item.data_inicio_vigencia ? new Date(item.data_inicio_vigencia) : null,
          dataEncerramentoProposta: item.data_fim_vigencia ? new Date(item.data_fim_vigencia) : null,
          visualizado: false,
          visualizadoEm: null,
          ultimaMovimentacao: new Date(),
        },
      });
      await logAudit(
        existente.id,
        "Agente Comercial",
        "Retificação detectada",
        "ALERTA",
        "O órgão atualizou este edital no PNCP desde a última captura (data/valor/anexo pode ter mudado) — revise antes de prosseguir."
      );
      retificados++;
    }
  );

  // 3. Classifica em lote (relevância + tipo do objeto) com IA — mesmo pipeline para as
  // duas fontes, já que ambas chegam normalizadas em {numeroControle, titulo, descricao}.
  const classificacoes = await classificarEditaisEmLote(
    company.objetoSocial,
    novosCandidatos.map((c) => ({ numeroControle: c.numeroControle, titulo: c.titulo, descricao: c.descricao }))
  );

  // 4. Filtra: precisa ser relevante E do tipo que a empresa atende.
  let descartadosPerfil = 0;
  let descartadosRelevancia = 0;
  const aprovados = novosCandidatos.filter((c) => {
    const cl = classificacoes.get(c.numeroControle);
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

  // 5. Para os aprovados: monta o edital + os registros de documento (o download dos
  // arquivos em si fica para o passo 6). PNCP precisa de duas chamadas extras (valor e
  // lista de arquivos); o LicitaNet já traz tudo na própria busca.
  const criadosIds: string[] = [];
  let criadosPncp = 0;
  let criadosLicitaNet = 0;
  await mapComLimite(aprovados, 8, async (c) => {
    const cl = classificacoes.get(c.numeroControle);
    const tipoObjeto = cl?.tipoObjeto ?? classificarTipoObjeto(c.titulo, c.descricao);

    let dadosCriacao: Parameters<typeof prisma.edital.create>[0]["data"];
    let documentosParaCriar: { nome: string; origemUrl: string; categoria: "EDITAL" | "TERMO_REFERENCIA" | "ANEXO_PRECOS" | null }[];

    if (c.fonte === "PNCP") {
      const item = c.item;
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

      const { edital: docEdital, termoReferencia, anexosPrecos } = selecionarDocumentosPrincipais(arquivos);
      documentosParaCriar = [];
      if (docEdital) documentosParaCriar.push({ nome: docEdital.titulo, origemUrl: docEdital.url, categoria: "EDITAL" });
      if (termoReferencia) documentosParaCriar.push({ nome: termoReferencia.titulo, origemUrl: termoReferencia.url, categoria: "TERMO_REFERENCIA" });
      for (const a of anexosPrecos) documentosParaCriar.push({ nome: a.titulo, origemUrl: a.url, categoria: "ANEXO_PRECOS" });

      dadosCriacao = {
        companyId: company.id,
        numeroControlePNCP: item.numero_controle_pncp,
        titulo: item.title,
        descricao,
        tipoObjeto,
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
        ordemKanban: Date.now(),
      };
    } else {
      const item = c.item;
      documentosParaCriar = [
        ...item.notices.map((n) => ({ nome: n.name, origemUrl: n.link, categoria: "EDITAL" as const })),
        ...item.files.map((f) => ({ nome: f.name, origemUrl: f.link, categoria: null })),
      ];

      dadosCriacao = {
        companyId: company.id,
        fonte: "LICITANET",
        numeroControlePNCP: c.numeroControle,
        titulo: c.titulo,
        descricao: c.descricao || "(sem descrição disponível)",
        tipoObjeto,
        orgaoNome: item.buyer.trim(),
        orgaoCnpj: item.document,
        municipio: item.city,
        uf: item.uf,
        modalidade: item.disputeModeText,
        situacao: item.status,
        dataPublicacao: parseDataBr(item.datPublication),
        dataAberturaProposta: parseDataBr(item.datStartSession),
        dataEncerramentoProposta: parseDataBr(item.datFinishSession),
        // O LicitaNet não expõe valor estimado na listagem do boletim — fica nulo (a UI
        // já trata como "Não informado") em vez de inventar um número.
        valorGlobal: null,
        orcamentoSigiloso: false,
        linkPortal: linkBoletimSegmento(company.licitanetSegmentoId!),
        keywordMatched: company.licitanetSegmentoNome,
        ordemKanban: Date.now(),
      };
    }

    const edital = await prisma.edital
      .create({ data: dadosCriacao })
      .catch((err) => {
        // Corrida rara: dois cliques em "Buscar" quase juntos podem tentar criar o
        // mesmo edital — a chave única cuida disso, aqui só ignoramos.
        console.error(`Falha ao criar edital ${c.numeroControle}:`, err);
        return null;
      });
    if (!edital) return;
    criadosIds.push(edital.id);
    if (c.fonte === "PNCP") criadosPncp++;
    else criadosLicitaNet++;

    for (const doc of documentosParaCriar) {
      await prisma.document.create({
        data: {
          editalId: edital.id,
          nome: doc.nome,
          tipo: c.fonte === "PNCP" ? "DOCUMENTO_PNCP" : "DOCUMENTO_LICITANET",
          categoria: doc.categoria,
          status: "DISPONIVEL",
          origemUrl: doc.origemUrl,
          conteudoBase64: null,
        },
      });
    }
  });

  // 6. O download dos documentos e a extração do texto só acontecem quando o usuário
  // demonstra interesse de verdade — ver dispararPipeline em pipeline.ts (disparado ao
  // sair de "Oportunidade") ou o download avulso de um documento (rota
  // .../documents/[docId]/download). A maioria dos editais captados nunca chega a ser
  // aberta, então não faz sentido baixar tudo aqui.

  const partes = [`${criadosIds.length} novo(s) edital(is) captado(s)`];
  if (company.keywords.length > 0 && company.licitanetSegmentoId) {
    partes[0] += ` (${criadosPncp} do PNCP, ${criadosLicitaNet} do LicitaNet).`;
  } else {
    partes[0] += ".";
  }
  const descartados = descartadosPerfil + descartadosRelevancia;
  if (descartados > 0) {
    partes.push(
      `${descartados} não listado(s): ${descartadosPerfil} fora do tipo que a empresa atende, ${descartadosRelevancia} sem relação direta com o objeto social.`
    );
  }
  if (falhasPncp > 0) partes.push(`${falhasPncp} palavra-chave indisponível no PNCP no momento.`);
  if (falhaLicitaNet) partes.push(`LicitaNet indisponível no momento (${falhaLicitaNet}).`);
  if (retificados > 0) partes.push(`${retificados} edital(is) já capturado(s) foi(ram) retificado(s) pelo órgão — revise antes de prosseguir.`);

  return {
    novos: criadosIds.length,
    analisados,
    descartadosPerfil,
    descartadosRelevancia,
    retificados,
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
      { model: MODELO_HAIKU, maxTokens: 1500 }
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
  input: { nomeArquivo: string; arquivoBase64?: string; storagePath?: string }
) {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });

  // PDF grande (até 50MB): já está no Storage, busca os bytes de lá pra extração.
  // PDF pequeno (caminho antigo, mantido por compatibilidade): já chega em base64.
  const bytes = input.storagePath ? await baixarAnexo(input.storagePath) : base64ParaBytes(input.arquivoBase64!);
  const texto = await extrairTextoPdf(bytes);
  if (!texto) {
    throw new Error(
      "Não foi possível ler texto neste PDF, nem via OCR (o arquivo pode estar corrompido, protegido, ou ter páginas demais para a leitura automática). Tente novamente ou envie uma versão menor do arquivo."
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
      // O pipeline já roda na hora (mais abaixo) — o card entra direto em "Rascunho",
      // pronto pra revisão, em vez de "Oportunidade" (que é para quem ainda não decidiu).
      etapaKanban: "RASCUNHO",
      ordemKanban: Date.now(),
    },
  });

  await prisma.document.create({
    data: {
      editalId: edital.id,
      nome: input.nomeArquivo || "Edital.pdf",
      tipo: "DOCUMENTO_USUARIO",
      categoria: "EDITAL",
      status: "DISPONIVEL",
      ...(input.storagePath ? { storagePath: input.storagePath } : { conteudoBase64: input.arquivoBase64 }),
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
