import jwt from "jsonwebtoken";

// Disparo da auditoria de habilitação de UM edital como uma execução própria da Vercel (cada
// uma ganha os 60s só pra ela). Sem cookie de usuário — a captação e o agendador não têm
// sessão — então a chamada leva um token assinado, curto e restrito àquele edital.

const PROPOSITO = "auditoria-habilitacao";

function segredo(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET não configurado");
  return s;
}

export function assinarTokenInterno(editalId: string): string {
  return jwt.sign({ editalId, proposito: PROPOSITO }, segredo(), { expiresIn: "15m" });
}

export function tokenInternoValido(token: string | null, editalId: string): boolean {
  if (!token) return false;
  try {
    const p = jwt.verify(token, segredo()) as { editalId?: string; proposito?: string };
    return p.proposito === PROPOSITO && p.editalId === editalId;
  } catch {
    return false;
  }
}

/** Endereço público do próprio app. Preferência: o da requisição que originou o trabalho. */
export function urlBaseDoApp(origem?: string): string {
  if (origem) return origem;
  if (process.env.APP_URL) return process.env.APP_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export type OpcoesDisparo = {
  origem?: string;
  /** Número da continuação (editais grandes são lidos em mais de uma execução). */
  continuacao?: number;
  /** "completo" lê o edital; "reconferir" só refaz a conferência com a IA, sem reler nada. */
  modo?: "completo" | "reconferir";
};

/**
 * Pede a execução da auditoria e devolve assim que a execução aceita (ela responde na hora e
 * trabalha em segundo plano). Nunca lança: se não conseguiu disparar, o edital segue
 * "Aguardando auditoria" e a varredura (varrerAuditoriasPendentes) tenta de novo depois.
 */
export async function dispararAuditoriaHabilitacao(editalId: string, opts: OpcoesDisparo = {}): Promise<boolean> {
  try {
    const res = await fetch(`${urlBaseDoApp(opts.origem)}/api/editais/${editalId}/habilitacao`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${assinarTokenInterno(editalId)}` },
      body: JSON.stringify({ continuacao: opts.continuacao ?? 0, modo: opts.modo ?? "completo" }),
    });
    if (!res.ok) {
      console.error(`Auditoria de habilitação do edital ${editalId} não iniciou (HTTP ${res.status}).`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`Auditoria de habilitação do edital ${editalId} não iniciou:`, err);
    return false;
  }
}
