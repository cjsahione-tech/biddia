import jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

const JWT_SECRET = process.env.JWT_SECRET as string;
const COOKIE_NAME = "licitax_session";

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

type ResetPayload = { userId: string; purpose: "reset" };

// Token de redefinição de senha — mesmo segredo do token de sessão, mas com um "purpose"
// próprio pra um nunca ser aceito no lugar do outro. Vida curta (15min): é enviado por
// SMS e só serve pra essa única ação.
export function signResetToken(userId: string): string {
  return jwt.sign({ userId, purpose: "reset" } satisfies ResetPayload, JWT_SECRET, { expiresIn: "15m" });
}

export function verifyResetToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as ResetPayload;
    return payload.purpose === "reset" ? payload.userId : null;
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
