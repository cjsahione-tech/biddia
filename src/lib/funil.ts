import type { EditalListItem, EtapaKanban } from "@/lib/types";
import { ETAPAS_ESTEIRA, type EtapaEsteira } from "@/components/ui/Esteira";

// As 4 etapas da esteira da identidade (Oportunidade → Qualificação → Análise → Proposta) agrupam as colunas do quadro:
//  Oportunidade = Oportunidade · Qualificação = Qualificação · Análise = Editais em preparação ·
//  Proposta = Pronta para enviar + Enviada para disputa. As demais colunas (desfechos) não entram na esteira.
const ETAPAS_DE_CADA_PASSO: EtapaKanban[][] = [
  ["OPORTUNIDADE"],
  ["QUALIFICACAO"],
  ["SEM_PROPOSTAS"],
  ["PRONTA_PARA_ENVIAR", "ENVIADA_PARA_DISPUTA"],
];

export function etapasDaEsteira(editais: Pick<EditalListItem, "etapaKanban">[]): EtapaEsteira[] {
  return ETAPAS_ESTEIRA.map((e, i) => ({
    ...e,
    contagem: editais.filter((x) => ETAPAS_DE_CADA_PASSO[i].includes(x.etapaKanban)).length,
  }));
}
