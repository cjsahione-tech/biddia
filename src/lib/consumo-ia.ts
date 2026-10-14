import { prisma } from "@/lib/prisma";
import { contextoIAAtual } from "@/lib/ia-contexto";

/**
 * Grava quantos tokens uma chamada à IA gastou, no nome do agente que a fez (ver ia-contexto.ts).
 * Nunca atrapalha o trabalho: se não conseguir gravar, só segue.
 */
export async function registrarConsumo(modelo: string, uso: { input_tokens?: number | null; output_tokens?: number | null } | null | undefined) {
  if (!uso) return;
  const contexto = contextoIAAtual();
  try {
    await prisma.consumoIA.create({
      data: {
        agente: contexto?.agente ?? "outros",
        editalId: contexto?.editalId ?? null,
        modelo,
        entrada: uso.input_tokens ?? 0,
        saida: uso.output_tokens ?? 0,
      },
    });
  } catch {
    /* medição é secundária */
  }
}
