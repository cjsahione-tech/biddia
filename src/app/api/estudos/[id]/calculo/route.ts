import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";
import { carregarEstudoDaEmpresa } from "@/lib/estudo-server";
import { calcularViabilidade, type ItemCalculoInput } from "@/lib/calculo-viabilidade";
import { calcularDreServico } from "@/lib/calculo-dre-servico";
import type { AliquotasResolvidas } from "@/lib/tributos";
import type { CargoServico, CustoOperacionalLinha } from "@/lib/estudo-custos";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id } = await params;

  const estudo = await carregarEstudoDaEmpresa(id, company!.id);
  if (!estudo) return NextResponse.json({ error: "Estudo não encontrado" }, { status: 404 });

  return NextResponse.json({
    resultado: estudo.resultadoCalculoJson ? JSON.parse(estudo.resultadoCalculoJson) : null,
    margemMinimaAceitavel: estudo.margemMinimaAceitavel,
    calculoConfirmadoEm: estudo.calculoConfirmadoEm,
  });
}

const patchSchema = z.object({
  margemMinimaAceitavel: z.number().min(0).max(99),
});

/**
 * Reúne os dados já confirmados nas etapas anteriores (Etapa 3: alíquota resolvida;
 * Etapa 4: custos por item — ramo Produto — ou cargos/custos operacionais/desconto —
 * ramo Serviço) e chama o motor de cálculo puro correspondente. Esta rota só monta o
 * input e persiste o resultado, nenhuma conta é feita aqui.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id } = await params;

  const estudo = await carregarEstudoDaEmpresa(id, company!.id);
  if (!estudo) return NextResponse.json({ error: "Estudo não encontrado" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Informe a margem mínima aceitável" }, { status: 400 });

  if (!estudo.tributosConfirmadoEm || !estudo.aliquotasJson) {
    return NextResponse.json({ error: "Confirme o regime tributário (Etapa 3) antes de calcular" }, { status: 409 });
  }
  if (!estudo.custosConfirmadoEm) {
    return NextResponse.json({ error: "Confirme os custos (Etapa 4) antes de calcular" }, { status: 409 });
  }

  const aliquotas = JSON.parse(estudo.aliquotasJson) as AliquotasResolvidas;

  if (estudo.ramo === "SERVICO") {
    if (!estudo.cargosJson || estudo.descontoPercentual == null || estudo.duracaoContratoMeses == null) {
      return NextResponse.json({ error: "Confirme os custos (Etapa 4) antes de calcular" }, { status: 409 });
    }
    const edital = await prisma.edital.findUnique({ where: { id: estudo.editalId! }, include: { proposal: true } });
    const valorTetoLote = edital?.valorGlobal ?? edital?.proposal?.valorGlobalReferencia ?? 0;

    const resultado = calcularDreServico({
      valorTetoLote,
      descontoPercentual: estudo.descontoPercentual,
      duracaoContratoMeses: estudo.duracaoContratoMeses,
      cargos: JSON.parse(estudo.cargosJson) as CargoServico[],
      custosOperacionais: estudo.custosOperacionaisJson
        ? (JSON.parse(estudo.custosOperacionaisJson) as CustoOperacionalLinha[])
        : [],
      aliquotas,
      margemMinimaAceitavel: parsed.data.margemMinimaAceitavel,
    });

    await prisma.estudoViabilidade.update({
      where: { id },
      data: {
        margemMinimaAceitavel: parsed.data.margemMinimaAceitavel,
        resultadoCalculoJson: JSON.stringify(resultado),
        calculoConfirmadoEm: new Date(),
      },
    });

    return NextResponse.json({ resultado, margemMinimaAceitavel: parsed.data.margemMinimaAceitavel });
  }

  if (!estudo.itensSnapshotJson) {
    return NextResponse.json({ error: "Confirme os custos (Etapa 4) antes de calcular" }, { status: 409 });
  }

  const itensSnapshot = JSON.parse(estudo.itensSnapshotJson) as {
    descricao: string;
    unidade: string;
    quantidade: number;
    valorTotal: number;
  }[];
  const custosItens = await prisma.custoItemEstudo.findMany({ where: { estudoId: id }, orderBy: { itemIndex: "asc" } });
  const custosPorIndice = new Map(custosItens.map((c) => [c.itemIndex, JSON.parse(c.custosJson)]));

  const itensCalculo: ItemCalculoInput[] = itensSnapshot.map((item, i) => ({
    descricao: item.descricao,
    quantidade: item.quantidade,
    valorTetoEdital: item.valorTotal,
    custos: custosPorIndice.get(i),
  }));

  const resultado = calcularViabilidade(itensCalculo, aliquotas.aliquotaTotalEfetiva, parsed.data.margemMinimaAceitavel);

  await prisma.estudoViabilidade.update({
    where: { id },
    data: {
      margemMinimaAceitavel: parsed.data.margemMinimaAceitavel,
      resultadoCalculoJson: JSON.stringify(resultado),
      calculoConfirmadoEm: new Date(),
    },
  });

  return NextResponse.json({ resultado, margemMinimaAceitavel: parsed.data.margemMinimaAceitavel });
}
