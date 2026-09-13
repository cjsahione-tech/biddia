export type EnderecoCep = {
  logradouro: string;
  bairro: string;
  cidade: string;
  uf: string;
};

/**
 * Consulta a ViaCEP (serviço público, sem chave de API) e devolve o endereço para um CEP
 * de 8 dígitos. Nunca lança — CEP inválido, inexistente ou falha de rede resultam em
 * `null`, e o formulário simplesmente deixa o usuário preencher manualmente.
 */
export async function buscarEnderecoPorCep(cep: string): Promise<EnderecoCep | null> {
  const digitos = cep.replace(/\D/g, "");
  if (digitos.length !== 8) return null;

  try {
    const res = await fetch(`https://viacep.com.br/ws/${digitos}/json/`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.erro) return null;

    return {
      logradouro: data.logradouro ?? "",
      bairro: data.bairro ?? "",
      cidade: data.localidade ?? "",
      uf: data.uf ?? "",
    };
  } catch {
    return null;
  }
}
