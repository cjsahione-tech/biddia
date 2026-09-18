"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  ComposedChart,
  Line,
  Legend,
} from "recharts";
import type { ContagemComValor, PontoEvolucaoMensal } from "@/lib/resultados";
import { PALETA_CATEGORIAS, COR_BRAND, COR_GANHO, COR_PERDA } from "@/lib/chart-colors";
import { formatBRL } from "@/lib/format";

const TOOLTIP_STYLE = {
  borderRadius: 10,
  border: "1px solid var(--border)",
  fontSize: 12,
  boxShadow: "0 4px 16px rgba(15,23,42,0.08)",
};

function TruncatedTick({ x, y, payload }: { x?: number; y?: number; payload?: { value: string } }) {
  const texto = payload?.value ?? "";
  const curto = texto.length > 22 ? `${texto.slice(0, 21)}…` : texto;
  return (
    <text x={x} y={y} dy={4} textAnchor="end" fontSize={11} fill="var(--muted)">
      {curto}
    </text>
  );
}

/** Barras horizontais — usado pelo funil de etapas, distribuição por UF, tipo de objeto e principais órgãos. */
export function BarraHorizontal({
  itens,
  cor = COR_BRAND,
  sufixoValor,
}: {
  itens: ContagemComValor[];
  cor?: string;
  sufixoValor?: (item: ContagemComValor) => string;
}) {
  if (itens.length === 0) {
    return <p className="py-8 text-center text-sm text-muted">Sem dados para este filtro.</p>;
  }

  const altura = Math.max(120, itens.length * 34);

  return (
    <ResponsiveContainer width="100%" height={altura}>
      <BarChart data={itens} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
        <YAxis
          type="category"
          dataKey="label"
          width={140}
          axisLine={false}
          tickLine={false}
          tick={<TruncatedTick />}
          // Sem isso, o recharts esconde ticks que ACHA que vão se sobrepor
          // (interval="preserveEnd" por padrão) — mas a altura do gráfico já é calculada
          // pra caber uma linha por item (ver `altura` acima), então forçar todos a
          // aparecer é seguro e corrige rótulos sumindo em listas com poucos itens.
          interval={0}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          formatter={(valor, _nome, item) => {
            const it = item.payload as ContagemComValor;
            return [sufixoValor ? sufixoValor(it) : `${valor}`, "Quantidade"];
          }}
        />
        <Bar dataKey="quantidade" fill={cor} radius={[0, 6, 6, 0]} maxBarSize={22} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Rosca (donut) — usado pela distribuição por portal, com legenda mostrando quantidade e valor. */
export function DonutPortal({ itens }: { itens: ContagemComValor[] }) {
  if (itens.length === 0) {
    return <p className="py-8 text-center text-sm text-muted">Sem dados para este filtro.</p>;
  }
  const total = itens.reduce((acc, i) => acc + i.quantidade, 0);

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <ResponsiveContainer width="100%" height={200} className="max-w-[200px]">
        <PieChart>
          <Pie data={itens} dataKey="quantidade" nameKey="label" innerRadius={55} outerRadius={82} paddingAngle={2}>
            {itens.map((item, i) => (
              <Cell key={item.chave} fill={PALETA_CATEGORIAS[i % PALETA_CATEGORIAS.length]} stroke="var(--background)" strokeWidth={2} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(valor, _nome, item) => {
              const it = item.payload as ContagemComValor;
              return [`${valor} (${formatBRL(it.valor)})`, it.label];
            }}
          />
        </PieChart>
      </ResponsiveContainer>
      <ul className="w-full flex-1 space-y-2">
        {itens.map((item, i) => (
          <li key={item.chave} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2 text-foreground">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: PALETA_CATEGORIAS[i % PALETA_CATEGORIAS.length] }}
              />
              <span className="truncate">{item.label}</span>
            </span>
            <span className="shrink-0 text-xs text-muted">
              {item.quantidade} · {total > 0 ? Math.round((item.quantidade / total) * 100) : 0}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Evolução mensal — barras de captados (fundo) com linhas de ganhos/perdidos sobrepostas. */
export function EvolucaoMensalChart({ pontos }: { pontos: PontoEvolucaoMensal[] }) {
  if (pontos.length === 0) {
    return <p className="py-8 text-center text-sm text-muted">Sem dados para este filtro.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={pontos} margin={{ top: 8, right: 12, bottom: 0, left: -20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => LEGENDA[v] ?? v} />
        <Bar dataKey="captados" name="captados" fill="var(--brand-light)" radius={[4, 4, 0, 0]} maxBarSize={28} />
        <Line type="monotone" dataKey="ganhos" name="ganhos" stroke={COR_GANHO} strokeWidth={2.5} dot={{ r: 3 }} />
        <Line type="monotone" dataKey="perdidos" name="perdidos" stroke={COR_PERDA} strokeWidth={2.5} dot={{ r: 3 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

const LEGENDA: Record<string, string> = { captados: "Captados", ganhos: "Ganhos", perdidos: "Perdidos" };
