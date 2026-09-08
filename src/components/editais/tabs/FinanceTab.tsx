import { useState } from "react";
import { Download, Check } from "lucide-react";
import { formatBRL } from "@/lib/format";
import { parseItens, aplicarDesconto } from "@/lib/proposal";
import { Button } from "@/components/ui/Button";
import type { EditalDetail } from "@/lib/types";

export function FinanceTab({ edital, onUpdate }: { edital: EditalDetail; onUpdate: () => void }) {
  const proposal = edital.proposal;
  const [descontoInput, setDescontoInput] = useState(String(proposal?.descontoPercentual ?? 0));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!proposal) {
    return (
      <p className="py-12 text-center text-sm text-muted">
        O Agente Financeiro ainda não montou a proposta para este edital.
      </p>
    );
  }

  const itens = parseItens(proposal.itensJson);
  const descontoNum = Number(descontoInput.replace(",", ".")) || 0;
  const itensComDesconto = aplicarDesconto(itens, descontoNum);

  const somaSemDesconto = itensComDesconto.reduce((acc, i) => acc + i.valorTotal, 0);
  const somaComDesconto = itensComDesconto.reduce((acc, i) => acc + i.valorTotalComDesconto, 0);
  const temDesconto = descontoNum > 0;

  async function salvarDesconto() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/editais/${edital.id}/proposal`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ descontoPercentual: descontoNum }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Não foi possível salvar o desconto");
        return;
      }
      setSaved(true);
      onUpdate();
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between rounded-2xl border border-border bg-surface/50 p-5">
        <div>
          <p className="text-xs text-muted">Valor de referência do edital (PNCP)</p>
          <p className="mt-1 text-xl font-semibold text-foreground">
            {formatBRL(proposal.valorGlobalReferencia)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted">Soma dos itens da proposta</p>
          <p className="mt-1 text-xl font-semibold text-brand">{formatBRL(somaSemDesconto)}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-brand-light bg-brand-light/30 p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <label htmlFor="desconto" className="block text-sm font-medium text-foreground">
              Desconto a aplicar sobre o valor unitário
            </label>
            <p className="mt-1 text-xs text-muted">
              Útil em disputas por menor preço: recalcula cada item (valor unitário com desconto × quantidade).
            </p>
            <div className="mt-2 flex items-center gap-2">
              <input
                id="desconto"
                type="number"
                min={0}
                max={100}
                step={0.01}
                value={descontoInput}
                onChange={(e) => setDescontoInput(e.target.value)}
                className="w-28 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
              />
              <span className="text-sm text-muted">%</span>
              <Button variant="secondary" onClick={salvarDesconto} loading={saving}>
                Salvar desconto
              </Button>
              {saved && (
                <span className="inline-flex items-center gap-1 text-sm text-accent">
                  <Check className="h-4 w-4" /> Salvo
                </span>
              )}
            </div>
            {error && <p className="mt-1 text-xs text-danger">{error}</p>}
          </div>

          <div className="text-right">
            <p className="text-xs text-muted">Valor global da proposta (com desconto)</p>
            <p className="mt-1 text-2xl font-semibold text-brand">{formatBRL(somaComDesconto)}</p>
          </div>
        </div>

        <a
          href={`/api/editais/${edital.id}/proposal/planilha`}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-surface"
        >
          <Download className="h-4 w-4" /> Baixar planilha da proposta (.xlsx)
        </a>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface text-left text-xs font-medium uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-3">Descrição</th>
              <th className="px-4 py-3">Unid.</th>
              <th className="px-4 py-3 text-right">Qtd.</th>
              <th className="px-4 py-3 text-right">Valor unit.</th>
              <th className="px-4 py-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {itensComDesconto.map((item, i) => (
              <tr key={i}>
                <td className="px-4 py-3 text-foreground">{item.descricao}</td>
                <td className="px-4 py-3 text-muted">{item.unidade}</td>
                <td className="px-4 py-3 text-right text-muted">{item.quantidade}</td>
                <td className="px-4 py-3 text-right">
                  {temDesconto ? (
                    <div>
                      <span className="text-xs text-muted line-through">{formatBRL(item.valorUnitario)}</span>
                      <span className="ml-1.5 font-medium text-brand">
                        {formatBRL(item.valorUnitarioComDesconto)}
                      </span>
                    </div>
                  ) : (
                    <span className="text-muted">{formatBRL(item.valorUnitario)}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right font-medium text-foreground">
                  {formatBRL(item.valorTotalComDesconto)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {proposal.observacoes && (
        <div className="rounded-2xl border border-warning/30 bg-warning/5 p-5">
          <h4 className="text-sm font-semibold text-warning">Observações do Agente Financeiro</h4>
          <p className="mt-2 text-sm text-foreground/80">{proposal.observacoes}</p>
        </div>
      )}
    </div>
  );
}
