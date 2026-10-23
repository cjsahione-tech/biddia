// Paleta usada nos gráficos do Dashboard de Resultados.
// PALETA_CATEGORIAS: cores de CATEGORIA (as mesmas cores de etiqueta que o usuário escolhe nos cards do Kanban — ver
// CORES_CARD em src/lib/kanban.ts). É a única exceção de hex solto da identidade: dado do usuário, não cor do sistema.
// As demais cores (marca, ganho, perda, andamento) vêm das variáveis da identidade e mudam junto com o tema.
export const PALETA_CATEGORIAS = [
  "#3b82f6", // blue-500
  "#10b981", // emerald-500
  "#fbbf24", // amber-400
  "#f97316", // orange-500
  "#ef4444", // red-500
  "#a855f7", // purple-500
  "#ec4899", // pink-500
  "#94a3b8", // slate-400
];

export const COR_BRAND = "var(--brand-600)";
export const COR_ACCENT = "var(--success-ink)";
export const COR_GANHO = "var(--success-ink)";
export const COR_PERDA = "var(--danger-ink)";
export const COR_ANDAMENTO = "var(--warning-ink)";
