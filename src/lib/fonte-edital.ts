// Rótulos derivados de Edital.fonte ("PNCP" | "LICITANET" | "COMPRASGOV" | "MANUAL") — usados
// tanto no filtro por portal do Kanban quanto no botão de link externo, pra nunca mostrar
// "Ver no PNCP" apontando pra um link que na verdade vai pro LicitaNet (ou vice-versa).
export function labelPortal(fonte: string): string {
  if (fonte === "PNCP") return "PNCP";
  if (fonte === "LICITANET") return "LicitaNet";
  if (fonte === "COMPRASGOV") return "Compras.gov.br";
  if (fonte === "MANUAL") return "Manual";
  return fonte;
}

export function labelVerNoPortal(fonte: string): string {
  return `Ver no ${labelPortal(fonte)}`;
}
