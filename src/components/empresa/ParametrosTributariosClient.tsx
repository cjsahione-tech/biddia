"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ANEXOS_SIMPLES, REGIME_LABEL, type AnexoSimples } from "@/lib/tributos";

type FaixaSimples = {
  id: string;
  anexo: AnexoSimples;
  faixa: number;
  rbt12Min: number;
  rbt12Max: number;
  aliquotaNominal: number;
  parcelaDeduzir: number;
};

type ParametroRegime = {
  id: string;
  regime: "LUCRO_PRESUMIDO" | "LUCRO_REAL";
  ramo: "SERVICO" | "PRODUTO";
  issOuIcms: number;
  pis: number;
  cofins: number;
  irpjCsll: number;
};

function formatRbt12(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v);
}

export function ParametrosTributariosClient() {
  const [faixasSimples, setFaixasSimples] = useState<FaixaSimples[]>([]);
  const [parametrosRegime, setParametrosRegime] = useState<ParametroRegime[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/parametros-tributarios")
      .then((r) => r.json())
      .then((data) => {
        if (data.faixasSimples) setFaixasSimples(data.faixasSimples);
        if (data.parametrosRegime) setParametrosRegime(data.parametrosRegime);
      })
      .finally(() => setLoading(false));
  }, []);

  function setFaixa(id: string, campo: "aliquotaNominal" | "parcelaDeduzir", valor: number) {
    setFaixasSimples((prev) => prev.map((f) => (f.id === id ? { ...f, [campo]: valor } : f)));
  }

  function setParametro(id: string, campo: "issOuIcms" | "pis" | "cofins" | "irpjCsll", valor: number) {
    setParametrosRegime((prev) => prev.map((p) => (p.id === id ? { ...p, [campo]: valor } : p)));
  }

  async function salvar() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/parametros-tributarios", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          faixasSimples: faixasSimples.map((f) => ({ id: f.id, aliquotaNominal: f.aliquotaNominal, parcelaDeduzir: f.parcelaDeduzir })),
          parametrosRegime: parametrosRegime.map((p) => ({
            id: p.id,
            issOuIcms: p.issOuIcms,
            pis: p.pis,
            cofins: p.cofins,
            irpjCsll: p.irpjCsll,
          })),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "Não foi possível salvar os parâmetros.");
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted" />
      </div>
    );
  }

  const inputClass =
    "w-24 rounded-lg border border-border bg-background px-2 py-1 text-right text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <Link href="/empresa" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Voltar
      </Link>

      <h1 className="mt-4 text-2xl font-semibold text-foreground">Parâmetros tributários</h1>
      <p className="mt-1 text-sm text-muted">
        Alíquotas usadas no Estudo de Viabilidade para calcular o preço mínimo viável. Nada fica fixo no sistema —
        atualize aqui sempre que a legislação mudar ou os valores não corresponderem à realidade da empresa.
      </p>
      <p className="mt-2 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
        Valores de partida baseados na LC 123/2006 (Simples Nacional) e em presunções típicas — o ISS varia por
        município, o ICMS por estado, e o IRPJ/CSLL do Lucro Real depende da margem real. Confirme com o contador da
        empresa antes de usar em uma proposta real.
      </p>

      {ANEXOS_SIMPLES.map((anexo) => {
        const linhas = faixasSimples.filter((f) => f.anexo === anexo.key);
        if (linhas.length === 0) return null;
        return (
          <div key={anexo.key} className="mt-8">
            <h2 className="text-sm font-semibold text-foreground">{anexo.label}</h2>
            <div className="mt-2 overflow-x-auto rounded-2xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-surface text-left text-xs font-medium uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-2.5">Faixa</th>
                    <th className="px-4 py-2.5">RBT12 (faturamento 12 meses)</th>
                    <th className="px-4 py-2.5 text-right">Alíquota nominal (%)</th>
                    <th className="px-4 py-2.5 text-right">Parcela a deduzir (R$)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {linhas.map((f) => (
                    <tr key={f.id}>
                      <td className="px-4 py-2 text-foreground">{f.faixa}</td>
                      <td className="px-4 py-2 text-muted">
                        {formatRbt12(f.rbt12Min)} — {formatRbt12(f.rbt12Max)}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <input
                          type="number"
                          step={0.01}
                          value={f.aliquotaNominal}
                          onChange={(e) => setFaixa(f.id, "aliquotaNominal", Number(e.target.value))}
                          className={inputClass}
                        />
                      </td>
                      <td className="px-4 py-2 text-right">
                        <input
                          type="number"
                          step={0.01}
                          value={f.parcelaDeduzir}
                          onChange={(e) => setFaixa(f.id, "parcelaDeduzir", Number(e.target.value))}
                          className={inputClass}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {(["LUCRO_PRESUMIDO", "LUCRO_REAL"] as const).map((regime) => {
        const linhas = parametrosRegime.filter((p) => p.regime === regime);
        if (linhas.length === 0) return null;
        return (
          <div key={regime} className="mt-8">
            <h2 className="text-sm font-semibold text-foreground">{REGIME_LABEL[regime]}</h2>
            <div className="mt-2 overflow-x-auto rounded-2xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-surface text-left text-xs font-medium uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-2.5">Ramo</th>
                    <th className="px-4 py-2.5 text-right">ISS/ICMS (%)</th>
                    <th className="px-4 py-2.5 text-right">PIS (%)</th>
                    <th className="px-4 py-2.5 text-right">COFINS (%)</th>
                    <th className="px-4 py-2.5 text-right">IRPJ + CSLL (%)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {linhas.map((p) => (
                    <tr key={p.id}>
                      <td className="px-4 py-2 text-foreground">{p.ramo === "SERVICO" ? "Serviço" : "Produto"}</td>
                      <td className="px-4 py-2 text-right">
                        <input
                          type="number"
                          step={0.01}
                          value={p.issOuIcms}
                          onChange={(e) => setParametro(p.id, "issOuIcms", Number(e.target.value))}
                          className={inputClass}
                        />
                      </td>
                      <td className="px-4 py-2 text-right">
                        <input
                          type="number"
                          step={0.01}
                          value={p.pis}
                          onChange={(e) => setParametro(p.id, "pis", Number(e.target.value))}
                          className={inputClass}
                        />
                      </td>
                      <td className="px-4 py-2 text-right">
                        <input
                          type="number"
                          step={0.01}
                          value={p.cofins}
                          onChange={(e) => setParametro(p.id, "cofins", Number(e.target.value))}
                          className={inputClass}
                        />
                      </td>
                      <td className="px-4 py-2 text-right">
                        <input
                          type="number"
                          step={0.01}
                          value={p.irpjCsll}
                          onChange={(e) => setParametro(p.id, "irpjCsll", Number(e.target.value))}
                          className={inputClass}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {error && <p className="mt-4 text-sm text-danger">{error}</p>}

      <div className="mt-6 flex items-center gap-3">
        <Button onClick={salvar} loading={saving}>
          Salvar alterações
        </Button>
        {saved && (
          <span className="inline-flex items-center gap-1.5 text-sm text-accent">
            <Check className="h-4 w-4" /> Salvo
          </span>
        )}
      </div>
    </div>
  );
}
