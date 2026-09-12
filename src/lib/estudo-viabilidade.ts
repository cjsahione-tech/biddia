export type RamoEstudo = "SERVICO" | "PRODUTO";

export const RAMOS_ESTUDO: { key: RamoEstudo; label: string; descricao: string }[] = [
  {
    key: "SERVICO",
    label: "Serviço",
    descricao: "Prestação de serviços — equipe, salários, encargos e BDI.",
  },
  {
    key: "PRODUTO",
    label: "Produto",
    descricao: "Fornecimento de bens — custo de aquisição, frete e impostos sobre venda.",
  },
];

export const RAMO_LABEL: Record<RamoEstudo, string> = Object.fromEntries(
  RAMOS_ESTUDO.map((r) => [r.key, r.label])
) as Record<RamoEstudo, string>;

// Etapas do fluxo do estudo de viabilidade — usado pelo stepper visual em todas as
// telas do módulo. Mantido aqui (não em cada componente) porque a ordem/rótulo é
// compartilhado entre a listagem, o detalhe e futuras etapas.
export const ETAPAS_ESTUDO = [
  { key: "ramo", label: "Ramo" },
  { key: "edital", label: "Edital" },
  { key: "requisitos", label: "Requisitos" },
  { key: "tributos", label: "Tributos" },
  { key: "custos", label: "Custos" },
  { key: "calculo", label: "Cálculo" },
  { key: "relatorio", label: "Relatório" },
] as const;

export type EtapaEstudoKey = (typeof ETAPAS_ESTUDO)[number]["key"];
