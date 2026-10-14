import { prisma } from "@/lib/prisma";
import { contextoIAAtual } from "@/lib/ia-contexto";

// editalId -> empresa dona. Um edital não troca de dono, então o resultado vale pela vida da instância; o teto
// evita crescer sem fim numa instância que fica muito tempo no ar.
const donoDoEdital = new Map<string, string | null>();
const TETO_CACHE = 2000;

async function empresaDoEdital(editalId: string): Promise<string | null> {
  if (donoDoEdital.has(editalId)) return donoDoEdital.get(editalId) ?? null;
  const e = await prisma.edital.findUnique({ where: { id: editalId }, select: { companyId: true } });
  if (donoDoEdital.size >= TETO_CACHE) donoDoEdital.clear();
  donoDoEdital.set(editalId, e?.companyId ?? null);
  return e?.companyId ?? null;
}

/**
 * Grava quantos tokens uma chamada à IA gastou, no nome do agente (e da empresa) que a fez (ver ia-contexto.ts).
 * Nunca atrapalha o trabalho: se não conseguir gravar, só segue.
 */
export async function registrarConsumo(modelo: string, uso: { input_tokens?: number | null; output_tokens?: number | null } | null | undefined) {
  if (!uso) return;
  const contexto = contextoIAAtual();
  try {
    const companyId = contexto?.companyId ?? (contexto?.editalId ? await empresaDoEdital(contexto.editalId) : null);
    await prisma.consumoIA.create({
      data: {
        agente: contexto?.agente ?? "outros",
        editalId: contexto?.editalId ?? null,
        companyId,
        modelo,
        entrada: uso.input_tokens ?? 0,
        saida: uso.output_tokens ?? 0,
      },
    });
  } catch {
    /* medição é secundária */
  }
}
