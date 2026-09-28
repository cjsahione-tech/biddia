import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";

// Diagnóstico temporário — investigar por que o PNCP está indisponível a partir da
// Vercel (funciona normalmente de fora). Remover depois de identificar a causa.
export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const url = "https://pncp.gov.br/api/search/?q=laborat%C3%B3rio&tipos_documento=edital&ordenacao=-data&pagina=1&tam_pagina=3&status=recebendo_proposta";
  const headers = {
    Accept: "application/json",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(url, { headers, cache: "no-store", signal: controller.signal });
    clearTimeout(timer);
    const bodyText = await res.text();
    return NextResponse.json({
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      responseHeaders: Object.fromEntries(res.headers.entries()),
      bodyPreview: bodyText.slice(0, 1000),
    });
  } catch (err) {
    return NextResponse.json({
      caught: true,
      name: err instanceof Error ? err.name : typeof err,
      message: err instanceof Error ? err.message : String(err),
      cause: err instanceof Error && err.cause ? String(err.cause) : null,
    });
  }
}
