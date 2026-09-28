import { NextResponse } from "next/server";
import { fetchViaProxy } from "@/lib/proxy-fetch";

// Diagnóstico temporário do proxy do PNCP — token inline descartável (mesmo padrão já
// usado antes), evita depender de conta admin de teste em produção. Remover depois de
// identificar a causa.
const TOKEN_TEMPORARIO = "diag-proxy-7c2e91";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("token") !== TOKEN_TEMPORARIO) {
    return NextResponse.json({ error: "Acesso restrito" }, { status: 403 });
  }

  const envPresentes = {
    PROXY_HOST: !!process.env.PROXY_HOST,
    PROXY_PORT: !!process.env.PROXY_PORT,
    PROXY_USER: !!process.env.PROXY_USER,
    PROXY_PASS: !!process.env.PROXY_PASS,
  };

  const inicio = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const res = await fetchViaProxy("https://ipv4.webshare.io/", {
      headers: { Accept: "text/plain" },
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timer);
    const bodyText = await res.text();
    return NextResponse.json({ envPresentes, ms: Date.now() - inicio, ok: res.ok, status: res.status, bodyPreview: bodyText.slice(0, 200) });
  } catch (err) {
    return NextResponse.json({
      envPresentes,
      ms: Date.now() - inicio,
      caught: true,
      name: err instanceof Error ? err.name : typeof err,
      message: err instanceof Error ? err.message : String(err),
      cause: err instanceof Error && err.cause ? String(err.cause) : null,
    });
  }
}
