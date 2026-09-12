"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CAMPOS_CUSTO_SERVICO, CAMPOS_CUSTO_PRODUTO, CUSTO_ITEM_VAZIO_SERVICO, CUSTO_ITEM_VAZIO_PRODUTO } from "@/lib/estudo-custos";
import type { EstudoViabilidadeDetail } from "@/lib/types";

type ItemSnapshot = { descricao: string; unidade: string; quantidade: number };

/** Etapa 4: custos por item/lote (campos condicionais por ramo) — preenchimento manual,
 * com atalho "aplicar a todos" para os campos que costumam repetir (ex: % de BDI). */
export function EtapaCustos({
  estudo,
  onUpdated,
}: {
  estudo: EstudoViabilidadeDetail;
  onUpdated: (estudo: EstudoViabilidadeDetail) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [loading, setLoading] = useState(true);
  const [itens, setItens] = useState<ItemSnapshot[]>([]);
  const [custos, setCustos] = useState<Record<number, Record<string, number>>>({});
  const [aplicarValor, setAplicarValor] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState<"rascunho" | "confirmar" | null>(null);

  const campos = estudo.ramo === "SERVICO" ? CAMPOS_CUSTO_SERVICO : CAMPOS_CUSTO_PRODUTO;
  const vazio = (estudo.ramo === "SERVICO" ? CUSTO_ITEM_VAZIO_SERVICO : CUSTO_ITEM_VAZIO_PRODUTO) as Record<
    string,
    number
  >;

  useEffect(() => {
    fetch(`/api/estudos/${estudo.id}/custos`)
      .then((r) => r.json())
      .then((data) => {
        if (data.itens) setItens(data.itens);
        if (data.custos) {
          const mapa: Record<number, Record<string, number>> = {};
          for (const c of data.custos as { itemIndex: number; custos: Record<string, number> }[]) {
            mapa[c.itemIndex] = { ...vazio, ...c.custos };
          }
          setCustos(mapa);
        }
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estudo.id]);

  function setCampo(itemIndex: number, campo: string, valor: number) {
    setCustos((prev) => ({ ...prev, [itemIndex]: { ...prev[itemIndex], [campo]: valor } }));
  }

  function aplicarATodos(campo: string) {
    const valor = Number(aplicarValor[campo] ?? 0);
    setCustos((prev) => {
      const novo: Record<number, Record<string, number>> = {};
      for (const [idx, c] of Object.entries(prev)) novo[Number(idx)] = { ...c, [campo]: valor };
      return novo;
    });
  }

  async function salvar(confirmar: boolean) {
    setSalvando(confirmar ? "confirmar" : "rascunho");
    setErro(null);
    try {
      const res = await fetch(`/api/estudos/${estudo.id}/custos`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itens: Object.entries(custos).map(([itemIndex, c]) => ({ itemIndex: Number(itemIndex), custos: c })),
          confirmar,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErro(data.error ?? "Não foi possível salvar os custos.");
        return;
      }
      onUpdated({ ...estudo, custosConfirmadoEm: data.custosConfirmadoEm });
      if (confirmar) setEditando(false);
    } finally {
      setSalvando(null);
    }
  }

  if (estudo.custosConfirmadoEm && !editando) {
    return <ResumoCustos qtdItens={itens.length} loading={loading} onEditar={() => setEditando(true)} />;
  }

  if (loading) {
    return (
      <div className="flex justify-center py-10 text-muted">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (itens.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted">
        Este edital ainda não tem itens/lotes identificados — volte à etapa Edital para gerar a proposta financeira
        primeiro.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-border bg-surface/50 p-4">
        <h4 className="text-sm font-semibold text-foreground">Aplicar a todos os itens</h4>
        <p className="mt-1 text-xs text-muted">
          Preenche o mesmo valor em todas as linhas — depois ajuste item por item se precisar.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {campos.map((campo) => (
            <div key={campo.key} className="flex items-center gap-1.5">
              <input
                type="number"
                step="0.01"
                placeholder={campo.label}
                value={aplicarValor[campo.key] ?? ""}
                onChange={(e) => setAplicarValor((prev) => ({ ...prev, [campo.key]: e.target.value }))}
                className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
              />
              <button
                onClick={() => aplicarATodos(campo.key)}
                className="shrink-0 rounded-lg border border-border px-2 py-1.5 text-xs font-medium text-foreground hover:bg-surface"
              >
                Aplicar
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="max-h-[32rem] overflow-auto rounded-2xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface text-left text-xs font-medium uppercase tracking-wide text-muted">
            <tr>
              <th className="sticky left-0 z-10 bg-surface px-4 py-2.5">Item</th>
              {campos.map((c) => (
                <th key={c.key} className="whitespace-nowrap px-3 py-2.5 text-right">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {itens.map((item, i) => (
              <tr key={i}>
                <td
                  className="sticky left-0 z-10 max-w-[220px] truncate bg-background px-4 py-2 text-foreground"
                  title={item.descricao}
                >
                  {item.descricao}
                </td>
                {campos.map((campo) => (
                  <td key={campo.key} className="px-3 py-2 text-right">
                    <input
                      type="number"
                      step="0.01"
                      value={custos[i]?.[campo.key] ?? 0}
                      onChange={(e) => setCampo(i, campo.key, Number(e.target.value))}
                      className="w-24 rounded-lg border border-border bg-background px-2 py-1 text-right text-xs text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {erro && <p className="text-xs text-danger">{erro}</p>}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => salvar(false)} loading={salvando === "rascunho"}>
          Salvar rascunho
        </Button>
        <Button onClick={() => salvar(true)} loading={salvando === "confirmar"}>
          Confirmar e continuar
        </Button>
      </div>
    </div>
  );
}

function ResumoCustos({
  qtdItens,
  loading,
  onEditar,
}: {
  qtdItens: number;
  loading: boolean;
  onEditar: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 rounded-xl bg-accent/10 px-4 py-2.5 text-sm text-accent">
        <span className="inline-flex items-center gap-1.5 font-medium">
          <CheckCircle2 className="h-4 w-4" /> Custos confirmados
        </span>
        <button onClick={onEditar} className="inline-flex items-center gap-1 text-xs font-medium hover:underline">
          <Pencil className="h-3 w-3" /> Editar novamente
        </button>
      </div>

      <div className="rounded-2xl border border-border bg-surface/50 p-5">
        <p className="text-sm text-foreground">
          Custos informados para {loading ? "..." : qtdItens} item(ns)/lote(s).
        </p>
      </div>
    </div>
  );
}
