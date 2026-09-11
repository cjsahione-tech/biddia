import { FonteBadge } from "@/components/ui/FonteBadge";
import { AgentChat } from "@/components/editais/AgentChat";
import type { EditalDetail } from "@/lib/types";

function parseList(json: string | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function Section({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h4 className="text-sm font-semibold text-foreground">{title}</h4>
      <ul className="mt-2 space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2 text-sm text-foreground/80">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand" />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AnalysisTab({ edital, onUpdate }: { edital: EditalDetail; onUpdate: () => void }) {
  const analysis = edital.analysis;

  return (
    <div className="space-y-8">
      <div className="rounded-2xl border border-border bg-surface/50 p-5">
        <h4 className="text-sm font-semibold text-foreground">Objeto (conforme publicado no PNCP)</h4>
        <p className="mt-2 text-sm text-foreground/80">{edital.descricao}</p>
      </div>

      {!analysis && (
        <p className="py-4 text-center text-sm text-muted">
          O Agente Analista ainda não concluiu a leitura deste edital.
        </p>
      )}

      {analysis && (
        <>
          <div className="rounded-2xl border border-brand-light bg-brand-light/40 p-5">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-sm font-semibold text-brand">Resumo do objeto (Agente Analista)</h4>
              <FonteBadge baseadoEmTextoCompleto={analysis.baseadoEmTextoCompleto} />
            </div>
            <p className="mt-2 text-sm text-foreground/80">{analysis.resumoObjeto}</p>
          </div>

          <div className="grid grid-cols-2 gap-8">
            <Section title="Obrigações da contratada" items={parseList(analysis.obrigacoesContratada)} />
            <Section title="Habilitação exigida" items={parseList(analysis.habilitacao)} />
            <Section title="Requisitos obrigatórios" items={parseList(analysis.requisitosObrigatorios)} />
            <Section title="Requisitos adicionais" items={parseList(analysis.requisitosAdicionais)} />
          </div>

          <Section title="Riscos e pontos de atenção" items={parseList(analysis.riscos)} />

          <div className="rounded-2xl border border-border bg-surface/50 p-5">
            <h4 className="text-sm font-semibold text-foreground">Parecer do Agente Analista</h4>
            <p className="mt-2 text-sm text-foreground/80">{analysis.parecer}</p>
          </div>
        </>
      )}

      <AgentChat editalId={edital.id} agentKey="agente2-analista" agentLabel="Agente Analista" onCorrected={onUpdate} />
    </div>
  );
}
