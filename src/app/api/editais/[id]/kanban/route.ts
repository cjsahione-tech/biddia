import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireCompany } from "@/lib/api-utils";
import { dispararPipeline } from "@/lib/agents/pipeline";
import { logAudit } from "@/lib/agents/run-tracker";

const ETAPAS = [
  "OPORTUNIDADE",
  "QUALIFICACAO",
  "SEM_PROPOSTAS",
  "PRONTA_PARA_ENVIAR",
  "ENVIADA_PARA_DISPUTA",
  "CLASSIFICACAO",
  "ELIMINADA_APOS_CLASSIFICACAO",
  "ACEITA",
  "RECUSADA_DESCLASSIFICADA",
  "EM_CONTRATO",
  "FINALIZADA",
  "RASCUNHO",
] as const;

// Colunas que representam "não vamos seguir com este edital" — equivalentes ao antigo
// botão Reprovar. Qualquer outra coluna (fora "Oportunidade") equivale ao antigo Aprovar.
const ETAPAS_NEGATIVAS = new Set(["SEM_PROPOSTAS", "ELIMINADA_APOS_CLASSIFICACAO", "RECUSADA_DESCLASSIFICADA"]);

const ETAPA_LABEL: Record<string, string> = {
  OPORTUNIDADE: "Oportunidade",
  QUALIFICACAO: "Qualificação",
  SEM_PROPOSTAS: "Editais em preparação",
  PRONTA_PARA_ENVIAR: "Pronta para Enviar",
  ENVIADA_PARA_DISPUTA: "Enviada para Disputa",
  CLASSIFICACAO: "Classificação",
  ELIMINADA_APOS_CLASSIFICACAO: "Eliminada após Classificação",
  ACEITA: "Aceita",
  RECUSADA_DESCLASSIFICADA: "Recusada/Desclassificada",
  EM_CONTRATO: "Em contrato",
  FINALIZADA: "Finalizada",
  RASCUNHO: "Rascunho",
};

const schema = z.object({
  etapaKanban: z.enum(ETAPAS),
  ordemKanban: z.number().finite(),
});

// Move um card no quadro Kanban: muda a coluna (etapa) e a posição de arraste dentro
// dela. A primeira vez que um edital sai de "Oportunidade" ainda funciona como o antigo
// Aprovar/Reprovar: dispara o pipeline de agentes (se for para uma coluna de trabalho)
// ou marca como reprovado (se for direto para uma coluna de descarte).
export const maxDuration = 60;

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { company, error } = await requireCompany();
  if (error) return error;
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Movimentação inválida" }, { status: 400 });

  const edital = await prisma.edital.findFirst({ where: { id, companyId: company!.id } });
  if (!edital) return NextResponse.json({ error: "Edital não encontrado" }, { status: 404 });

  const { etapaKanban, ordemKanban } = parsed.data;
  const etapaMudou = etapaKanban !== edital.etapaKanban;

  let novoStatus = edital.status;
  let decidedAt = edital.decidedAt;
  let disparaPipeline = false;

  if (etapaMudou && edital.status === "NOVO" && etapaKanban !== "OPORTUNIDADE") {
    // Primeira decisão sobre este edital, tomada arrastando o card.
    decidedAt = new Date();
    if (ETAPAS_NEGATIVAS.has(etapaKanban)) {
      novoStatus = "REPROVADO";
    } else {
      novoStatus = "APROVADO";
      disparaPipeline = true;
    }
  }

  const updated = await prisma.edital.update({
    where: { id },
    // Qualquer arraste manual limpa o motivo de inatividade/exclusão (é a própria forma
    // de "recuperar" um card, sem precisar de UI dedicada) e conta como atividade.
    data: { etapaKanban, ordemKanban, status: novoStatus, decidedAt, motivoMovimentacao: null, ultimaMovimentacao: new Date() },
  });

  if (disparaPipeline) dispararPipeline(id, req);

  if (etapaMudou) {
    await logAudit(
      id,
      "Usuário",
      "Movimentação no quadro",
      "OK",
      `Card movido para "${ETAPA_LABEL[etapaKanban]}".` +
        (disparaPipeline ? " Pipeline de agentes disparado automaticamente." : "")
    );
  }

  return NextResponse.json({ edital: updated });
}
