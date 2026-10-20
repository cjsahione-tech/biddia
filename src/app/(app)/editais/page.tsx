import { EditaisMobileClient } from "@/components/dashboard/EditaisMobileClient";
import { ETAPAS_KANBAN } from "@/lib/kanban";
import type { EtapaKanban } from "@/lib/types";

// Aba "Editais" da barra inferior do celular: a lista completa, com busca e filtro por etapa.
export default async function EditaisPage({ searchParams }: { searchParams: Promise<{ etapa?: string }> }) {
  const { etapa } = await searchParams;
  const etapaInicial = ETAPAS_KANBAN.find((e) => e.key === etapa)?.key as EtapaKanban | undefined;
  return <EditaisMobileClient etapaInicial={etapaInicial} />;
}
