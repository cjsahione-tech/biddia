import { DashboardClient } from "@/components/dashboard/DashboardClient";
import { ETAPAS_KANBAN } from "@/lib/kanban";
import type { EtapaKanban } from "@/lib/types";

// Editais: lista com busca e filtro por etapa no celular; quadro de colunas (arrastar) no tablet e no computador.
export default async function EditaisPage({ searchParams }: { searchParams: Promise<{ etapa?: string }> }) {
  const { etapa } = await searchParams;
  const etapaInicial = ETAPAS_KANBAN.find((e) => e.key === etapa)?.key as EtapaKanban | undefined;
  return <DashboardClient modo="editais" etapaInicial={etapaInicial} />;
}
