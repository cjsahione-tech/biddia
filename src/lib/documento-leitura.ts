import { itemPorChave, type CategoriaCatalogo } from "@/lib/catalogo-documentos";

// Reconhecimento de um documento recém-enviado SEM inteligência artificial (zero custo de token):
// procura palavras típicas no nome do arquivo e no texto das primeiras páginas do PDF. O resultado é só uma
// SUGESTÃO — quem confirma pasta, item e validade é o usuário, porque um documento no item errado
// seria creditado na habilitação de editais que ele não atende.

export function semAcento(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

type Regra = { chave: string; padroes: RegExp[] };

// Cada padrão acertado soma ponto. Padrões escritos já sem acento e em minúsculas.
const REGRAS: Regra[] = [
  { chave: "fiscal-federal", padroes: [/tributos federais/, /receita federal/, /\bpgfn\b/, /divida ativa da uniao/, /certidao conjunta/, /\bcnd\b.*federal|federal.*\bcnd\b/] },
  { chave: "fiscal-estadual-icms", padroes: [/\bicms\b/, /tributos estaduais/, /fazenda estadual/, /\bsefaz\b/, /certidao.*estadual|estadual.*certidao/] },
  { chave: "fiscal-municipal", padroes: [/tributos municipais/, /fazenda municipal/, /\biptu\b/, /tributos mobiliarios/, /certidao.*municipal|municipal.*certidao/] },
  { chave: "fiscal-issqn", padroes: [/\bissqn\b/, /imposto sobre servicos/] },
  { chave: "trabalhista-cndt", padroes: [/debitos trabalhistas/, /\bcndt\b/, /tribunal superior do trabalho/] },
  { chave: "trabalhista-crf-fgts", padroes: [/\bfgts\b/, /regularidade do fgts/, /\bcrf\b/] },
  { chave: "trabalhista-decl-menores", padroes: [/menores de 18/, /trabalho noturno, perigoso ou insalubre/, /inciso xxxiii/] },
  { chave: "trabalhista-decl-fato-impeditivo", padroes: [/fato impeditivo/] },
  { chave: "trabalhista-decl-cotas", padroes: [/aprendiz/, /pessoas com deficiencia/, /lei 8\.?213/] },
  { chave: "juridica-cartao-cnpj", padroes: [/comprovante de inscricao e de situacao cadastral/, /cartao cnpj/, /cartao do cnpj/] },
  { chave: "juridica-contrato-social", padroes: [/contrato social/, /alteracao contratual/, /\bestatuto\b/, /junta comercial/, /ato constitutivo/, /consolidacao do contrato/] },
  { chave: "juridica-procuracao", padroes: [/procuracao/, /outorgante/] },
  { chave: "juridica-docs-socios", padroes: [/carteira nacional de habilitacao/, /registro geral/, /\bcnh\b/, /\brg\b/] },
  { chave: "economica-balanco-dre", padroes: [/balanco patrimonial/, /demonstracao do resultado/, /\bdre\b/, /\bbalanco\b/] },
  { chave: "economica-indices", padroes: [/indices de liquidez/, /liquidez (geral|corrente)/, /solvencia/] },
  { chave: "economica-falencia", padroes: [/falencia/, /recuperacao judicial/, /concordata/] },
  { chave: "economica-garantia-proposta", padroes: [/garantia de proposta/, /seguro.garantia/, /fianca bancaria/] },
  { chave: "tecnica-licenca-sanitaria", padroes: [/licenca sanitaria/, /alvara sanitario/, /vigilancia sanitaria/, /autorizacao de funcionamento/, /\bafe\b/] },
  { chave: "tecnica-licencas-ambientais", padroes: [/licenca ambiental/, /licenciamento ambiental/, /\bibama\b/] },
  { chave: "tecnica-crq-conselho", padroes: [/registro e quitacao/, /\bcrq\b/] },
  { chave: "tecnica-registro-orgao-setorial", padroes: [/\banvisa\b/, /\binmetro\b/, /\bmapa\b/] },
  { chave: "tecnica-vistoria", padroes: [/vistoria tecnica/, /conhecimento das condicoes/] },
  { chave: "equipe-responsavel-tecnico", padroes: [/responsavel tecnico/, /\bart\b.*responsabilidade tecnica/] },
  { chave: "equipe-quitacao-profissional", padroes: [/quitacao.*profissional|profissional.*quitacao/] },
  { chave: "certificados-iso", padroes: [/\biso ?(9001|14001|27001|45001)\b/] },
  { chave: "certificados-nr", padroes: [/\bnr[- ]?(10|12|18|20|33|35)\b/] },
  { chave: "certificados-calibracao", padroes: [/calibracao/, /rastreabilidade/] },
  { chave: "certificados-boas-praticas", padroes: [/boas praticas de fabricacao/, /\bcbpf\b/] },
  { chave: "atestados-tecnico-profissional", padroes: [/certidao de acervo tecnico/, /\bcat\b.*(crea|confea)/] },
  { chave: "atestados-tecnico-operacional", padroes: [/atestado.*tecnico|tecnico.*atestado/, /capacidade tecnica/, /capacidade tecnico/] },
  { chave: "atestados-fornecimento", padroes: [/atestado de fornecimento/, /atestamos que/, /atestado\b/] },
];

export type SugestaoDocumento = {
  chave: string;
  /** "alta" = reconhecido pelo conteúdo do arquivo; "media" = só pelo nome do arquivo. */
  confianca: "alta" | "media";
  motivo: string;
};

/** Item mais provável do catálogo para o documento, ou null se nada bate. */
export function sugerirItemDoDocumento(nomeArquivo: string, texto: string | null): SugestaoDocumento | null {
  const nome = semAcento(nomeArquivo.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[_\-.]+/g, " "));
  const corpo = texto ? semAcento(texto) : "";

  let melhor: { chave: string; pontos: number; peloTexto: boolean } | null = null;
  for (const regra of REGRAS) {
    const noNome = regra.padroes.filter((p) => p.test(nome)).length;
    const noTexto = corpo ? regra.padroes.filter((p) => p.test(corpo)).length : 0;
    const pontos = noNome * 2 + noTexto * 3;
    if (pontos === 0) continue;
    // Em empate, a regra mais específica (declarada antes na lista) vence.
    if (!melhor || pontos > melhor.pontos) melhor = { chave: regra.chave, pontos, peloTexto: noTexto > 0 };
  }
  if (!melhor || !itemPorChave(melhor.chave)) return null;
  return melhor.peloTexto
    ? { chave: melhor.chave, confianca: "alta", motivo: "Reconhecido pelo conteúdo do arquivo." }
    : { chave: melhor.chave, confianca: "media", motivo: "Reconhecido só pelo nome do arquivo — confira." };
}

function dataValida(dia: number, mes: number, ano: number): string | null {
  if (ano < 2000 || ano > 2100 || mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCMonth() !== mes - 1) return null;
  return d.toISOString().slice(0, 10);
}

function datasDoTrecho(trecho: string): string[] {
  const datas: string[] = [];
  for (const m of trecho.matchAll(/(\d{2})\/(\d{2})\/(\d{4})/g)) {
    const iso = dataValida(Number(m[1]), Number(m[2]), Number(m[3]));
    if (iso) datas.push(iso);
  }
  return datas;
}

/**
 * Validade escrita no próprio documento ("Válida até 12/03/2027", "Validade: 01/10/2026 a 30/10/2026").
 * Com um período, vale a ÚLTIMA data. Devolve AAAA-MM-DD ou null. É só sugestão: o usuário confirma.
 */
export function extrairValidade(texto: string): string | null {
  const t = semAcento(texto).replace(/\s+/g, " ");
  const candidatas: string[] = [];
  for (const m of t.matchAll(/(?:validade|valida ate|valido ate|data de validade|vencimento|vence em)[^0-9]{0,40}((?:\d{2}\/\d{2}\/\d{4}[^0-9]{0,12}){1,2})/g)) {
    const datas = datasDoTrecho(m[1]);
    if (datas.length > 0) candidatas.push(datas[datas.length - 1]);
  }
  if (candidatas.length === 0) return null;
  // Se o documento cita mais de uma validade (raro), a mais próxima de vencer é a que limita o uso.
  return candidatas.sort()[0];
}

/** Data de emissão escrita no documento, ou null. */
export function extrairEmissao(texto: string): string | null {
  const t = semAcento(texto).replace(/\s+/g, " ");
  const m = t.match(/(?:emitid[ao] em|data de emissao|emissao|data de expedicao|expedid[ao] em)[^0-9]{0,30}(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? dataValida(Number(m[1]), Number(m[2]), Number(m[3])) : null;
}

export function soDigitos(v: string): string {
  return v.replace(/\D/g, "");
}

/** Confere os dígitos verificadores — evita tratar um número qualquer como se fosse CNPJ. */
export function cnpjValido(cnpj: string): boolean {
  const d = soDigitos(cnpj);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (base: string, pesos: number[]) => {
    const soma = base.split("").reduce((acc, n, i) => acc + Number(n) * pesos[i], 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const d1 = calc(d.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calc(d.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d1 === Number(d[12]) && d2 === Number(d[13]);
}

export function extrairCnpjs(texto: string): string[] {
  const achados = new Set<string>();
  for (const m of texto.matchAll(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g)) {
    if (cnpjValido(m[0])) achados.add(soDigitos(m[0]));
  }
  return [...achados];
}

// Documentos que a empresa recebe de TERCEIROS (cliente, conselho, fabricante) citam outros CNPJs
// à vontade; só os emitidos EM NOME DA EMPRESA devem trazer o CNPJ dela.
const PASTAS_EM_NOME_DA_EMPRESA = new Set<CategoriaCatalogo>(["juridica", "fiscal", "trabalhista", "economica"]);

export function formatarCnpj(d: string): string {
  return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

/**
 * Aviso quando o documento parece ser de OUTRA empresa: o CNPJ da empresa não aparece nele, mas há outro.
 * Só vale para documentos emitidos em nome da empresa e só quando o texto do arquivo pôde ser lido.
 */
export function avisoDeCnpj(cnpjsNoDocumento: string[], cnpjDaEmpresa: string, chaveDoItem: string | null | undefined): string | null {
  const item = itemPorChave(chaveDoItem);
  if (!item || !PASTAS_EM_NOME_DA_EMPRESA.has(item.categoria)) return null;
  const empresa = soDigitos(cnpjDaEmpresa);
  if (empresa.length !== 14 || cnpjsNoDocumento.length === 0) return null;
  if (cnpjsNoDocumento.includes(empresa)) return null;
  const mesmaRaiz = cnpjsNoDocumento.find((c) => c.slice(0, 8) === empresa.slice(0, 8));
  if (mesmaRaiz) {
    return `O CNPJ deste documento (${formatarCnpj(mesmaRaiz)}) é de outro estabelecimento da mesma empresa (o cadastro usa ${formatarCnpj(empresa)}). Confira se o edital aceita.`;
  }
  return `O CNPJ encontrado neste documento (${formatarCnpj(cnpjsNoDocumento[0])}) não é o da empresa (${formatarCnpj(empresa)}). Confira se é o arquivo certo antes de salvar.`;
}
