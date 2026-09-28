import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";

// Diagnóstico temporário — investigar por que o PNCP está indisponível a partir da
// Vercel (funciona normalmente de fora). Remover depois de identificar a causa.
export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

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
      return {
        nome,
        url,
        ms: Date.now() - inicio,
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        bodyPreview: bodyText.slice(0, 300),
      };
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

  const [busca, oficial] = await Promise.all([
    testar("busca (não-oficial, usada hoje)", "https://pncp.gov.br/api/search/?q=laborat%C3%B3rio&tipos_documento=edital&ordenacao=-data&pagina=1&tam_pagina=3&status=recebendo_proposta"),
    testar("api oficial (consulta de processo)", "https://pncp.gov.br/api/pncp/v1/orgaos/46179941000135/compras/2026/429"),
  ]);

  return NextResponse.json({ busca, oficial });
}
