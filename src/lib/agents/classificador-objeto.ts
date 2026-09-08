export type TipoObjeto = "SERVICO" | "BEM" | null;

const PISTAS_SERVICO = [
  "prestação de serviço",
  "prestação de serviços",
  "contratação de serviço",
  "contratação de serviços",
  "contratação de empresa especializada",
  "contratação de empresa para prestação",
  "serviços de",
  "serviço de",
  "execução de serviços",
  "execução dos serviços",
  "locação de mão de obra",
  "manutenção preventiva",
  "manutenção corretiva",
  "manutenção e assistência",
  "prestação dos serviços",
];

const PISTAS_BEM = [
  "aquisição de",
  "aquisição e fornecimento",
  "fornecimento de",
  "compra de",
  "aquisição, com entrega",
  "registro de preços para aquisição",
  "registro de preços para futura aquisição",
  "aquisição parcelada",
  "compra e fornecimento",
];

/**
 * Classificação heurística (por palavras-chave no objeto/título) entre contratação de
 * Serviço e de Bem/Insumo. É uma pista para o usuário priorizar, não uma classificação
 * jurídica precisa — editais que misturam bens e serviços podem ficar ambíguos.
 */
export function classificarTipoObjeto(titulo: string, descricao: string): TipoObjeto {
  const texto = `${titulo} ${descricao}`.toLowerCase();

  const temServico = PISTAS_SERVICO.some((termo) => texto.includes(termo));
  const temBem = PISTAS_BEM.some((termo) => texto.includes(termo));

  if (temServico && !temBem) return "SERVICO";
  if (temBem && !temServico) return "BEM";
  if (temServico && temBem) {
    // Quando ambos aparecem, o primeiro termo encontrado no texto costuma indicar o objeto principal.
    const posServico = Math.min(
      ...PISTAS_SERVICO.map((t) => (texto.includes(t) ? texto.indexOf(t) : Infinity))
    );
    const posBem = Math.min(...PISTAS_BEM.map((t) => (texto.includes(t) ? texto.indexOf(t) : Infinity)));
    return posServico <= posBem ? "SERVICO" : "BEM";
  }
  return null;
}

/** A empresa atende este tipo de objeto segundo o perfil declarado no cadastro? */
export function empresaAtende(
  tipoObjeto: TipoObjeto,
  perfil: { atendeServico: boolean; atendeBem: boolean }
): boolean {
  if (!tipoObjeto) return true; // não classificado: não bloqueia nem alerta
  if (tipoObjeto === "SERVICO") return perfil.atendeServico;
  return perfil.atendeBem;
}
