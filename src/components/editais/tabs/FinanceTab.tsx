import { useRef, useState } from "react";
import { Download, Check, Upload, FileSpreadsheet } from "lucide-react";
import { formatBRL } from "@/lib/format";
import { parseItens, aplicarDesconto } from "@/lib/proposal";
import { Button } from "@/components/ui/Button";
import { FonteBadge } from "@/components/ui/FonteBadge";
import { AgentChat } from "@/components/editais/AgentChat";
import type { EditalDetail } from "@/lib/types";

// Mesmo teto prático usado nos outros uploads pequenos da plataforma (corpo em base64,
// ~33% maior que o arquivo, contra o limite fixo de ~4,5MB da Vercel).
const TAMANHO_MAXIMO_PLANILHA = 3.5 * 1024 * 1024;

export function FinanceTab({ edital, onUpdate }: { edital: EditalDetail; onUpdate: () => void }) {
  const proposal = edital.proposal;
  const [descontoInput, setDescontoInput] = useState(String(proposal?.descontoPercentual ?? 0));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Importação de planilha própria (substitui os itens que o Agente Financeiro montou).
  const importInputRef = useRef<HTMLInputElement>(null);
  const [importando, setImportando] = useState(false);
  const [erroImportacao, setErroImportacao] = useState<string | null>(null);
  const [avisosImportacao, setAvisosImportacao] = useState<string[]>([]);
  const [sucessoImportacao, setSucessoImportacao] = useState<string | null>(null);

  async function handleSelecionarArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setErroImportacao(null);
    setAvisosImportacao([]);
    setSucessoImportacao(null);

    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      setErroImportacao("Envie um arquivo .xlsx (Excel).");
      return;
    }
    if (file.size > TAMANHO_MAXIMO_PLANILHA) {
      setErroImportacao(`Arquivo muito grande (máx. ${(TAMANHO_MAXIMO_PLANILHA / 1024 / 1024).toFixed(1)}MB).`);
      return;
    }

    setImportando(true);
    try {
      const arquivoBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });

      const res = await fetch(`/api/editais/${edital.id}/proposal/importar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ arquivoBase64 }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErroImportacao(data.error ?? "Não foi possível importar essa planilha.");
        return;
      }

      const qtd = parseItens(data.proposal.itensJson).length;
      setSucessoImportacao(`Planilha importada: ${qtd} ite${qtd === 1 ? "m" : "ns"} na proposta.`);
      setAvisosImportacao(data.avisos ?? []);
      onUpdate();
    } finally {
      setImportando(false);
    }
  }

  const importarPlanilhaBox = (
    <div className="rounded-2xl border border-border bg-surface/30 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h4 className="text-sm font-semibold text-foreground">Importar planilha própria</h4>
          <p className="mt-1 text-xs text-muted">
            Já tem uma planilha pronta com os itens da proposta? Envie aqui para substituir a que o Agente
            Financeiro montou automaticamente. Use o modelo abaixo para garantir o formato certo.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <a
            href={`/api/editais/${edital.id}/proposal/modelo`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-surface"
          >
            <FileSpreadsheet className="h-4 w-4" /> Baixar modelo (.xlsx)
          </a>
          <input ref={importInputRef} type="file" accept=".xlsx" className="hidden" onChange={handleSelecionarArquivo} />
          <Button
            variant="secondary"
            onClick={() => importInputRef.current?.click()}
            loading={importando}
          >
            {!importando && <Upload className="h-4 w-4" />} Importar planilha (.xlsx)
          </Button>
        </div>
      </div>

      {erroImportacao && <p className="mt-3 text-xs text-danger">{erroImportacao}</p>}
      {sucessoImportacao && (
        <p className="mt-3 inline-flex items-center gap-1 text-xs text-accent">
          <Check className="h-3.5 w-3.5" /> {sucessoImportacao}
        </p>
      )}
      {avisosImportacao.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-warning">
          {avisosImportacao.map((a, i) => (
            <li key={i}>⚠ {a}</li>
          ))}
        </ul>
      )}
    </div>
  );

  if (!proposal) {
    return (
      <div className="space-y-6">
        <p className="py-12 text-center text-sm text-muted">
          O Agente Financeiro ainda não montou a proposta para este edital.
        </p>
        {importarPlanilhaBox}
        <AgentChat editalId={edital.id} agentKey="agente3-financeiro" agentLabel="Agente Financeiro" onCorrected={onUpdate} />
      </div>
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
      <FonteBadge baseadoEmTextoCompleto={proposal.baseadoEmTextoCompleto} />

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

      {importarPlanilhaBox}

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

      <AgentChat editalId={edital.id} agentKey="agente3-financeiro" agentLabel="Agente Financeiro" onCorrected={onUpdate} />
    </div>
  );
}
