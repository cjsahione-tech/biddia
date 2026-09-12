import { prisma } from "@/lib/prisma";
import {
  SEED_FAIXAS_SIMPLES,
  SEED_PARAMETROS_REGIME,
  calcularAliquotaEfetivaSimples,
  type AliquotasResolvidas,
  type AnexoSimples,
  type RegimeTributario,
} from "@/lib/tributos";
import type { RamoEstudo } from "@/lib/estudo-viabilidade";

/** Garante que a empresa tenha as tabelas de parâmetros tributários populadas — semeia
 * os valores de partida (ver SEED_* em tributos.ts) só na primeira vez; nunca sobrescreve
 * linhas que já existem (o usuário pode já ter editado). */
export async function garantirParametrosTributarios(companyId: string) {
  const [temFaixas, temParametros] = await Promise.all([
    prisma.faixaSimplesNacional.count({ where: { companyId } }),
    prisma.parametroTributarioRegime.count({ where: { companyId } }),
  ]);

  if (temFaixas === 0) {
    await prisma.faixaSimplesNacional.createMany({
      data: SEED_FAIXAS_SIMPLES.map((f) => ({ ...f, companyId })),
    });
  }
  if (temParametros === 0) {
    await prisma.parametroTributarioRegime.createMany({
      data: SEED_PARAMETROS_REGIME.map((p) => ({ ...p, companyId })),
    });
  }
}

/**
 * Resolve a alíquota efetiva sobre a receita para o regime/ramo escolhidos, sempre lendo
 * da tabela de parâmetros da empresa (nunca de constante no código) — usada tanto pela
 * Etapa 3 (para mostrar/confirmar o resultado) quanto, depois, pela Etapa 5 (cálculo).
 */
export async function resolverAliquotas(params: {
  companyId: string;
  regime: RegimeTributario;
  ramo: RamoEstudo;
  anexoSimples?: AnexoSimples | null;
  rbt12?: number | null;
}): Promise<AliquotasResolvidas> {
  await garantirParametrosTributarios(params.companyId);

  if (params.regime === "SIMPLES_NACIONAL") {
    if (!params.anexoSimples) throw new Error("Selecione o Anexo do Simples Nacional");
    if (params.rbt12 == null || params.rbt12 < 0) {
      throw new Error("Informe o RBT12 (faturamento dos últimos 12 meses)");
    }

    const faixas = await prisma.faixaSimplesNacional.findMany({
      where: { companyId: params.companyId, anexo: params.anexoSimples },
      orderBy: { faixa: "asc" },
    });
    if (faixas.length === 0) throw new Error("Tabela do Simples Nacional não configurada para este Anexo");

    const faixaAplicavel =
      faixas.find((f) => params.rbt12! >= f.rbt12Min && params.rbt12! <= f.rbt12Max) ?? faixas[faixas.length - 1];

    const aliquotaTotalEfetiva = calcularAliquotaEfetivaSimples(faixaAplicavel, params.rbt12!);
    return {
      regime: params.regime,
      ramo: params.ramo,
      anexoSimples: params.anexoSimples,
      rbt12: params.rbt12!,
      aliquotaTotalEfetiva,
      detalhes: {
        faixa: faixaAplicavel.faixa,
        aliquotaNominal: faixaAplicavel.aliquotaNominal,
        parcelaDeduzir: faixaAplicavel.parcelaDeduzir,
      },
    };
  }

  const parametro = await prisma.parametroTributarioRegime.findUnique({
    where: { companyId_regime_ramo: { companyId: params.companyId, regime: params.regime, ramo: params.ramo } },
  });
  if (!parametro) throw new Error("Parâmetros tributários não configurados para este regime/ramo");

  const aliquotaTotalEfetiva = parametro.issOuIcms + parametro.pis + parametro.cofins + parametro.irpjCsll;
  return {
    regime: params.regime,
    ramo: params.ramo,
    aliquotaTotalEfetiva,
    detalhes: {
      issOuIcms: parametro.issOuIcms,
      pis: parametro.pis,
      cofins: parametro.cofins,
      irpjCsll: parametro.irpjCsll,
    },
  };
}
