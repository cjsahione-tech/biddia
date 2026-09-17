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

type GrupoHabilitacao = { categoriaEdital: string | null; itens: string[] };

// A habilitação vem agrupada exatamente como o próprio edital organiza suas seções (ex:
// "13.1 Regularidade Fiscal..." vira um grupo só) — mas análises antigas ainda têm o
// formato anterior, uma lista plana de strings, então aceita os dois.
function parseHabilitacaoGrupos(json: string | undefined): GrupoHabilitacao[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    if (parsed.every((g) => g && typeof g === "object" && "itens" in g)) {
      return parsed as GrupoHabilitacao[];
    }
    return parsed.length > 0 ? [{ categoriaEdital: null, itens: parsed as string[] }] : [];
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

function SectionHabilitacao({ grupos }: { grupos: GrupoHabilitacao[] }) {
  if (grupos.length === 0) return null;
  return (
    <div>
      <h4 className="text-sm font-semibold text-foreground">Habilitação exigida</h4>
      <div className="mt-2 space-y-4">
        {grupos.map((grupo, gi) => (
          <div key={gi}>
            {grupo.categoriaEdital && (
              <p className="text-xs font-medium uppercase tracking-wide text-muted">{grupo.categoriaEdital}</p>
            )}
            <ul className="mt-1.5 space-y-1.5">
              {grupo.itens.map((item, i) => (
                <li key={i} className="flex gap-2 text-sm text-foreground/80">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
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
            <SectionHabilitacao grupos={parseHabilitacaoGrupos(analysis.habilitacao)} />
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
