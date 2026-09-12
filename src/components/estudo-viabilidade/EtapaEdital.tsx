"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatDate, formatValorEdital } from "@/lib/format";
import { parseItens } from "@/lib/proposal";
import type { EditalListItem, EstudoViabilidadeDetail } from "@/lib/types";

/** Etapa 1: escolher o edital de referência do estudo, reaproveitando o cadastro de
 * editais já existente (nenhuma tabela nova de editais/itens é criada aqui). */
export function EtapaEdital({
  estudo,
  onVinculado,
}: {
  estudo: EstudoViabilidadeDetail;
  onVinculado: (estudo: EstudoViabilidadeDetail) => void;
}) {
  if (estudo.edital) {
    return <EditalSelecionado estudo={estudo} onTrocar={() => onVinculado({ ...estudo, editalId: null, edital: null })} />;
  }
  return <SeletorDeEdital estudoId={estudo.id} onVinculado={onVinculado} />;
}

function SeletorDeEdital({
  estudoId,
  onVinculado,
}: {
  estudoId: string;
  onVinculado: (estudo: EstudoViabilidadeDetail) => void;
}) {
  const [editais, setEditais] = useState<EditalListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [vinculando, setVinculando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/editais")
      .then((r) => r.json())
      .then((data) => {
        if (data.editais) setEditais(data.editais);
      })
      .finally(() => setLoading(false));
  }, []);

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return editais;
    return editais.filter(
      (e) => e.titulo.toLowerCase().includes(termo) || e.orgaoNome.toLowerCase().includes(termo)
    );
  }, [editais, busca]);

  async function vincular(editalId: string) {
    setVinculando(editalId);
    setErro(null);
    try {
      const res = await fetch(`/api/estudos/${estudoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ editalId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErro(data.error ?? "Não foi possível vincular o edital.");
        return;
      }
      onVinculado(data.estudo);
    } finally {
      setVinculando(null);
    }
  }

  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por título ou órgão..."
          className="w-full rounded-lg border border-border bg-background py-2.5 pl-9 pr-3 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
        />
      </div>

      {erro && <p className="mt-2 text-xs text-danger">{erro}</p>}

      <div className="mt-4">
        {loading && (
          <div className="flex justify-center py-10 text-muted">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}

        {!loading && filtrados.length === 0 && (
          <p className="py-10 text-center text-sm text-muted">
            {editais.length === 0
              ? "Nenhum edital cadastrado ainda — capture um na aba Editais antes de continuar."
              : "Nenhum edital encontrado para essa busca."}
          </p>
        )}

        {!loading && filtrados.length > 0 && (
          <div className="max-h-[28rem] divide-y divide-border overflow-y-auto rounded-2xl border border-border">
            {filtrados.map((edital) => (
              <button
                key={edital.id}
                onClick={() => vincular(edital.id)}
                disabled={vinculando !== null}
                className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{edital.titulo}</p>
                  <p className="truncate text-xs text-muted">
                    {edital.orgaoNome} — {edital.municipio ?? "?"}/{edital.uf ?? "?"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span
                    className={`text-xs font-semibold ${edital.orcamentoSigiloso ? "italic text-muted" : "text-foreground"}`}
                  >
                    {formatValorEdital(edital.valorGlobal, edital.orcamentoSigiloso)}
                  </span>
                  {vinculando === edital.id && <Loader2 className="h-4 w-4 animate-spin text-brand" />}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EditalSelecionado({
  estudo,
  onTrocar,
}: {
  estudo: EstudoViabilidadeDetail;
  onTrocar: () => void;
}) {
  const edital = estudo.edital!;
  const itens = edital.proposal ? parseItens(edital.proposal.itensJson) : [];

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-surface/50 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs text-muted">{edital.modalidade ?? "Modalidade não informada"}</p>
            <h3 className="mt-1 text-base font-semibold text-foreground">{edital.titulo}</h3>
            <p className="mt-1 text-sm text-muted">
              {edital.orgaoNome} — {edital.municipio ?? "?"}/{edital.uf ?? "?"}
            </p>
          </div>
          <button
            onClick={onTrocar}
            className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-muted hover:text-danger"
          >
            <X className="h-3.5 w-3.5" /> Trocar edital
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-6">
          <div>
            <p className="text-xs text-muted">Valor estimado (teto)</p>
            <p className="mt-0.5 text-lg font-semibold text-foreground">
              {formatValorEdital(edital.valorGlobal, edital.orcamentoSigiloso)}
            </p>
          </div>
          {edital.dataEncerramentoProposta && (
            <div>
              <p className="text-xs text-muted">Encerra em</p>
              <p className="mt-0.5 text-sm font-medium text-foreground">{formatDate(edital.dataEncerramentoProposta)}</p>
            </div>
          )}
        </div>
      </div>

      {itens.length > 0 ? (
        <div>
          <h4 className="text-sm font-semibold text-foreground">Itens/lotes já identificados</h4>
          <div className="mt-2 overflow-x-auto rounded-2xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface text-left text-xs font-medium uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2.5">Descrição</th>
                  <th className="px-4 py-2.5">Unid.</th>
                  <th className="px-4 py-2.5 text-right">Qtd.</th>
                  <th className="px-4 py-2.5 text-right">Valor unit. (ref.)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {itens.map((item, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2.5 text-foreground">{item.descricao}</td>
                    <td className="px-4 py-2.5 text-muted">{item.unidade}</td>
                    <td className="px-4 py-2.5 text-right text-muted">{item.quantidade}</td>
                    <td className="px-4 py-2.5 text-right text-muted">{formatValorEdital(item.valorUnitario, false)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed border-border p-5 text-center text-sm text-muted">
          Este edital ainda não tem itens extraídos pelo Agente Financeiro — a próxima etapa (extração de requisitos
          via IA) vai identificá-los a partir do texto do edital.
        </p>
      )}

      <div className="flex justify-end">
        <Button disabled title="Etapa 2 ainda não implementada">
          Continuar para Requisitos
        </Button>
      </div>
    </div>
  );
}
