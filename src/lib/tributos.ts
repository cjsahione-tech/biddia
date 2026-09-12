import type { RamoEstudo } from "@/lib/estudo-viabilidade";

export type RegimeTributario = "SIMPLES_NACIONAL" | "LUCRO_PRESUMIDO" | "LUCRO_REAL";
export type AnexoSimples = "I" | "III" | "IV" | "V";

export const REGIMES_TRIBUTARIOS: { key: RegimeTributario; label: string }[] = [
  { key: "SIMPLES_NACIONAL", label: "Simples Nacional" },
  { key: "LUCRO_PRESUMIDO", label: "Lucro Presumido" },
  { key: "LUCRO_REAL", label: "Lucro Real" },
];

export const REGIME_LABEL: Record<RegimeTributario, string> = Object.fromEntries(
  REGIMES_TRIBUTARIOS.map((r) => [r.key, r.label])
) as Record<RegimeTributario, string>;

export const ANEXOS_SIMPLES: { key: AnexoSimples; label: string }[] = [
  { key: "I", label: "Anexo I — Comércio" },
  { key: "III", label: "Anexo III — Serviços (regra geral)" },
  { key: "IV", label: "Anexo IV — Serviços (sem CPP)" },
  { key: "V", label: "Anexo V — Serviços intelectuais (fator R)" },
];

export const ANEXO_LABEL: Record<AnexoSimples, string> = Object.fromEntries(
  ANEXOS_SIMPLES.map((a) => [a.key, a.label])
) as Record<AnexoSimples, string>;

/**
 * Valores de PARTIDA usados só para popular a tabela de parâmetros tributários de uma
 * empresa na primeira vez que ela abre a tela (bootstrap) — depois disso, tudo vira
 * linha editável no banco (FaixaSimplesNacional / ParametroTributarioRegime), e nenhum
 * cálculo neste app lê estes valores diretamente. Baseados na LC 123/2006 (Simples
 * Nacional) e em presunções de lucro típicas (Presumido); ISS/ICMS/IRPJ-CSLL do Lucro
 * Real variam por município/estado/margem real — confira com o contador da empresa e
 * mantenha atualizado na tela de parâmetros sempre que a legislação mudar.
 */
export const SEED_FAIXAS_SIMPLES: {
  anexo: AnexoSimples;
  faixa: number;
  rbt12Min: number;
  rbt12Max: number;
  aliquotaNominal: number;
  parcelaDeduzir: number;
}[] = [
  { anexo: "I", faixa: 1, rbt12Min: 0, rbt12Max: 180_000, aliquotaNominal: 4.0, parcelaDeduzir: 0 },
  { anexo: "I", faixa: 2, rbt12Min: 180_000.01, rbt12Max: 360_000, aliquotaNominal: 7.3, parcelaDeduzir: 5_940 },
  { anexo: "I", faixa: 3, rbt12Min: 360_000.01, rbt12Max: 720_000, aliquotaNominal: 9.5, parcelaDeduzir: 13_860 },
  { anexo: "I", faixa: 4, rbt12Min: 720_000.01, rbt12Max: 1_800_000, aliquotaNominal: 10.7, parcelaDeduzir: 22_500 },
  { anexo: "I", faixa: 5, rbt12Min: 1_800_000.01, rbt12Max: 3_600_000, aliquotaNominal: 14.3, parcelaDeduzir: 87_300 },
  { anexo: "I", faixa: 6, rbt12Min: 3_600_000.01, rbt12Max: 4_800_000, aliquotaNominal: 19.0, parcelaDeduzir: 378_000 },

  { anexo: "III", faixa: 1, rbt12Min: 0, rbt12Max: 180_000, aliquotaNominal: 6.0, parcelaDeduzir: 0 },
  { anexo: "III", faixa: 2, rbt12Min: 180_000.01, rbt12Max: 360_000, aliquotaNominal: 11.2, parcelaDeduzir: 9_360 },
  { anexo: "III", faixa: 3, rbt12Min: 360_000.01, rbt12Max: 720_000, aliquotaNominal: 13.5, parcelaDeduzir: 17_640 },
  { anexo: "III", faixa: 4, rbt12Min: 720_000.01, rbt12Max: 1_800_000, aliquotaNominal: 16.0, parcelaDeduzir: 35_640 },
  { anexo: "III", faixa: 5, rbt12Min: 1_800_000.01, rbt12Max: 3_600_000, aliquotaNominal: 21.0, parcelaDeduzir: 125_640 },
  { anexo: "III", faixa: 6, rbt12Min: 3_600_000.01, rbt12Max: 4_800_000, aliquotaNominal: 33.0, parcelaDeduzir: 648_000 },

  { anexo: "IV", faixa: 1, rbt12Min: 0, rbt12Max: 180_000, aliquotaNominal: 4.5, parcelaDeduzir: 0 },
  { anexo: "IV", faixa: 2, rbt12Min: 180_000.01, rbt12Max: 360_000, aliquotaNominal: 9.0, parcelaDeduzir: 8_100 },
  { anexo: "IV", faixa: 3, rbt12Min: 360_000.01, rbt12Max: 720_000, aliquotaNominal: 10.2, parcelaDeduzir: 12_420 },
  { anexo: "IV", faixa: 4, rbt12Min: 720_000.01, rbt12Max: 1_800_000, aliquotaNominal: 14.0, parcelaDeduzir: 39_780 },
  { anexo: "IV", faixa: 5, rbt12Min: 1_800_000.01, rbt12Max: 3_600_000, aliquotaNominal: 22.0, parcelaDeduzir: 183_780 },
  { anexo: "IV", faixa: 6, rbt12Min: 3_600_000.01, rbt12Max: 4_800_000, aliquotaNominal: 33.0, parcelaDeduzir: 828_000 },

  { anexo: "V", faixa: 1, rbt12Min: 0, rbt12Max: 180_000, aliquotaNominal: 15.5, parcelaDeduzir: 0 },
  { anexo: "V", faixa: 2, rbt12Min: 180_000.01, rbt12Max: 360_000, aliquotaNominal: 18.0, parcelaDeduzir: 4_500 },
  { anexo: "V", faixa: 3, rbt12Min: 360_000.01, rbt12Max: 720_000, aliquotaNominal: 19.5, parcelaDeduzir: 9_900 },
  { anexo: "V", faixa: 4, rbt12Min: 720_000.01, rbt12Max: 1_800_000, aliquotaNominal: 20.5, parcelaDeduzir: 17_100 },
  { anexo: "V", faixa: 5, rbt12Min: 1_800_000.01, rbt12Max: 3_600_000, aliquotaNominal: 23.0, parcelaDeduzir: 62_100 },
  { anexo: "V", faixa: 6, rbt12Min: 3_600_000.01, rbt12Max: 4_800_000, aliquotaNominal: 30.5, parcelaDeduzir: 540_000 },
];

export const SEED_PARAMETROS_REGIME: {
  regime: "LUCRO_PRESUMIDO" | "LUCRO_REAL";
  ramo: RamoEstudo;
  issOuIcms: number;
  pis: number;
  cofins: number;
  irpjCsll: number;
}[] = [
  { regime: "LUCRO_PRESUMIDO", ramo: "SERVICO", issOuIcms: 5.0, pis: 0.65, cofins: 3.0, irpjCsll: 7.68 },
  { regime: "LUCRO_PRESUMIDO", ramo: "PRODUTO", issOuIcms: 18.0, pis: 0.65, cofins: 3.0, irpjCsll: 2.28 },
  { regime: "LUCRO_REAL", ramo: "SERVICO", issOuIcms: 5.0, pis: 1.65, cofins: 7.6, irpjCsll: 0 },
  { regime: "LUCRO_REAL", ramo: "PRODUTO", issOuIcms: 18.0, pis: 1.65, cofins: 7.6, irpjCsll: 0 },
];

/**
 * Fórmula "por dentro" do Simples Nacional (LC 123/2006, art. 18, §1º-A):
 * alíquota efetiva = (RBT12 × alíquota nominal − parcela a deduzir) / RBT12.
 */
export function calcularAliquotaEfetivaSimples(
  faixa: { aliquotaNominal: number; parcelaDeduzir: number },
  rbt12: number
): number {
  if (rbt12 <= 0) return 0;
  const efetiva = (rbt12 * (faixa.aliquotaNominal / 100) - faixa.parcelaDeduzir) / rbt12;
  return Math.max(0, efetiva * 100);
}

export type AliquotasResolvidas = {
  regime: RegimeTributario;
  ramo: RamoEstudo;
  anexoSimples?: AnexoSimples;
  rbt12?: number;
  aliquotaTotalEfetiva: number;
  detalhes: Record<string, number>;
};
