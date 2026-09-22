"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { KanbanCardModal } from "@/components/dashboard/KanbanCardModal";
import type { AgendaEditalItem } from "@/lib/types";

type TipoEvento = "abertura" | "habilitacao" | "visita" | "impugnacao";

const TIPOS: { key: TipoEvento; campo: keyof AgendaEditalItem; label: string; dot: string; texto: string }[] = [
  { key: "abertura", campo: "dataAberturaProposta", label: "Abertura das propostas", dot: "bg-blue-500", texto: "text-blue-600" },
  { key: "habilitacao", campo: "dataPrazoHabilitacao", label: "Prazo de habilitação", dot: "bg-orange-500", texto: "text-orange-600" },
  { key: "visita", campo: "dataVisitaTecnica", label: "Visita técnica", dot: "bg-purple-500", texto: "text-purple-600" },
  { key: "impugnacao", campo: "dataPrazoImpugnacao", label: "Impugnação/esclarecimento", dot: "bg-red-500", texto: "text-red-600" },
];

type Evento = { edital: AgendaEditalItem; tipo: (typeof TIPOS)[number] };

function diaKey(d: Date) {
  return format(d, "yyyy-MM-dd");
}

export function AgendaClient() {
  const [mesAtual, setMesAtual] = useState(() => startOfMonth(new Date()));
  const [editais, setEditais] = useState<AgendaEditalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [diaSelecionado, setDiaSelecionado] = useState<string | null>(null);
  const [editalAberto, setEditalAberto] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/editais/agenda");
      const data = await res.json();
      setEditais(data.editais ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- busca inicial ao montar a tela
    load();
  }, []);

  const eventosPorDia = useMemo(() => {
    const mapa = new Map<string, Evento[]>();
    for (const edital of editais) {
      for (const tipo of TIPOS) {
        const valor = edital[tipo.campo] as string | null;
        if (!valor) continue;
        const chave = valor.slice(0, 10);
        const lista = mapa.get(chave) ?? [];
        lista.push({ edital, tipo });
        mapa.set(chave, lista);
      }
    }
    return mapa;
  }, [editais]);

  const dias = useMemo(() => {
    const inicio = startOfWeek(startOfMonth(mesAtual), { weekStartsOn: 0 });
    const fim = endOfWeek(endOfMonth(mesAtual), { weekStartsOn: 0 });
    return eachDayOfInterval({ start: inicio, end: fim });
  }, [mesAtual]);

  const eventosDoDiaSelecionado = diaSelecionado ? (eventosPorDia.get(diaSelecionado) ?? []) : [];

  return (
    <div className="mx-auto max-w-[1400px] px-8 py-10">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Agenda</h1>
        <p className="mt-1 text-sm text-muted">
          Prazos dos editais atualmente em &ldquo;Qualificação&rdquo; — some daqui quando o card avança ou volta pra
          Rascunho.
        </p>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMesAtual((m) => subMonths(m, 1))}
            className="rounded-lg border border-border p-1.5 text-muted hover:bg-surface hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <h2 className="w-40 text-center text-sm font-medium capitalize text-foreground">
            {format(mesAtual, "MMMM 'de' yyyy", { locale: ptBR })}
          </h2>
          <button
            onClick={() => setMesAtual((m) => addMonths(m, 1))}
            className="rounded-lg border border-border p-1.5 text-muted hover:bg-surface hover:text-foreground"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
          {TIPOS.map((t) => (
            <span key={t.key} className="inline-flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${t.dot}`} /> {t.label}
            </span>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24 text-muted">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <div className="mt-4 overflow-hidden rounded-xl border border-border">
          <div className="grid grid-cols-7 border-b border-border bg-surface/50">
            {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d) => (
              <div key={d} className="px-2 py-2 text-center text-xs font-medium text-muted">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {dias.map((dia) => {
              const chave = diaKey(dia);
              const eventos = eventosPorDia.get(chave) ?? [];
              const foraDoMes = !isSameMonth(dia, mesAtual);
              const hoje = isSameDay(dia, new Date());
              return (
                <button
                  key={chave}
                  onClick={() => eventos.length > 0 && setDiaSelecionado(chave)}
                  disabled={eventos.length === 0}
                  className={`flex min-h-24 flex-col items-start gap-1 border-b border-r border-border p-2 text-left last:border-r-0 ${
                    foraDoMes ? "bg-surface/30 text-muted/50" : "text-foreground"
                  } ${eventos.length > 0 ? "hover:bg-surface" : "cursor-default"}`}
                >
                  <span
                    className={`text-xs font-medium ${hoje ? "rounded-full bg-brand px-1.5 py-0.5 text-white" : ""}`}
                  >
                    {format(dia, "d")}
                  </span>
                  {eventos.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {eventos.slice(0, 4).map((ev, i) => (
                        <span key={i} className={`h-1.5 w-1.5 rounded-full ${ev.tipo.dot}`} />
                      ))}
                      {eventos.length > 1 && <span className="text-[10px] text-muted">{eventos.length}</span>}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {diaSelecionado && (
        <div
          className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-foreground/40 px-4 py-10"
          onClick={() => setDiaSelecionado(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-border bg-background p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-foreground">
              {format(new Date(diaSelecionado + "T00:00:00"), "d 'de' MMMM", { locale: ptBR })}
            </h3>
            <div className="mt-3 space-y-2">
              {eventosDoDiaSelecionado.map((ev, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setEditalAberto(ev.edital.id);
                    setDiaSelecionado(null);
                  }}
                  className="flex w-full items-start gap-2 rounded-lg border border-border px-3 py-2 text-left hover:bg-surface"
                >
                  <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${ev.tipo.dot}`} />
                  <span className="min-w-0">
                    <span className={`block text-xs font-medium ${ev.tipo.texto}`}>{ev.tipo.label}</span>
                    <span className="block truncate text-sm text-foreground">{ev.edital.titulo}</span>
                    <span className="block truncate text-xs text-muted">{ev.edital.orgaoNome}</span>
                  </span>
                </button>
              ))}
            </div>
            <button
              onClick={() => setDiaSelecionado(null)}
              className="mt-4 w-full rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-surface"
            >
              Fechar
            </button>
          </div>
        </div>
      )}

      {editalAberto && (
        <KanbanCardModal
          editalId={editalAberto}
          onClose={() => setEditalAberto(null)}
          onUpdated={() => load()}
          onMoved={async () => load()}
          onDeleted={() => {
            setEditalAberto(null);
            load();
          }}
        />
      )}
    </div>
  );
}
