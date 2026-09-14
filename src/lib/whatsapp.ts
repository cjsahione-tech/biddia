// Normaliza um número de WhatsApp digitado em qualquer formato (com DDD, com ou sem "55",
// com máscara) para dígitos puros com código do país — formato exigido pela WhatsApp
// Cloud API (ex: "5511999999999").
export function normalizarWhatsapp(valor: string): string {
  const digitos = valor.replace(/\D/g, "");
  if (digitos.length === 0) return "";
  if (digitos.startsWith("55") && digitos.length >= 12) return digitos;
  return `55${digitos}`;
}
