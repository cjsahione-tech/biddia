import {
  Search,
  ClipboardCheck,
  Calculator,
  Scale,
  ListChecks,
  ShieldCheck,
  Wrench,
  Package,
  LayoutDashboard,
  Trophy,
  MessageSquare,
  FolderOpen,
  type LucideIcon,
} from "lucide-react";

// Textos e listas da página inicial pública (src/app/page.tsx). Os títulos e subtítulos de cada seção podem ser
// trocados pelo admin em /admin/site; o que está aqui é o conteúdo fixo da página.

// Contato do Grupo Bidd (o mesmo do site institucional).
export const WHATSAPP_CONSULTOR = `https://wa.me/5521972063718?text=${encodeURIComponent("Olá! Vim pelo site do Bidd.IA e quero falar com um consultor.")}`;
export const CONTATOS = [
  { rotulo: "WhatsApp (21) 97206-3718", href: "https://wa.me/5521972063718" },
  { rotulo: "WhatsApp (24) 99959-5057", href: "https://wa.me/5524999595057" },
];

export const AGENTES: { icon: LucideIcon; nome: string; resumo: string; descricao: string; imagens: [string, string] }[] = [
  {
    icon: Search,
    nome: "Agente Comercial",
    resumo: "Busca editais no PNCP",
    descricao:
      "Varre continuamente o PNCP, o Portal Nacional de Contratações Públicas, com base nas suas palavras-chave e traz até você os editais que combinam com a sua empresa.",
    imagens: ["/agentes/comercial-1.png", "/agentes/comercial-2.png"],
  },
  {
    icon: ClipboardCheck,
    nome: "Agente Analista",
    resumo: "Lê e resume o edital",
    descricao:
      "Lê cada edital aprovado e separa prazos, obrigações da contratada e da contratante, requisitos e pontos de atenção, em linguagem clara.",
    imagens: ["/agentes/analista-1.png", "/agentes/analista-2.png"],
  },
  {
    icon: Calculator,
    nome: "Agente Financeiro",
    resumo: "Monta a proposta",
    descricao:
      "Monta a composição de itens, quantidades e valores da proposta com base no edital. Não inventa preço: o que o edital não publica fica em aberto para você preencher.",
    imagens: ["/agentes/financeiro-1.png", "/agentes/financeiro-2.png"],
  },
  {
    icon: Scale,
    nome: "Agente Advogado",
    resumo: "Emite os anexos",
    descricao: "Preenche e emite cada anexo exigido pelo edital, já timbrado com os dados da sua empresa.",
    imagens: ["/agentes/advogado-1.png", "/agentes/advogado-2.png"],
  },
  {
    icon: ListChecks,
    nome: "Agente Secretário",
    resumo: "Organiza a documentação",
    descricao:
      "Organiza os documentos da sua empresa em pastas por edital e mantém o checklist em dia, avisando sobre validades e pendências.",
    imagens: ["/agentes/secretario-1.png", "/agentes/secretario-2.png"],
  },
  {
    icon: ShieldCheck,
    nome: "Agente Auditor",
    resumo: "Confere tudo no final",
    descricao:
      "Audita cada etapa do time, corrige o que dá para corrigir e indica se a empresa está habilitada, com o percentual da documentação atendido.",
    imagens: ["/agentes/auditor-1.png", "/agentes/auditor-2.png"],
  },
];

export const PASSOS: { titulo: string; texto: string }[] = [
  { titulo: "Captação", texto: "O Agente Comercial varre o PNCP com as suas palavras-chave e traz os editais para o seu quadro." },
  { titulo: "Leitura", texto: "O Analista lê o edital e separa prazos, obrigações, requisitos e pontos de atenção." },
  { titulo: "Proposta e anexos", texto: "O Financeiro monta a proposta e o Advogado emite os anexos com os dados da sua empresa." },
  { titulo: "Habilitação", texto: "O Secretário organiza a documentação e o Auditor confere se a empresa está habilitada." },
  { titulo: "Resultado", texto: "Ganhou? Registre o valor homologado e a planilha final e acompanhe tudo em Resultados." },
];

export const ESTUDOS_VIABILIDADE: { icon: LucideIcon; eyebrow: string; nome: string; descricao: string; imagens: [string, string] }[] = [
  {
    icon: Wrench,
    eyebrow: "Ramo Serviço",
    nome: "DRE mensal completa, com equipe sugerida pela IA",
    descricao:
      "A IA lê o edital e sugere os cargos e a quantidade de profissionais exigidos — você ajusta salários e custos operacionais, e o sistema monta a DRE: receita, folha de pagamento, impostos abertos por tributo (ISS, PIS, COFINS, IRPJ/CSLL ou Simples Nacional) e o lucro projetado para todo o contrato.",
    imagens: ["/estudo-viabilidade/servico-1.png", "/estudo-viabilidade/servico-2.png"],
  },
  {
    icon: Package,
    eyebrow: "Ramo Produto",
    nome: "Preço mínimo viável, item por item",
    descricao:
      "Para cada item do edital, o sistema calcula o preço mínimo que cobre custo de aquisição, frete, tributos do seu regime e a margem que você exige — comparando automaticamente com o valor de referência para apontar quais itens ou lotes realmente valem a pena disputar.",
    imagens: ["/estudo-viabilidade/produto-1.png", "/estudo-viabilidade/produto-2.png"],
  },
];

export const RECURSOS: { icon: LucideIcon; nome: string; descricao: string }[] = [
  {
    icon: LayoutDashboard,
    nome: "Quadro de editais",
    descricao: "Acompanhe cada licitação de Oportunidade até Ganhas, arrastando os cards entre as colunas.",
  },
  {
    icon: Trophy,
    nome: "Resultados",
    descricao: "Editais ganhos com valor homologado, percentual abaixo do edital e os itens da proposta final.",
  },
  {
    icon: MessageSquare,
    nome: "Assistente Bidd.IA",
    descricao: "Pergunte sobre editais, prazos e resultados e peça planilhas, PDFs e pacotes de documentos prontos.",
  },
  {
    icon: FolderOpen,
    nome: "Documentos da empresa",
    descricao: "Um dossiê único, com a validade de cada certidão, reaproveitado em todos os editais.",
  },
];

export const FRENTES: {
  chave: string;
  nome: string;
  etiqueta?: string;
  descricao: string;
  itens: string[];
  destaque?: boolean;
}[] = [
  {
    chave: "consultoria",
    nome: "Consultoria em Licitações",
    descricao: "Do edital ao contrato, acompanhamos a sua empresa em todas as etapas das compras públicas, com base na Lei nº 14.133/2021.",
    itens: ["Prospecção e análise de editais", "Habilitação e documentação", "Formação de preços e propostas", "Disputa, recursos e gestão de contratos"],
  },
  {
    chave: "biddia",
    nome: "Tecnologia · Bidd.IA",
    etiqueta: "Você está aqui",
    descricao: "Plataforma com agentes de inteligência artificial que leem editais, conferem documentos, montam planilhas e acompanham prazos.",
    itens: ["Agentes de IA especializados", "Análise automática de editais", "Funil de licitações", "A IA executa, a sua equipe decide"],
    destaque: true,
  },
  {
    chave: "biddmed",
    nome: "Planejamento Financeiro · BiddMed",
    etiqueta: "Em desenvolvimento",
    descricao: "Planejamento financeiro com apoio de IA para organizar receitas e despesas, projetar cenários e decidir com base em dados.",
    itens: ["Organização financeira", "Projeções e cenários", "Indicadores para decidir melhor"],
  },
];
