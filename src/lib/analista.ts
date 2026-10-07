import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-utils";

/** Exige uma sessão de conta do tipo Analista (a única que tem carteira de clientes). */
export async function requireAnalista() {
  const { user, error } = await requireUser();
  if (error) return { user: null, error };
  if (user!.tipoConta !== "ANALISTA") {
    return { user: null, error: NextResponse.json({ error: "Só contas de Analista têm carteira" }, { status: 403 }) };
  }
  return { user, error: null };
}
