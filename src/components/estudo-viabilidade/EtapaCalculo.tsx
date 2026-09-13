"use client";

import { EtapaCalculoProduto } from "@/components/estudo-viabilidade/EtapaCalculoProduto";
import { EtapaCalculoServico } from "@/components/estudo-viabilidade/EtapaCalculoServico";
import type { EstudoViabilidadeDetail } from "@/lib/types";

/** Etapa 5: dispatcher por ramo — Produto calcula preço mínimo por item, Serviço monta
 * uma DRE mensal (ver EtapaCalculoServico). */
export function EtapaCalculo({
  estudo,
  onUpdated,
}: {
  estudo: EstudoViabilidadeDetail;
  onUpdated: (estudo: EstudoViabilidadeDetail) => void;
}) {
  if (estudo.ramo === "PRODUTO") return <EtapaCalculoProduto estudo={estudo} onUpdated={onUpdated} />;
  return <EtapaCalculoServico estudo={estudo} onUpdated={onUpdated} />;
}
