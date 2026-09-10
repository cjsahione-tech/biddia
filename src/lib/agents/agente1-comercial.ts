import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import {
  searchEditaisPorPalavraChave,
  linkPortalCompra,
  buscarDetalheCompra,
  buscarArquivosCompra,
  selecionarDocumentosPrincipais,
  baixarArquivoPncp,
  parseItemUrl,
} from "@/lib/agents/pncp";
import { classificarTipoObjeto, empresaAtende, type TipoObjeto } from "@/lib/agents/classificador-objeto";
import { editalERelevante } from "@/lib/agents/relevancia";
import { askJSON } from "@/lib/anthropic";
import { extrairTextoPdf, base64ParaBytes } from "@/lib/agents/pdf-extract";
import { logAudit } from "@/lib/agents/run-tracker";

/**
 * Agente Comercial: varre o PNCP de forma autônoma usando as palavras-chave
 * cadastradas pela empresa e grava apenas os editais com relação direta com o que
 * a empresa realmente oferece — descarta tudo que só bateu na busca por coincidência
 * de palavra, sem relação real com o perfil declarado.
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

  let novos = 0;
  let analisados = 0;
  let falhas = 0;
  let descartadosPerfil = 0;
  let descartadosRelevancia = 0;
  const vistos = new Set<string>();

  for (const kw of company.keywords) {
    let items;
    try {
      items = await searchEditaisPorPalavraChave(kw.term);
    } catch (err) {
      console.error(`Agente Comercial: falha ao buscar "${kw.term}" no PNCP:`, err);
      falhas++;
      continue;
    }

    for (const item of items) {
      analisados++;
      if (vistos.has(item.numero_controle_pncp)) continue;
      vistos.add(item.numero_controle_pncp);

      const existing = await prisma.edital.findUnique({
        where: {
          companyId_numeroControlePNCP: {
            companyId: company.id,
            numeroControlePNCP: item.numero_controle_pncp,
          },
        },
      });
      if (existing) continue;

      const descricao = item.description || "(sem descrição disponível)";
      const tipoObjeto = classificarTipoObjeto(item.title, descricao);

      // Filtro rígido nº 1: o tipo do objeto (serviço x bem/insumo) precisa bater com o
      // que a empresa declarou que atende. Um objeto não classificado passa (não há
      // como saber, então não bloqueia por engano).
      if (!empresaAtende(tipoObjeto, company)) {
        descartadosPerfil++;
        continue;
      }

      // Filtro rígido nº 2: relação semântica real com o objeto social da empresa,
      // não só a mesma área genérica. Só roda para quem já passou no filtro acima,
      // para não gastar chamadas de IA com editais já descartados.
      const relevante = await editalERelevante(company.objetoSocial, item.title, descricao);
      if (!relevante) {
        descartadosRelevancia++;
        continue;
      }

      // A busca por palavra-chave nem sempre traz o valor; o detalhe da contratação
      // é a fonte confiável do valor estimado e de eventual sigilo orçamentário.
      let valorGlobal = item.valor_global;
      let orcamentoSigiloso = false;
      const { cnpj, ano, sequencial } = parseItemUrl(item.item_url);
      if (cnpj && ano && sequencial) {
        const detalhe = await buscarDetalheCompra(cnpj, ano, sequencial).catch(() => null);
        if (detalhe) {
          orcamentoSigiloso = !!detalhe.indicadorOrcamentoSigiloso;
          if (!orcamentoSigiloso && detalhe.valorTotalEstimado != null) {
            valorGlobal = detalhe.valorTotalEstimado;
          }
          if (orcamentoSigiloso) valorGlobal = null;
        }
      }

      const edital = await prisma.edital.create({
        data: {
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
          dataAberturaProposta: item.data_inicio_vigencia ? new Date(item.data_inicio_vigencia) : null,
          dataEncerramentoProposta: item.data_fim_vigencia ? new Date(item.data_fim_vigencia) : null,
          valorGlobal,
          orcamentoSigiloso,
          linkPortal: linkPortalCompra(item.item_url),
          keywordMatched: kw.term,
        },
      });
      novos++;

      // Baixa o edital (ou aviso equivalente) e o termo de referência agora, enquanto o
      // PNCP está respondendo, em vez de só guardar o link — assim o download continua
      // funcionando na plataforma mesmo se o PNCP ficar instável depois.
      if (cnpj && ano && sequencial) {
        const arquivos = await buscarArquivosCompra(cnpj, ano, sequencial).catch(() => []);
        const { edital: docEdital, termoReferencia } = selecionarDocumentosPrincipais(arquivos);

        const candidatos: { doc: NonNullable<typeof docEdital>; categoria: "EDITAL" | "TERMO_REFERENCIA" }[] = [];
        if (docEdital) candidatos.push({ doc: docEdital, categoria: "EDITAL" });
        if (termoReferencia) candidatos.push({ doc: termoReferencia, categoria: "TERMO_REFERENCIA" });

        for (const { doc, categoria } of candidatos) {
          const arquivo = await baixarArquivoPncp(doc.url).catch(() => null);
          await prisma.document.create({
            data: {
              editalId: edital.id,
              nome: doc.titulo,
              tipo: "DOCUMENTO_PNCP",
              categoria,
              // Se o download imediato falhar (PNCP instável no momento), guarda a
              // origem para o usuário tentar baixar depois pela própria plataforma.
              status: "DISPONIVEL",
              origemUrl: doc.url,
              conteudoBase64: arquivo
                ? `data:${arquivo.contentType};base64,${Buffer.from(arquivo.bytes).toString("base64")}`
                : null,
            },
          });
        }
      }
    }
  }

  if (falhas === company.keywords.length) {
    return {
      novos: 0,
      analisados,
      mensagem: "O PNCP está indisponível no momento. Tente buscar novamente em alguns instantes.",
    };
  }

  const partes = [`${novos} novo(s) edital(is) encontrado(s) com relação direta ao seu perfil.`];
  if (descartadosPerfil + descartadosRelevancia > 0) {
    partes.push(
      `${descartadosPerfil + descartadosRelevancia} descartado(s) por não corresponderem ao que a empresa oferece.`
    );
  }
  if (falhas > 0) partes.push(`${falhas} palavra-chave indisponível no PNCP no momento.`);

  return { novos, analisados, descartadosPerfil, descartadosRelevancia, mensagem: partes.join(" ") };
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
