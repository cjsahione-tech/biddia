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

export type EditalDetail = EditalListItem & {
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
