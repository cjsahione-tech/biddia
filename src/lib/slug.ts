/** "Plano Médio — Hospitalar" -> "plano-medio-hospitalar": minúsculas, sem acento, só letras,
 * números e hífen. Usado para gerar sozinho o identificador (slug) de um plano. */
export function gerarSlug(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
