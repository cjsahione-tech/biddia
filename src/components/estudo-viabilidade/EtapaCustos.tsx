"use client";

import { EtapaCustosProduto } from "@/components/estudo-viabilidade/EtapaCustosProduto";
import { EtapaCustosServico } from "@/components/estudo-viabilidade/EtapaCustosServico";
import type { EstudoViabilidadeDetail } from "@/lib/types";

/** Etapa 4: dispatcher por ramo — Produto usa custo por item/lote, Serviço usa uma DRE
 * mensal com cargos extraídos do edital (ver EtapaCustosServico). */
export function EtapaCustos({
  estudo,
  onUpdated,
}: {
  estudo: EstudoViabilidadeDetail;
  onUpdated: (estudo: EstudoViabilidadeDetail) => void;
}) {
  if (estudo.ramo === "PRODUTO") return <EtapaCustosProduto estudo={estudo} onUpdated={onUpdated} />;
  return <EtapaCustosServico estudo={estudo} onUpdated={onUpdated} />;
}
