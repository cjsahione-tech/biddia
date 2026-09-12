import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";
import { carregarEstudoDaEmpresa } from "@/lib/estudo-server";
import { parseItens } from "@/lib/proposal";
import {
  CUSTO_ITEM_VAZIO_SERVICO,
  CUSTO_ITEM_VAZIO_PRODUTO,
  type CustoItem,
} from "@/lib/estudo-custos";

/**
 * Garante que o estudo tenha um snapshot de itens (congelado no momento em que a Etapa 4
 * começa — não muda mais se a Proposal do edital for reprocessada depois) e uma linha de
 * custo por item, com valores zerados na primeira vez.
 */
async function garantirCustosInicializados(estudoId: string) {
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
  const vazio: CustoItem = estudo.ramo === "SERVICO" ? CUSTO_ITEM_VAZIO_SERVICO : CUSTO_ITEM_VAZIO_PRODUTO;

  const existentes = await prisma.custoItemEstudo.findMany({ where: { estudoId } });
  const indicesExistentes = new Set(existentes.map((c) => c.itemIndex));
  const faltantes = itens.map((_, i) => i).filter((i) => !indicesExistentes.has(i));

  if (faltantes.length > 0) {
    await prisma.custoItemEstudo.createMany({
      data: faltantes.map((itemIndex) => ({ estudoId, itemIndex, custosJson: JSON.stringify(vazio) })),
    });
  }

  return { itens, ramo: estudo.ramo };
}

export const maxDuration = 60;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id } = await params;

  const estudo = await carregarEstudoDaEmpresa(id, company!.id);
  if (!estudo) return NextResponse.json({ error: "Estudo não encontrado" }, { status: 404 });
  if (!estudo.editalId) return NextResponse.json({ error: "Selecione um edital antes de informar os custos" }, { status: 409 });

  const { itens } = await garantirCustosInicializados(id);
  const custos = await prisma.custoItemEstudo.findMany({ where: { estudoId: id }, orderBy: { itemIndex: "asc" } });

  return NextResponse.json({
    itens,
    custos: custos.map((c) => ({ itemIndex: c.itemIndex, custos: JSON.parse(c.custosJson) })),
    parametrosCusto: estudo.parametrosCustoJson ? JSON.parse(estudo.parametrosCustoJson) : null,
    custosConfirmadoEm: estudo.custosConfirmadoEm,
  });
}

const custoFieldsSchema = z
  .object({
    quantidadeProfissionais: z.number(),
    salarioBase: z.number(),
    percentualEncargos: z.number(),
    insumos: z.number(),
    equipamentos: z.number(),
    deslocamento: z.number(),
    administracaoCentral: z.number(),
    seguroGarantia: z.number(),
    risco: z.number(),
    despesasFinanceiras: z.number(),
    lucroDesejado: z.number(),
    custoAquisicaoUnitario: z.number(),
    freteLogistica: z.number(),
    icmsStDifal: z.number(),
    despesasComerciaisAdmin: z.number(),
    margemLucroDesejada: z.number(),
  })
  .partial();

const patchSchema = z.object({
  itens: z.array(z.object({ itemIndex: z.number().int().min(0), custos: custoFieldsSchema })).max(1000),
  parametrosCusto: custoFieldsSchema.optional(),
  confirmar: z.boolean().optional(),
});

/** Salva os custos informados (todos os itens de uma vez) e, opcionalmente, confirma a
 * etapa. Como não há extração por IA aqui, não existe "revisão" separada — o próprio
 * preenchimento manual já é a decisão do usuário. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id } = await params;

  const estudo = await carregarEstudoDaEmpresa(id, company!.id);
  if (!estudo) return NextResponse.json({ error: "Estudo não encontrado" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
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
