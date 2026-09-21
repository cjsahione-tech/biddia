/**
 * O PNCP atualiza `data_atualizacao_pncp` toda vez que o órgão edita/retifica uma
 * contratação (novo anexo, mudança de data/valor etc.) — comparar essa data contra o que
 * já temos salvo é como detectamos uma retificação sem precisar comparar campo a campo
 * do zero a cada nova busca.
 */
export function houveRetificacao(
  dataAtualizacaoPncpSalva: Date | null,
  dataAtualizacaoPncpNova: Date | null
): boolean {
  if (!dataAtualizacaoPncpNova) return false;
  if (!dataAtualizacaoPncpSalva) return true;
  return dataAtualizacaoPncpNova.getTime() > dataAtualizacaoPncpSalva.getTime();
}
