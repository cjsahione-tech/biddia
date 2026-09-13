import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";
import { carregarEstudoDaEmpresa } from "@/lib/estudo-server";
import { parseItens } from "@/lib/proposal";
import { extrairCargosServico } from "@/lib/agents/estudo-cargos";
import {
  CUSTO_ITEM_VAZIO_PRODUTO,
  CARGO_SERVICO_VAZIO,
  type CustoItem,
  type CargoServico,
  type CustoOperacionalLinha,
} from "@/lib/estudo-custos";

export const maxDuration = 60;

/** Garante que o estudo (ramo Produto) tenha um snapshot de itens (congelado no momento
 * em que a Etapa 4 começa — não muda mais se a Proposal do edital for reprocessada
 * depois) e uma linha de custo por item, com valores zerados na primeira vez. */
async function garantirCustosInicializadosProduto(estudoId: string) {
  const estudo = await prisma.estudoViabilidade.findUniqueOrThrow({
    where: { id: estudoId },
    include: { edital: { include: { proposal: true } } },
  });

  let itensSnapshotJson = estudo.itensSnapshotJson;
  if (!itensSnapshotJson) {
    const itens = estudo.edital?.proposal ? parseItens(estudo.edital.proposal.itensJson) : [];
    itensSnapshotJson = JSON.stringify(itens);
    await prisma.estudoViabilidade.update({ where: { id: estudoId }, data: { itensSnapshotJson } });
  }

  const itens = JSON.parse(itensSnapshotJson) as { descricao: string; unidade: string; quantidade: number }[];
  const vazio: CustoItem = CUSTO_ITEM_VAZIO_PRODUTO;

  const existentes = await prisma.custoItemEstudo.findMany({ where: { estudoId } });
  const indicesExistentes = new Set(existentes.map((c) => c.itemIndex));
  const faltantes = itens.map((_, i) => i).filter((i) => !indicesExistentes.has(i));

  if (faltantes.length > 0) {
    await prisma.custoItemEstudo.createMany({
      data: faltantes.map((itemIndex) => ({ estudoId, itemIndex, custosJson: JSON.stringify(vazio) })),
    });
  }

  return { itens };
}

/** Garante que o estudo (ramo Serviço) tenha os cargos sugeridos pela IA a partir do
 * edital — só roda a extração uma vez (primeira carga da etapa); depois disso o usuário
 * já pode ter editado a lista, então nunca sobrescreve sozinho. */
async function garantirCargosInicializadosServico(estudoId: string) {
  const estudo = await prisma.estudoViabilidade.findUniqueOrThrow({
    where: { id: estudoId },
    include: { edital: { include: { proposal: true } } },
  });

  let cargosJson = estudo.cargosJson;
  let custosOperacionaisJson = estudo.custosOperacionaisJson;

  if (cargosJson == null) {
    const sugestao = estudo.editalId
      ? await extrairCargosServico(estudo.editalId).catch((err) => {
          console.error(`Falha ao extrair cargos do estudo ${estudoId}:`, err);
          return { cargos: [] as { nome: string; quantidade: number }[] };
        })
      : { cargos: [] as { nome: string; quantidade: number }[] };

    const cargos: CargoServico[] = sugestao.cargos.map((c) => ({
      ...CARGO_SERVICO_VAZIO,
      nome: c.nome,
      quantidade: c.quantidade > 0 ? c.quantidade : 1,
      origemEdital: true,
    }));
    cargosJson = JSON.stringify(cargos);
    await prisma.estudoViabilidade.update({ where: { id: estudoId }, data: { cargosJson } });
  }
  if (custosOperacionaisJson == null) {
    custosOperacionaisJson = JSON.stringify([]);
    await prisma.estudoViabilidade.update({ where: { id: estudoId }, data: { custosOperacionaisJson } });
  }

  const valorTetoLote = estudo.edital?.valorGlobal ?? estudo.edital?.proposal?.valorGlobalReferencia ?? 0;

  return {
    cargos: JSON.parse(cargosJson) as CargoServico[],
    custosOperacionais: JSON.parse(custosOperacionaisJson) as CustoOperacionalLinha[],
    valorTetoLote,
  };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id } = await params;

  const estudo = await carregarEstudoDaEmpresa(id, company!.id);
  if (!estudo) return NextResponse.json({ error: "Estudo não encontrado" }, { status: 404 });
  if (!estudo.editalId) return NextResponse.json({ error: "Selecione um edital antes de informar os custos" }, { status: 409 });

  if (estudo.ramo === "PRODUTO") {
    const { itens } = await garantirCustosInicializadosProduto(id);
    const custos = await prisma.custoItemEstudo.findMany({ where: { estudoId: id }, orderBy: { itemIndex: "asc" } });
    return NextResponse.json({
      itens,
      custos: custos.map((c) => ({ itemIndex: c.itemIndex, custos: JSON.parse(c.custosJson) })),
      parametrosCusto: estudo.parametrosCustoJson ? JSON.parse(estudo.parametrosCustoJson) : null,
      custosConfirmadoEm: estudo.custosConfirmadoEm,
    });
  }

  const { cargos, custosOperacionais, valorTetoLote } = await garantirCargosInicializadosServico(id);
  return NextResponse.json({
    cargos,
    custosOperacionais,
    valorTetoLote,
    descontoPercentual: estudo.descontoPercentual,
    duracaoContratoMeses: estudo.duracaoContratoMeses,
    custosConfirmadoEm: estudo.custosConfirmadoEm,
  });
}

/** Ramo Serviço: refaz a extração de cargos por IA, ignorando o que já estava salvo —
 * mesmo padrão do botão "Extrair de novo" da Etapa 2 (Requisitos). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id } = await params;

  const estudo = await carregarEstudoDaEmpresa(id, company!.id);
  if (!estudo) return NextResponse.json({ error: "Estudo não encontrado" }, { status: 404 });
  if (estudo.ramo !== "SERVICO") return NextResponse.json({ error: "Só aplicável ao ramo Serviço" }, { status: 409 });
  if (!estudo.editalId) return NextResponse.json({ error: "Selecione um edital antes de extrair os cargos" }, { status: 409 });

  let sugestao;
  try {
    sugestao = await extrairCargosServico(estudo.editalId);
  } catch (err) {
    console.error(`Falha ao extrair cargos do estudo ${id}:`, err);
    return NextResponse.json({ error: "Não foi possível extrair os cargos agora. Tente novamente em instantes." }, { status: 502 });
  }

  const cargos: CargoServico[] = sugestao.cargos.map((c) => ({
    ...CARGO_SERVICO_VAZIO,
    nome: c.nome,
    quantidade: c.quantidade > 0 ? c.quantidade : 1,
    origemEdital: true,
  }));

  await prisma.estudoViabilidade.update({ where: { id }, data: { cargosJson: JSON.stringify(cargos) } });

  return NextResponse.json({ cargos });
}

const custoFieldsSchema = z
  .object({
    custoAquisicaoUnitario: z.number(),
    freteLogistica: z.number(),
    icmsStDifal: z.number(),
    despesasComerciaisAdmin: z.number(),
    margemLucroDesejada: z.number(),
  })
  .partial();

const patchSchemaProduto = z.object({
  itens: z.array(z.object({ itemIndex: z.number().int().min(0), custos: custoFieldsSchema })).max(1000),
  parametrosCusto: custoFieldsSchema.optional(),
  confirmar: z.boolean().optional(),
});

const cargoSchema = z.object({
  nome: z.string().min(1).max(200),
  quantidade: z.number().min(0),
  salarioBase: z.number().min(0),
  percentualEncargos: z.number().min(0),
  beneficiosValor: z.number().min(0),
  origemEdital: z.boolean(),
});

const custoOperacionalSchema = z.object({
  nome: z.string().min(1).max(200),
  quantidade: z.number().nullable(),
  valorUnitario: z.number().nullable(),
  valorMensal: z.number(),
});

const patchSchemaServico = z.object({
  descontoPercentual: z.number().min(0).max(100),
  duracaoContratoMeses: z.number().int().min(1).max(600),
  cargos: z.array(cargoSchema).max(100),
  custosOperacionais: z.array(custoOperacionalSchema).max(200),
  confirmar: z.boolean().optional(),
});

/** Salva os custos informados e, opcionalmente, confirma a etapa. Como não há revisão
 * separada da extração (o próprio preenchimento/edição já é a decisão do usuário), esta
 * rota serve tanto para "salvar rascunho" quanto para confirmar. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id } = await params;

  const estudo = await carregarEstudoDaEmpresa(id, company!.id);
  if (!estudo) return NextResponse.json({ error: "Estudo não encontrado" }, { status: 404 });

  const body = await req.json().catch(() => null);

  if (estudo.ramo === "PRODUTO") {
    const parsed = patchSchemaProduto.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

    await prisma.$transaction(
      parsed.data.itens.map((item) =>
        prisma.custoItemEstudo.upsert({
          where: { estudoId_itemIndex: { estudoId: id, itemIndex: item.itemIndex } },
          create: { estudoId: id, itemIndex: item.itemIndex, custosJson: JSON.stringify(item.custos) },
          update: { custosJson: JSON.stringify(item.custos) },
        })
      )
    );

    await prisma.estudoViabilidade.update({
      where: { id },
      data: {
        ...(parsed.data.parametrosCusto ? { parametrosCustoJson: JSON.stringify(parsed.data.parametrosCusto) } : {}),
        ...(parsed.data.confirmar ? { custosConfirmadoEm: new Date() } : {}),
      },
    });

    const custos = await prisma.custoItemEstudo.findMany({ where: { estudoId: id }, orderBy: { itemIndex: "asc" } });
    const atualizado = await prisma.estudoViabilidade.findUniqueOrThrow({ where: { id } });

    return NextResponse.json({
      custos: custos.map((c) => ({ itemIndex: c.itemIndex, custos: JSON.parse(c.custosJson) })),
      parametrosCusto: atualizado.parametrosCustoJson ? JSON.parse(atualizado.parametrosCustoJson) : null,
      custosConfirmadoEm: atualizado.custosConfirmadoEm,
    });
  }

  const parsed = patchSchemaServico.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

  const atualizado = await prisma.estudoViabilidade.update({
    where: { id },
    data: {
      descontoPercentual: parsed.data.descontoPercentual,
      duracaoContratoMeses: parsed.data.duracaoContratoMeses,
      cargosJson: JSON.stringify(parsed.data.cargos),
      custosOperacionaisJson: JSON.stringify(parsed.data.custosOperacionais),
      ...(parsed.data.confirmar ? { custosConfirmadoEm: new Date() } : {}),
    },
  });

  return NextResponse.json({
    cargos: JSON.parse(atualizado.cargosJson!),
    custosOperacionais: JSON.parse(atualizado.custosOperacionaisJson!),
    descontoPercentual: atualizado.descontoPercentual,
    duracaoContratoMeses: atualizado.duracaoContratoMeses,
    custosConfirmadoEm: atualizado.custosConfirmadoEm,
  });
}
