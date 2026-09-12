import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";
import { garantirParametrosTributarios } from "@/lib/tributos-server";

/** Tela de parâmetros tributários: nenhuma alíquota fica fixa no código — tudo aqui é
 * lido/gravado nas tabelas FaixaSimplesNacional/ParametroTributarioRegime da empresa. */
export async function GET() {
  const { company, error } = await requireCompany();
  if (error) return error;

  await garantirParametrosTributarios(company!.id);

  const [faixasSimples, parametrosRegime] = await Promise.all([
    prisma.faixaSimplesNacional.findMany({
      where: { companyId: company!.id },
      orderBy: [{ anexo: "asc" }, { faixa: "asc" }],
    }),
    prisma.parametroTributarioRegime.findMany({
      where: { companyId: company!.id },
      orderBy: [{ regime: "asc" }, { ramo: "asc" }],
    }),
  ]);

  return NextResponse.json({ faixasSimples, parametrosRegime });
}

const patchSchema = z.object({
  faixasSimples: z
    .array(
      z.object({
        id: z.string().min(1),
        aliquotaNominal: z.number().min(0).max(100),
        parcelaDeduzir: z.number().min(0),
      })
    )
    .optional()
    .default([]),
  parametrosRegime: z
    .array(
      z.object({
        id: z.string().min(1),
        issOuIcms: z.number().min(0).max(100),
        pis: z.number().min(0).max(100),
        cofins: z.number().min(0).max(100),
        irpjCsll: z.number().min(0).max(100),
      })
    )
    .optional()
    .default([]),
});

/** Salva as edições do usuário — cada linha já existe (semeada por garantirParametros-
 * Tributarios), então isto é sempre um update em lote, nunca cria linha nova. */
export async function PATCH(req: Request) {
  const { company, error } = await requireCompany();
  if (error) return error;

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

  await prisma.$transaction([
    ...parsed.data.faixasSimples.map((f) =>
      prisma.faixaSimplesNacional.updateMany({
        where: { id: f.id, companyId: company!.id },
        data: { aliquotaNominal: f.aliquotaNominal, parcelaDeduzir: f.parcelaDeduzir },
      })
    ),
    ...parsed.data.parametrosRegime.map((p) =>
      prisma.parametroTributarioRegime.updateMany({
        where: { id: p.id, companyId: company!.id },
        data: { issOuIcms: p.issOuIcms, pis: p.pis, cofins: p.cofins, irpjCsll: p.irpjCsll },
      })
    ),
  ]);

  const [faixasSimples, parametrosRegime] = await Promise.all([
    prisma.faixaSimplesNacional.findMany({
      where: { companyId: company!.id },
      orderBy: [{ anexo: "asc" }, { faixa: "asc" }],
    }),
    prisma.parametroTributarioRegime.findMany({
      where: { companyId: company!.id },
      orderBy: [{ regime: "asc" }, { ramo: "asc" }],
    }),
  ]);

  return NextResponse.json({ faixasSimples, parametrosRegime });
}
