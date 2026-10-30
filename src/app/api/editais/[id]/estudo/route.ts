import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";
import { estudoInclude } from "@/lib/estudo-server";
import { parseItens, parseLotesSelecionados } from "@/lib/proposal";
import { resolverAliquotas } from "@/lib/tributos-server";
import { calcularViabilidade, round2, type ItemCalculoInput } from "@/lib/calculo-viabilidade";
import { calcularCenarios, explicarResultado, resultadoParaRelatorio, validarMargens } from "@/lib/estudo-cenarios";
import {
  aprenderParametros,
  medianaOuNulo,
  sugerirCustos,
  type CustoComFornecedor,
  type ParametrosHistorico,
  type RegistroHistorico,
} from "@/lib/estudo-memoria";
import type { AliquotasResolvidas, AnexoSimples, RegimeTributario } from "@/lib/tributos";
import type { RamoEstudo } from "@/lib/estudo-viabilidade";
import type { EstudoViabilidadeDetail } from "@/lib/types";
import type { ItemEstudoAba, MargensAba, PacoteAba, PacoteProduto } from "@/lib/estudo-aba-tipos";

/**
 * Rota da aba "Viabilidade" do edital. Une num lugar só o que o estudo antigo fazia em 7 telas:
 *  GET   → devolve o estudo deste edital (ou nada) já pronto para a tela, com as sugestões da "memória".
 *  POST  → cria o estudo do edital (Produto ou Serviço), já com os itens e o regime do cadastro da empresa.
 *  PATCH → troca o regime tributário (e marca o cálculo salvo como desatualizado).
 *  PUT   → salva os custos do ramo Produto: "rascunho" só guarda; "concluir" confere tudo, calcula e
 *          grava o resultado no MESMO formato que o Relatório/PDF e a lista de estudos já leem.
 * Usa as mesmas tabelas do passo a passo antigo (EstudoViabilidade e CustoItemEstudo) — não muda o banco.
 */

type Ctx = { params: Promise<{ id: string }> };

/** Item congelado no estudo (mesmo formato do passo a passo antigo + marcas novas opcionais). */
type ItemSnapshot = {
  numero: number | null;
  descricao: string;
  unidade: string;
  quantidade: number;
  valorUnitario: number;
  valorTotal: number;
  lote: string | null;
  /** O valor de referência foi digitado pelo usuário (o edital não divulgou). */
  valorManual?: boolean;
  /** Edital sem lista de itens: estudo feito pelo valor global. */
  itemGlobal?: boolean;
};

type ParametrosGravados = {
  margemMinima?: number;
  margemMaxima?: number;
  margemLucroDesejada?: number;
  despesasComerciaisAdmin?: number;
};

const MARGENS_PADRAO = { piso: 5, alvo: 10, inicial: 20, despesas: 0 };

function lerJson<T>(texto: string | null | undefined): T | null {
  if (!texto) return null;
  try {
    return JSON.parse(texto) as T;
  } catch {
    return null;
  }
}

async function carregarEdital(editalId: string, companyId: string) {
  return prisma.edital.findFirst({ where: { id: editalId, companyId }, include: { proposal: true } });
}
type EditalCompleto = NonNullable<Awaited<ReturnType<typeof carregarEdital>>>;

async function carregarEstudo(editalId: string, companyId: string) {
  return prisma.estudoViabilidade.findFirst({
    where: { editalId, companyId },
    orderBy: { updatedAt: "desc" },
    include: estudoInclude,
  });
}
type EstudoCompleto = NonNullable<Awaited<ReturnType<typeof carregarEstudo>>>;

/* ------------------------------------------------------------------ itens do estudo */

/**
 * Lista de itens que o estudo vai usar, congelada na criação. Respeita os lotes que o usuário marcou na
 * aba Financeiro. Um preço que foi só SUGERIDO de mercado não é valor do edital, então não vira "teto".
 */
function montarSnapshot(edital: EditalCompleto): ItemSnapshot[] {
  const proposta = edital.proposal;
  const itens = proposta ? parseItens(proposta.itensJson) : [];

  if (itens.length > 0) {
    const selecionados = parseLotesSelecionados(proposta?.lotesSelecionadosJson);
    const usados = selecionados ? itens.filter((it) => it.lote == null || selecionados.includes(String(it.lote))) : itens;
    return usados.map((it) => {
      const quantidade = Number(it.quantidade) > 0 ? Number(it.quantidade) : 0;
      const doEdital = it.precoSugerido !== true;
      const unitario = doEdital && Number(it.valorUnitario) > 0 ? Number(it.valorUnitario) : 0;
      const total = doEdital ? (Number(it.valorTotal) > 0 ? Number(it.valorTotal) : round2(unitario * quantidade)) : 0;
      return {
        numero: it.numero,
        descricao: it.descricao,
        unidade: it.unidade,
        quantidade,
        valorUnitario: unitario > 0 ? unitario : quantidade > 0 ? round2(total / quantidade) : 0,
        valorTotal: total,
        lote: it.lote,
      };
    });
  }

  const valor = edital.valorGlobal ?? proposta?.valorGlobalReferencia ?? 0;
  const v = valor > 0 ? valor : 0;
  return [
    { numero: null, descricao: edital.titulo, unidade: "un", quantidade: 1, valorUnitario: v, valorTotal: v, lote: null, itemGlobal: true },
  ];
}

/* ------------------------------------------------------------------ memória (histórico da empresa) */

async function carregarHistorico(companyId: string, excluirEstudoId: string) {
  const estudos = await prisma.estudoViabilidade.findMany({
    where: { companyId, ramo: "PRODUTO", custosConfirmadoEm: { not: null }, id: { not: excluirEstudoId } },
    orderBy: { updatedAt: "desc" },
    take: 50,
    include: { custosItens: true, edital: { select: { titulo: true } } },
  });

  const registros: RegistroHistorico[] = [];
  const parametros: ParametrosHistorico[] = [];

  for (const e of estudos) {
    const snapshot = lerJson<ItemSnapshot[]>(e.itensSnapshotJson) ?? [];
    const rotulo = e.nome ?? e.edital?.titulo ?? "Estudo anterior";
    const custosDoEstudo: CustoComFornecedor[] = [];

    for (const c of e.custosItens) {
      const custos = lerJson<CustoComFornecedor>(c.custosJson);
      const item = snapshot[c.itemIndex];
      if (!custos || !item) continue;
      custosDoEstudo.push(custos);
      registros.push({
        descricao: item.descricao,
        quantidade: item.quantidade,
        custos,
        origem: { estudoId: e.id, rotulo, atualizadoEm: e.updatedAt.toISOString() },
      });
    }

    const p = lerJson<ParametrosGravados>(e.parametrosCustoJson);
    parametros.push({
      margemPiso: p?.margemMinima ?? e.margemMinimaAceitavel ?? null,
      margemAlvo:
        p?.margemLucroDesejada ??
        medianaOuNulo(custosDoEstudo.map((c) => (c.margemLucroDesejada > 0 ? c.margemLucroDesejada : null))),
      margemInicial: p?.margemMaxima ?? null,
      despesasComerciaisAdmin: p?.despesasComerciaisAdmin ?? medianaOuNulo(custosDoEstudo.map((c) => c.despesasComerciaisAdmin)),
    });
  }

  return { registros, parametros };
}

/* ------------------------------------------------------------------ pacote entregue à tela */

async function montarProduto(companyId: string, estudo: EstudoCompleto): Promise<PacoteProduto> {
  const snapshot = lerJson<ItemSnapshot[]>(estudo.itensSnapshotJson) ?? [];
  const linhas = await prisma.custoItemEstudo.findMany({ where: { estudoId: estudo.id } });
  const salvos = new Map<number, Partial<CustoComFornecedor>>(
    linhas.map((l) => [l.itemIndex, lerJson<Partial<CustoComFornecedor>>(l.custosJson) ?? {}])
  );
  const historico = await carregarHistorico(companyId, estudo.id);

  const itens: ItemEstudoAba[] = snapshot.map((s, i) => {
    const salvo = salvos.get(i);
    const temSalvo =
      !!salvo &&
      ((salvo.custoAquisicaoUnitario ?? 0) > 0 || (salvo.freteLogistica ?? 0) > 0 || (salvo.icmsStDifal ?? 0) > 0 || !!salvo.fornecedor);

    const base = {
      itemIndex: i,
      numero: s.numero ?? null,
      descricao: s.descricao,
      unidade: s.unidade,
      quantidade: s.quantidade,
      lote: s.lote ?? null,
      valorUnitarioReferencia: s.valorUnitario > 0 ? s.valorUnitario : 0,
      valorTotalReferencia: s.valorTotal > 0 ? s.valorTotal : 0,
      valorReferenciaManual: s.valorManual === true,
      itemGlobal: s.itemGlobal === true,
    };

    if (temSalvo && salvo) {
      return {
        ...base,
        custos: {
          custoAquisicaoUnitario: salvo.custoAquisicaoUnitario ?? 0,
          freteLogistica: salvo.freteLogistica ?? 0,
          icmsStDifal: salvo.icmsStDifal ?? 0,
          fornecedor: salvo.fornecedor ?? "",
        },
        fonteCusto: "SALVO" as const,
        sugestao: null,
      };
    }

    const sug = sugerirCustos(s.descricao, s.quantidade, historico.registros);
    if (sug) {
      return {
        ...base,
        custos: {
          custoAquisicaoUnitario: sug.custos.custoAquisicaoUnitario,
          freteLogistica: sug.custos.freteLogistica,
          icmsStDifal: sug.custos.icmsStDifal,
          fornecedor: sug.custos.fornecedor ?? "",
        },
        fonteCusto: "HISTORICO" as const,
        sugestao: {
          similaridade: sug.similaridade,
          rotulo: sug.origem.rotulo,
          atualizadoEm: sug.origem.atualizadoEm,
          ocorrencias: sug.ocorrencias,
          ajustouPorQuantidade: sug.ajustouPorQuantidade,
        },
      };
    }

    return {
      ...base,
      custos: { custoAquisicaoUnitario: 0, freteLogistica: 0, icmsStDifal: 0, fornecedor: "" },
      fonteCusto: "VAZIO" as const,
      sugestao: null,
    };
  });

  const gravados = lerJson<ParametrosGravados>(estudo.parametrosCustoJson);
  const temGravados =
    !!gravados &&
    typeof gravados.margemMinima === "number" &&
    typeof gravados.margemMaxima === "number" &&
    typeof gravados.margemLucroDesejada === "number";
  const aprendidos = aprenderParametros(historico.parametros);

  let margens: MargensAba;
  if (temGravados && gravados) {
    margens = {
      piso: gravados.margemMinima as number,
      alvo: gravados.margemLucroDesejada as number,
      inicial: gravados.margemMaxima as number,
      despesas: gravados.despesasComerciaisAdmin ?? 0,
      origem: "SALVO",
      amostras: aprendidos.amostras,
    };
  } else {
    const piso = aprendidos.margemPiso ?? MARGENS_PADRAO.piso;
    const alvo = Math.max(aprendidos.margemAlvo ?? MARGENS_PADRAO.alvo, piso);
    const inicial = Math.max(aprendidos.margemInicial ?? MARGENS_PADRAO.inicial, alvo);
    margens = {
      piso,
      alvo,
      inicial,
      despesas: aprendidos.despesasComerciaisAdmin ?? MARGENS_PADRAO.despesas,
      origem: aprendidos.margemAlvo != null || aprendidos.margemPiso != null ? "APRENDIDO" : "PADRAO",
      amostras: aprendidos.amostras,
    };
  }

  const aliquotas = estudo.tributosConfirmadoEm ? lerJson<AliquotasResolvidas>(estudo.aliquotasJson) : null;

  return { itens, margens, percentualTributos: aliquotas?.aliquotaTotalEfetiva ?? null, aliquotas };
}

async function montarPacote(companyId: string, edital: EditalCompleto): Promise<PacoteAba> {
  const [estudo, empresa] = await Promise.all([
    carregarEstudo(edital.id, companyId),
    prisma.company.findUnique({
      where: { id: companyId },
      select: { regimeTributarioPadrao: true, anexoSimplesPadrao: true, rbt12Padrao: true },
    }),
  ]);

  const tipo = edital.tipoObjeto;
  const ramoSugerido: RamoEstudo | null = tipo === "SERVICO" ? "SERVICO" : tipo === "BEM" ? "PRODUTO" : null;

  return {
    edital: {
      id: edital.id,
      titulo: edital.titulo,
      orgaoNome: edital.orgaoNome,
      valorGlobal: edital.valorGlobal ?? null,
      orcamentoSigiloso: edital.orcamentoSigiloso,
      tipoObjeto: tipo === "SERVICO" || tipo === "BEM" || tipo === "AMBOS" ? tipo : null,
    },
    ramoSugerido,
    empresa: {
      regimeTributarioPadrao: empresa?.regimeTributarioPadrao ?? null,
      anexoSimplesPadrao: empresa?.anexoSimplesPadrao ?? null,
      rbt12Padrao: empresa?.rbt12Padrao ?? null,
    },
    estudo: estudo as unknown as EstudoViabilidadeDetail | null,
    produto: estudo && estudo.ramo === "PRODUTO" ? await montarProduto(companyId, estudo) : null,
  };
}

/* ------------------------------------------------------------------ regime tributário */

type DadosTributos = {
  regimeTributario: RegimeTributario;
  anexoSimples: AnexoSimples | null;
  rbt12: number | null;
  aliquotasJson: string;
  tributosConfirmadoEm: Date;
};

/** Resolve o regime a partir de uma escolha. Lança Error com mensagem amigável se faltar algo. */
async function resolverTributos(
  companyId: string,
  ramo: RamoEstudo,
  escolha: { regimeTributario: RegimeTributario; anexoSimples?: AnexoSimples | null; rbt12?: number | null }
): Promise<DadosTributos> {
  const simples = escolha.regimeTributario === "SIMPLES_NACIONAL";
  if (simples && !escolha.anexoSimples) throw new Error("Selecione o Anexo do Simples Nacional");
  if (simples && escolha.rbt12 == null) throw new Error("Informe o RBT12 (faturamento dos últimos 12 meses)");

  const aliquotas = await resolverAliquotas({
    companyId,
    regime: escolha.regimeTributario,
    ramo,
    anexoSimples: simples ? escolha.anexoSimples : null,
    rbt12: simples ? escolha.rbt12 : null,
  });

  return {
    regimeTributario: escolha.regimeTributario,
    anexoSimples: simples ? (escolha.anexoSimples ?? null) : null,
    rbt12: simples ? (escolha.rbt12 ?? null) : null,
    aliquotasJson: JSON.stringify(aliquotas),
    tributosConfirmadoEm: new Date(),
  };
}

/** Regime padrão do cadastro da empresa, quando está completo. Se não der, o usuário escolhe na aba. */
async function tributosDoCadastro(companyId: string, ramo: RamoEstudo): Promise<Partial<DadosTributos>> {
  const empresa = await prisma.company.findUnique({
    where: { id: companyId },
    select: { regimeTributarioPadrao: true, anexoSimplesPadrao: true, rbt12Padrao: true },
  });
  if (!empresa?.regimeTributarioPadrao) return {};
  try {
    return await resolverTributos(companyId, ramo, {
      regimeTributario: empresa.regimeTributarioPadrao,
      anexoSimples: empresa.anexoSimplesPadrao,
      rbt12: empresa.rbt12Padrao,
    });
  } catch {
    return {};
  }
}

/* ------------------------------------------------------------------ handlers */

export async function GET(_req: Request, { params }: Ctx) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id } = await params;

  const edital = await carregarEdital(id, company!.id);
  if (!edital) return NextResponse.json({ error: "Edital não encontrado" }, { status: 404 });

  return NextResponse.json(await montarPacote(company!.id, edital));
}

const postSchema = z.object({ ramo: z.enum(["PRODUTO", "SERVICO"]) });

export async function POST(req: Request, { params }: Ctx) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id } = await params;

  const edital = await carregarEdital(id, company!.id);
  if (!edital) return NextResponse.json({ error: "Edital não encontrado" }, { status: 404 });

  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Escolha se o estudo é de produtos ou de serviços" }, { status: 400 });

  // Já existe estudo deste edital: devolve o que existe (não cria um segundo por engano).
  const existente = await carregarEstudo(id, company!.id);
  if (!existente) {
    const ramo = parsed.data.ramo;
    const tributos = await tributosDoCadastro(company!.id, ramo);
    await prisma.estudoViabilidade.create({
      data: {
        companyId: company!.id,
        ramo,
        editalId: id,
        ...(ramo === "PRODUTO" ? { itensSnapshotJson: JSON.stringify(montarSnapshot(edital)) } : {}),
        ...tributos,
      },
    });
  }

  return NextResponse.json(await montarPacote(company!.id, edital));
}

const patchSchema = z.object({
  regimeTributario: z.enum(["SIMPLES_NACIONAL", "LUCRO_PRESUMIDO", "LUCRO_REAL"]),
  anexoSimples: z.enum(["I", "III", "IV", "V"]).nullable().optional(),
  rbt12: z.number().min(0).nullable().optional(),
});

export async function PATCH(req: Request, { params }: Ctx) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id } = await params;

  const edital = await carregarEdital(id, company!.id);
  if (!edital) return NextResponse.json({ error: "Edital não encontrado" }, { status: 404 });
  const estudo = await carregarEstudo(id, company!.id);
  if (!estudo) return NextResponse.json({ error: "Crie o estudo antes de escolher o regime" }, { status: 409 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

  let tributos: DadosTributos;
  try {
    tributos = await resolverTributos(company!.id, estudo.ramo, parsed.data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Não foi possível resolver as alíquotas" }, { status: 400 });
  }

  // Mudou o imposto → o resultado que estava salvo ficou desatualizado. Guarda os custos, mas pede novo cálculo.
  await prisma.estudoViabilidade.update({
    where: { id: estudo.id },
    data: { ...tributos, calculoConfirmadoEm: null, resultadoCalculoJson: null },
  });

  return NextResponse.json(await montarPacote(company!.id, edital));
}

const DINHEIRO = z.number().min(0).max(1_000_000_000);
const PERCENTUAL = z.number().min(0).max(99);

const putSchema = z.object({
  acao: z.enum(["rascunho", "concluir"]),
  margens: z.object({ piso: PERCENTUAL, alvo: PERCENTUAL, inicial: PERCENTUAL, despesas: PERCENTUAL }),
  itens: z
    .array(
      z.object({
        itemIndex: z.number().int().min(0),
        custos: z.object({
          custoAquisicaoUnitario: DINHEIRO,
          freteLogistica: DINHEIRO,
          icmsStDifal: DINHEIRO,
          fornecedor: z.string().trim().max(120).optional(),
        }),
        valorReferenciaUnitario: DINHEIRO.nullable().optional(),
      })
    )
    .max(1000),
});

export async function PUT(req: Request, { params }: Ctx) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id } = await params;

  const edital = await carregarEdital(id, company!.id);
  if (!edital) return NextResponse.json({ error: "Edital não encontrado" }, { status: 404 });
  const estudo = await carregarEstudo(id, company!.id);
  if (!estudo || estudo.ramo !== "PRODUTO") {
    return NextResponse.json({ error: "Este edital não tem um estudo de produtos" }, { status: 409 });
  }

  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos. Confira os números digitados." }, { status: 400 });
  const { acao, margens, itens } = parsed.data;

  const snapshot = lerJson<ItemSnapshot[]>(estudo.itensSnapshotJson) ?? [];
  if (snapshot.length === 0) return NextResponse.json({ error: "Este estudo não tem itens para calcular" }, { status: 409 });

  const aliquotas = estudo.tributosConfirmadoEm ? lerJson<AliquotasResolvidas>(estudo.aliquotasJson) : null;
  if (acao === "concluir" && !aliquotas) {
    return NextResponse.json({ error: "Confirme o regime tributário antes de concluir o estudo." }, { status: 409 });
  }
  const percentualTributos = aliquotas?.aliquotaTotalEfetiva ?? 0;

  if (acao === "concluir") {
    const problema = validarMargens(margens, percentualTributos);
    if (problema) return NextResponse.json({ error: problema }, { status: 400 });
  }

  // Valor de referência digitado: só vale para item cujo valor o edital não divulgou (ou que já foi digitado antes).
  const entradaPorIndice = new Map(itens.map((i) => [i.itemIndex, i]));
  const novoSnapshot: ItemSnapshot[] = snapshot.map((s, i) => {
    const ref = entradaPorIndice.get(i)?.valorReferenciaUnitario;
    const editavel = !(s.valorTotal > 0) || s.valorManual === true;
    if (ref === undefined || !editavel) return s;
    if (ref !== null && ref > 0) return { ...s, valorUnitario: ref, valorTotal: round2(ref * s.quantidade), valorManual: true };
    return { ...s, valorUnitario: 0, valorTotal: 0, valorManual: false };
  });

  const custosFinais: (CustoComFornecedor)[] = snapshot.map((_, i) => {
    const c = entradaPorIndice.get(i)?.custos;
    return {
      custoAquisicaoUnitario: c?.custoAquisicaoUnitario ?? 0,
      freteLogistica: c?.freteLogistica ?? 0,
      icmsStDifal: c?.icmsStDifal ?? 0,
      despesasComerciaisAdmin: margens.despesas,
      margemLucroDesejada: margens.alvo,
      ...(c?.fornecedor ? { fornecedor: c.fornecedor } : {}),
    };
  });

  const parametrosCustoJson = JSON.stringify({
    despesasComerciaisAdmin: margens.despesas,
    margemLucroDesejada: margens.alvo,
    margemMinima: margens.piso,
    margemMaxima: margens.inicial,
  });

  let dadosEstudo: Prisma.EstudoViabilidadeUncheckedUpdateInput = {
    itensSnapshotJson: JSON.stringify(novoSnapshot),
    parametrosCustoJson,
    margemMinimaAceitavel: margens.piso,
  };

  if (acao === "rascunho") {
    // Mexeu depois de concluir → deixa de estar concluído (o resultado antigo não vale mais).
    dadosEstudo = { ...dadosEstudo, custosConfirmadoEm: null, calculoConfirmadoEm: null, resultadoCalculoJson: null };
  } else {
    const cenarios = calcularCenarios(
      novoSnapshot.map((s, i) => ({ descricao: s.descricao, quantidade: s.quantidade, valorTetoTotal: s.valorTotal, custos: custosFinais[i] })),
      percentualTributos,
      { piso: margens.piso, alvo: margens.alvo, inicial: margens.inicial }
    );
    if (cenarios.consolidado.status === "INCOMPLETO") {
      return NextResponse.json({ error: explicarResultado(cenarios) }, { status: 400 });
    }
    const itensLegado: ItemCalculoInput[] = novoSnapshot.map((s, i) => ({
      descricao: s.descricao,
      quantidade: s.quantidade,
      valorTetoEdital: s.valorTotal,
      custos: custosFinais[i],
    }));
    const legado = calcularViabilidade(itensLegado, percentualTributos, margens.piso);
    const agora = new Date();
    dadosEstudo = {
      ...dadosEstudo,
      custosConfirmadoEm: agora,
      calculoConfirmadoEm: agora,
      resultadoCalculoJson: JSON.stringify(resultadoParaRelatorio(legado, cenarios)),
    };
  }

  await prisma.$transaction([
    ...custosFinais.map((c, i) =>
      prisma.custoItemEstudo.upsert({
        where: { estudoId_itemIndex: { estudoId: estudo.id, itemIndex: i } },
        create: { estudoId: estudo.id, itemIndex: i, custosJson: JSON.stringify(c) },
        update: { custosJson: JSON.stringify(c) },
      })
    ),
    prisma.estudoViabilidade.update({ where: { id: estudo.id }, data: dadosEstudo }),
  ]);

  return NextResponse.json(await montarPacote(company!.id, edital));
}
