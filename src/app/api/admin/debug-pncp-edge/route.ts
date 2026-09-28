import { NextResponse } from "next/server";

// Diagnóstico temporário (runtime Edge, não Node) — testar se o bloqueio do PNCP é
// específico do compute regional (gru1) ou também vale pra rede Edge da Vercel, que sai
// por IPs diferentes. Token inline descartável só pra não expor publicamente sem
// autenticação (Edge Runtime não roda Prisma, então não dá pra usar requireAdmin aqui).
// Remover esta rota inteira depois de concluído o diagnóstico.
export const runtime = "edge";

const TOKEN_TEMPORARIO = "diag-pncp-edge-9f13a2";

const headers = {
  Accept: "application/json",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
};

async function testar(nome: string, url: string) {
  const inicio = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    const res = await fetch(url, { headers, cache: "no-store", signal: controller.signal });
    clearTimeout(timer);
    const bodyText = await res.text();
    return { nome, url, ms: Date.now() - inicio, ok: res.ok, status: res.status, bodyPreview: bodyText.slice(0, 200) };
  } catch (err) {
    return {
      nome,
      url,
      ms: Date.now() - inicio,
      caught: true,
      name: err instanceof Error ? err.name : typeof err,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("token") !== TOKEN_TEMPORARIO) {
    return NextResponse.json({ error: "Acesso restrito" }, { status: 403 });
  }

  const [oficial, comprasgov] = await Promise.all([
    testar("api oficial pncp (edge)", "https://pncp.gov.br/api/pncp/v1/orgaos/46179941000135/compras/2026/429"),
    testar("compras.gov.br (controle, edge)", "https://dadosabertos.compras.gov.br/modulo-uasg/1_consultarUasg?codigoUasg=925954&statusUasg=true"),
  ]);

  return NextResponse.json({ runtime: "edge", oficial, comprasgov });
}
