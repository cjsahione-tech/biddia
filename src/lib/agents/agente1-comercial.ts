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
import { classificarTipoObjeto, empresaAtende } from "@/lib/agents/classificador-objeto";
import { editalERelevante } from "@/lib/agents/relevancia";

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
