// Quais informações do cadastro de uma empresa ainda estão em branco. O Analista pode criar
// um cliente só com razão social, CNPJ, e-mail e senha e completar o resto depois — este
// resumo mostra o que falta (na carteira e no topo da tela Empresa) sem bloquear nada.

export type DadosEmpresaParaPendencias = {
  objetoSocial?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
  cep?: string | null;
  banco?: string | null;
  agencia?: string | null;
  conta?: string | null;
  socioNome?: string | null;
  socioCpf?: string | null;
  logoUrl?: string | null;
  licitanetSegmentoId?: number | null;
  /** Quantidade de palavras-chave de busca cadastradas. */
  totalKeywords: number;
};

const vazio = (v: string | null | undefined) => !v || v.trim() === "";

export function camposPendentes(e: DadosEmpresaParaPendencias): string[] {
  const pend: string[] = [];
  if (e.totalKeywords === 0 && e.licitanetSegmentoId == null) {
    pend.push("Busca de editais (palavras-chave ou segmento do LicitaNet)");
  }
  if (vazio(e.objetoSocial)) pend.push("Objeto social");
  if ([e.logradouro, e.numero, e.bairro, e.cidade, e.uf, e.cep].some(vazio)) pend.push("Endereço");
  if ([e.banco, e.agencia, e.conta].some(vazio)) pend.push("Dados bancários");
  if ([e.socioNome, e.socioCpf].some(vazio)) pend.push("Responsável legal");
  if (vazio(e.logoUrl)) pend.push("Logo");
  return pend;
}
