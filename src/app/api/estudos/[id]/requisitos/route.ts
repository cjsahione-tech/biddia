import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";
import { estudoInclude, carregarEstudoDaEmpresa } from "@/lib/estudo-server";
import { extrairRequisitosEstudo } from "@/lib/agents/estudo-requisitos";

export const maxDuration = 60;

/** Dispara a extração via IA (Etapa 2). Só popula requisitosJson para revisão — nunca
 * confirma sozinho, mesmo que a extração pareça completa. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id } = await params;

  const estudo = await carregarEstudoDaEmpresa(id, company!.id);
  if (!estudo) return NextResponse.json({ error: "Estudo não encontrado" }, { status: 404 });
  if (!estudo.editalId) {
    return NextResponse.json({ error: "Selecione um edital antes de extrair os requisitos" }, { status: 409 });
  }

  let requisitos;
  try {
    requisitos = await extrairRequisitosEstudo(estudo.editalId, estudo.ramo);
  } catch (err) {
    console.error(`Falha ao extrair requisitos do estudo ${id}:`, err);
    return NextResponse.json(
      { error: "Não foi possível extrair os requisitos agora. Tente novamente em instantes." },
      { status: 502 }
    );
  }

  const updated = await prisma.estudoViabilidade.update({
    where: { id },
    data: { requisitosJson: JSON.stringify(requisitos), requisitosConfirmadoEm: null },
    include: estudoInclude,
  });

  return NextResponse.json({ estudo: updated });
}

const patchSchema = z.object({
  objeto: z.string().max(2000),
  criterioJulgamento: z.string().max(500),
  prazoExecucao: z.string().max(500),
  localEntrega: z.string().max(500),
  formaPagamento: z.string().max(500),
  garantiasExigidas: z.string().max(1000),
  equipeMinima: z.array(z.string().max(300)).max(50),
  certificacoesExigidas: z.array(z.string().max(300)).max(50),
  especificacaoTecnica: z.string().max(2000),
  prazoEntrega: z.string().max(500),
  baseadoEmTextoCompleto: z.boolean(),
});

/** Salva os requisitos (possivelmente editados pelo usuário) e confirma a etapa — a
 * revisão humana é obrigatória antes de prosseguir, então esta rota sempre grava
 * requisitosConfirmadoEm junto (não existe um "salvar rascunho" separado). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id } = await params;

  const estudo = await carregarEstudoDaEmpresa(id, company!.id);
  if (!estudo) return NextResponse.json({ error: "Estudo não encontrado" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

  const updated = await prisma.estudoViabilidade.update({
    where: { id },
    data: { requisitosJson: JSON.stringify(parsed.data), requisitosConfirmadoEm: new Date() },
    include: estudoInclude,
  });

  return NextResponse.json({ estudo: updated });
}
