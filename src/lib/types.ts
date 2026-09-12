export type EtapaKanban =
  | "OPORTUNIDADE"
  | "QUALIFICACAO"
  | "SEM_PROPOSTAS"
  | "PRONTA_PARA_ENVIAR"
  | "ENVIADA_PARA_DISPUTA"
  | "CLASSIFICACAO"
  | "ELIMINADA_APOS_CLASSIFICACAO"
  | "ACEITA"
  | "RECUSADA_DESCLASSIFICADA"
  | "EM_CONTRATO"
  | "FINALIZADA"
  | "RASCUNHO";

export type CorCard = "azul" | "verde" | "amarelo" | "laranja" | "vermelho" | "roxo" | "rosa" | "cinza";

export type EditalListItem = {
  id: string;
  fonte: string;
  titulo: string;
  descricao: string;
  tipoObjeto: "SERVICO" | "BEM" | "AMBOS" | null;
  orgaoNome: string;
  municipio: string | null;
  uf: string | null;
  modalidade: string | null;
  valorGlobal: number | null;
  orcamentoSigiloso: boolean;
  dataEncerramentoProposta: string | null;
  status: "NOVO" | "APROVADO" | "REPROVADO";
  etapaKanban: EtapaKanban;
  ordemKanban: number;
  corCard: CorCard | null;
  notasInternas: string | null;
  keywordMatched: string | null;
  linkPortal: string;
  analysis: { resumoObjeto: string } | null;
  proposal: { valorGlobalReferencia: number } | null;
  documents: { id: string; nome: string; categoria: "EDITAL" | "TERMO_REFERENCIA" | "ANEXO_PRECOS" | null }[];
  _count: { documents: number; checklistItems: number };
};

export type ChecklistItem = {
  id: string;
  documentoNome: string;
  obrigatorio: boolean;
  status: "FALTANTE" | "ENVIADO" | "VENCIDO" | "OK";
  validade: string | null;
  observacao: string | null;
  anexoDocId: string | null;
  anexoNome: string | null;
};

export type DocumentItem = {
  id: string;
  nome: string;
  tipo: "ANEXO_GERADO" | "DOCUMENTO_USUARIO" | "DOCUMENTO_PNCP";
  categoria: "EDITAL" | "TERMO_REFERENCIA" | "ANEXO_PRECOS" | null;
  status: "PENDENTE" | "GERADO" | "ENVIADO" | "VENCIDO" | "DISPONIVEL";
  validade: string | null;
  createdAt: string;
};

export type AuditLogItem = {
  id: string;
  agente: string;
  etapa: string;
  severidade: "OK" | "ALERTA" | "ERRO";
  mensagem: string;
  acaoTomada: string | null;
  createdAt: string;
};

export type AgentRunItem = {
  id: string;
  agentKey: string;
  status: "RUNNING" | "DONE" | "ERROR";
  message: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export type AgentMessageItem = {
  id: string;
  role: "user" | "agent";
  conteudo: string;
  anexoNome: string | null;
  anexoDocId: string | null;
  createdAt: string;
};

export type EstudoViabilidadeItem = {
  id: string;
  ramo: "SERVICO" | "PRODUTO";
  createdAt: string;
  updatedAt: string;
};

export type EstudoEditalRef = {
  id: string;
  titulo: string;
  orgaoNome: string;
  municipio: string | null;
  uf: string | null;
  modalidade: string | null;
  valorGlobal: number | null;
  orcamentoSigiloso: boolean;
  dataEncerramentoProposta: string | null;
  proposal: { itensJson: string; valorGlobalReferencia: number } | null;
};

export type RequisitosEstudo = {
  objeto: string;
  criterioJulgamento: string;
  prazoExecucao: string;
  localEntrega: string;
  formaPagamento: string;
  garantiasExigidas: string;
  equipeMinima: string[];
  certificacoesExigidas: string[];
  especificacaoTecnica: string;
  prazoEntrega: string;
  baseadoEmTextoCompleto: boolean;
};

export type EstudoViabilidadeDetail = EstudoViabilidadeItem & {
  editalId: string | null;
  edital: EstudoEditalRef | null;
  requisitosJson: string | null;
  requisitosConfirmadoEm: string | null;
  regimeTributario: "SIMPLES_NACIONAL" | "LUCRO_PRESUMIDO" | "LUCRO_REAL" | null;
  anexoSimples: "I" | "III" | "IV" | "V" | null;
  rbt12: number | null;
  aliquotasJson: string | null;
  tributosConfirmadoEm: string | null;
  custosConfirmadoEm: string | null;
  margemMinimaAceitavel: number | null;
  calculoConfirmadoEm: string | null;
};

export type EditalDetail = Omit<EditalListItem, "analysis" | "proposal" | "documents"> & {
  numeroControlePNCP: string;
  orgaoCnpj: string;
  dataPublicacao: string | null;
  dataAberturaProposta: string | null;
  analysis: {
    resumoObjeto: string;
    obrigacoesContratada: string;
    habilitacao: string;
    requisitosObrigatorios: string;
    requisitosAdicionais: string;
    riscos: string;
    parecer: string;
    baseadoEmTextoCompleto: boolean;
  } | null;
  proposal: {
    valorGlobalReferencia: number;
    itensJson: string;
    observacoes: string | null;
    descontoPercentual: number;
    baseadoEmTextoCompleto: boolean;
  } | null;
  documents: DocumentItem[];
  checklistItems: ChecklistItem[];
  auditLogs: AuditLogItem[];
  agentRuns: AgentRunItem[];
};
