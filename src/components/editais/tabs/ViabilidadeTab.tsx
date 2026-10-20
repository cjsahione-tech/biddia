"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { formatBRL } from "@/lib/format";
import type { ResultadoCalculoViabilidade } from "@/lib/calculo-viabilidade";

type Estudo = {
  id: string;
  editalId: string | null;
  ramo: "SERVICO" | "PRODUTO";
  nome: string | null;
  regimeTributario: string | null;
  resultadoCalculoJson: string | null;
  updatedAt: string;
};

const REGIME: Record<string, string> = { SIMPLES_NACIONAL: "Simples Nacional", LUCRO_PRESUMIDO: "Lucro Presumido", LUCRO_REAL: "Lucro Real" };
const DECISAO = {
  PARTICIPAR: { texto: "Sim", cor: "bg-[#ddf3e7] text-[#14532d]" },
  PARTICIPAR_COM_RESSALVAS: { texto: "Com ressalvas", cor: "bg-[#fef3c7] text-[#92400e]" },
  NAO_PARTICIPAR: { texto: "Não", cor: "bg-[#fde4e4] text-[#7f1d1d]" },
} as const;

function lerResultado(json: string | null): ResultadoCalculoViabilidade | null {
  if (!json) return null;
  try {
    const r = JSON.parse(json);
    return r?.consolidado && r?.recomendacao ? (r as ResultadoCalculoViabilidade) : null;
  } catch {
    return null;
  }
}

/**
 * Aba "Viabilidade" do edital no celular: resumo do estudo de viabilidade ligado a este edital (o estudo completo
 * continua sendo o passo a passo de Estudo de Viabilidade). Só leitura.
 */
export function ViabilidadeTab({ editalId }: { editalId: string }) {
  const [estudos, setEstudos] = useState<Estudo[] | null>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    let cancelado = false;
    fetch("/api/estudos")
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const d = await r.json();
        if (!cancelado) setEstudos((d.estudos as Estudo[]).filter((e) => e.editalId === editalId));
      })
      .catch(() => !cancelado && setErro(true));
    return () => {
      cancelado = true;
    };
  }, [editalId]);

  if (erro) return <p className="text-sm text-danger">Não foi possível carregar o estudo de viabilidade.</p>;
  if (!estudos) {
    return (
      <div className="flex justify-center py-10 text-muted">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (estudos.length === 0) {
    return (
      <div className="rounded-[22px] bg-white p-5 text-center">
        <p className="text-[15px] font-bold text-foreground">Ainda não há estudo para este edital</p>
        <p className="mt-1 text-xs text-muted">O estudo calcula custos, tributos e a margem para decidir se vale participar.</p>
        <Link href="/estudo-viabilidade" className="mt-3 inline-flex h-11 items-center justify-center rounded-[22px] bg-brand px-5 text-sm font-bold text-white">
          Criar estudo de viabilidade
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {estudos.map((e) => {
        const r = lerResultado(e.resultadoCalculoJson);
        const d = r ? DECISAO[r.recomendacao.decisao] : null;
        return (
          <div key={e.id} className="space-y-3 rounded-[22px] bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[15px] font-bold text-foreground">Vale participar?</p>
                <p className="truncate text-xs text-muted">{e.nome ?? (e.ramo === "SERVICO" ? "Estudo de serviço" : "Estudo de produto")}</p>
              </div>
              {d && <span className={`flex-none rounded-[10px] px-3 py-1 text-xs font-bold ${d.cor}`}>{d.texto}</span>}
            </div>
            {r ? (
              <>
                <p className="text-[13px] text-foreground">{r.recomendacao.motivo}</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-2xl bg-background p-3">
                    <p className="text-[11px] text-muted">Custo total</p>
                    <p className="font-[family-name:var(--font-rubik)] text-[17px] font-semibold text-foreground">
                      {formatBRL(r.consolidado.custoDiretoTotal + r.consolidado.despesasIndiretasTotal)}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-background p-3">
                    <p className="text-[11px] text-muted">Margem estimada</p>
                    <p className="font-[family-name:var(--font-rubik)] text-[17px] font-semibold text-foreground">{r.consolidado.margemLiquidaConsolidada.toFixed(1).replace(".", ",")}%</p>
                  </div>
                  <div className="rounded-2xl bg-background p-3">
                    <p className="text-[11px] text-muted">Valor do edital</p>
                    <p className="text-[14px] font-bold text-foreground">{formatBRL(r.consolidado.valorTetoTotal)}</p>
                  </div>
                  <div className="rounded-2xl bg-background p-3">
                    <p className="text-[11px] text-muted">Preço mínimo viável</p>
                    <p className="text-[14px] font-bold text-foreground">{formatBRL(r.consolidado.precoMinimoTotal)}</p>
                  </div>
                </div>
                <p className="text-[11.5px] text-muted">
                  {r.consolidado.qtdItensViaveis} item(ns) viável(is) · {r.consolidado.qtdItensMarginais} marginal(is) · {r.consolidado.qtdItensInviaveis} inviável(is)
                </p>
              </>
            ) : (
              <p className="text-xs text-muted">O cálculo ainda não foi concluído. Abra o estudo para continuar de onde parou.</p>
            )}
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted">{e.regimeTributario ? REGIME[e.regimeTributario] ?? e.regimeTributario : "Regime não escolhido"}</span>
              <Link href={`/estudo-viabilidade/${e.id}`} className="font-bold text-brand">
                Abrir estudo completo →
              </Link>
            </div>
          </div>
        );
      })}
    </div>
  );
}
