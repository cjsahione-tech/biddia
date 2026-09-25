import jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

const JWT_SECRET = process.env.JWT_SECRET as string;
export const COOKIE_NAME = "licitax_session";
// Guarda a sessão do Analista enquanto ele estiver "dentro" do login de um cliente da
// carteira (ver POST /api/analista/carteira/[companyId]/entrar e /api/analista/voltar) —
// permite voltar pra própria conta sem logar de novo.
const COOKIE_ANALISTA_ORIGEM = "licitax_analista_origem";

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET não configurado no .env");
}

export type SessionPayload = {
  userId: string;
};

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" });
}

export function verifySession(token: string): SessionPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as SessionPayload;
  } catch {
    return null;
  }
}

export async function setSessionCookie(token: string) {
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export async function setAnalistaOrigemCookie(token: string) {
  const store = await cookies();
  store.set(COOKIE_ANALISTA_ORIGEM, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function getAnalistaOrigemToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(COOKIE_ANALISTA_ORIGEM)?.value ?? null;
}

export async function clearAnalistaOrigemCookie() {
  const store = await cookies();
  store.delete(COOKIE_ANALISTA_ORIGEM);
}

export async function getCurrentUser() {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const payload = verifySession(token);
  if (!payload) return null;

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    include: { company: { include: { keywords: true } } },
  });
  return user;
}
