import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) {
    return { user: null, error: NextResponse.json({ error: "Não autenticado" }, { status: 401 }) };
  }
  return { user, error: null };
}

export async function requireCompany() {
  const { user, error } = await requireUser();
  if (error) return { user: null, company: null, error };
  if (!user!.company) {
    return {
      user,
      company: null,
      error: NextResponse.json({ error: "Cadastre os dados da empresa primeiro" }, { status: 409 }),
    };
  }
  return { user, company: user!.company, error: null };
}
