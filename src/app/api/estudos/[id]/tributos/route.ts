import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";
import { estudoInclude, carregarEstudoDaEmpresa } from "@/lib/estudo-server";
import { resolverAliquotas } from "@/lib/tributos-server";

const patchSchema = z.object({
  regimeTributario: z.enum(["SIMPLES_NACIONAL", "LUCRO_PRESUMIDO", "LUCRO_REAL"]),
  anexoSimples: z.enum(["I", "III", "IV", "V"]).optional().nullable(),
  rbt12: z.number().min(0).optional().nullable(),
});

/** Etapa 3: escolhe o regime (e Anexo/RBT12 se Simples Nacional), resolve a alíquota
 * efetiva a partir da tabela de parâmetros da empresa e grava o resultado (snapshot)
 * no estudo — a resolução nunca lê números fixos no código. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id } = await params;

  const estudo = await carregarEstudoDaEmpresa(id, company!.id);
  if (!estudo) return NextResponse.json({ error: "Estudo não encontrado" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

  if (parsed.data.regimeTributario === "SIMPLES_NACIONAL" && !parsed.data.anexoSimples) {
    return NextResponse.json({ error: "Selecione o Anexo do Simples Nacional" }, { status: 400 });
  }
  if (parsed.data.regimeTributario === "SIMPLES_NACIONAL" && parsed.data.rbt12 == null) {
    return NextResponse.json({ error: "Informe o RBT12 (faturamento dos últimos 12 meses)" }, { status: 400 });
  }

  let aliquotas;
  try {
    aliquotas = await resolverAliquotas({
      companyId: company!.id,
      regime: parsed.data.regimeTributario,
      ramo: estudo.ramo,
      anexoSimples: parsed.data.anexoSimples,
      rbt12: parsed.data.rbt12,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Não foi possível resolver as alíquotas";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const updated = await prisma.estudoViabilidade.update({
    where: { id },
    data: {
      regimeTributario: parsed.data.regimeTributario,
      anexoSimples: parsed.data.regimeTributario === "SIMPLES_NACIONAL" ? parsed.data.anexoSimples : null,
      rbt12: parsed.data.regimeTributario === "SIMPLES_NACIONAL" ? parsed.data.rbt12 : null,
      aliquotasJson: JSON.stringify(aliquotas),
      tributosConfirmadoEm: new Date(),
    },
    include: estudoInclude,
  });

  return NextResponse.json({ estudo: updated });
}
