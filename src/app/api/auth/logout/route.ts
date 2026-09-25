import { NextResponse } from "next/server";
import { clearSessionCookie, clearAnalistaOrigemCookie } from "@/lib/auth";

export async function POST() {
  await clearSessionCookie();
  // Se o Analista fizer logout enquanto estiver "dentro" do login de um cliente, não deixa
  // o cookie de origem pendurado pra uma sessão futura restaurar sozinha.
  await clearAnalistaOrigemCookie();
  return NextResponse.json({ ok: true });
}
