import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";
import { estudoInclude, carregarEstudoDaEmpresa } from "@/lib/estudo-server";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id } = await params;

  const estudo = await prisma.estudoViabilidade.findFirst({
    where: { id, companyId: company!.id },
    include: estudoInclude,
  });
  if (!estudo) return NextResponse.json({ error: "Estudo não encontrado" }, { status: 404 });

  return NextResponse.json({ estudo });
}

const patchSchema = z
  .object({
    editalId: z.string().min(1).nullable().optional(),
    nome: z.string().trim().max(120).nullable().optional(),
  })
  .refine((data) => data.editalId !== undefined || data.nome !== undefined, {
    message: "Informe editalId ou nome",
  });

/**
 * Duas mutações independentes no mesmo estudo, cada uma só aplicada se a chave
 * correspondente vier no corpo:
 * - Etapa 1: vincula (ou desvincula, com editalId: null) o edital de referência —
 *   confere que o edital pertence à mesma empresa antes de vincular, e trocar o edital
 *   invalida os requisitos revisados de um edital diferente.
 * - Nome livre do estudo (mostrado na listagem em vez do rótulo genérico do ramo) —
 *   string vazia é tratada como "remover o nome" (volta a mostrar o rótulo do ramo).
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id } = await params;

  const estudo = await carregarEstudoDaEmpresa(id, company!.id);
  if (!estudo) return NextResponse.json({ error: "Estudo não encontrado" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

  const data: { editalId?: string | null; requisitosJson?: null; requisitosConfirmadoEm?: null; nome?: string | null } = {};

  if (parsed.data.editalId !== undefined) {
    if (parsed.data.editalId) {
      const edital = await prisma.edital.findFirst({
        where: { id: parsed.data.editalId, companyId: company!.id },
        select: { id: true },
      });
      if (!edital) return NextResponse.json({ error: "Edital não encontrado" }, { status: 404 });
    }
    data.editalId = parsed.data.editalId;
    if (parsed.data.editalId !== estudo.editalId) {
      data.requisitosJson = null;
      data.requisitosConfirmadoEm = null;
    }
  }

  if (parsed.data.nome !== undefined) {
    data.nome = parsed.data.nome || null;
  }

  const updated = await prisma.estudoViabilidade.update({ where: { id }, data, include: estudoInclude });

  return NextResponse.json({ estudo: updated });
}

/** Exclui um estudo (rascunho ou simulação que não serve mais). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id } = await params;

  const estudo = await carregarEstudoDaEmpresa(id, company!.id);
  if (!estudo) return NextResponse.json({ error: "Estudo não encontrado" }, { status: 404 });

  await prisma.estudoViabilidade.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
