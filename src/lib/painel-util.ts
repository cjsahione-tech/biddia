// Pequenas regras de texto do visual de celular (cumprimento, prazos). Puras e sem dependências.

export function primeiroNome(nome: string | null | undefined): string {
  const n = (nome ?? "").trim().split(/\s+/)[0] ?? "";
  if (!n) return "";
  return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase();
}

/** "Bom dia" até 11h59, "Boa tarde" até 17h59, "Boa noite" depois — pela hora de Brasília. */
export function saudacao(agora: Date = new Date()): string {
  const hora = Number(new Date(agora.getTime() - 3 * 3_600_000).getUTCHours());
  if (hora < 12) return "Bom dia";
  if (hora < 18) return "Boa tarde";
  return "Boa noite";
}

export function iniciais(nome: string | null | undefined): string {
  return primeiroNome(nome).charAt(0).toUpperCase() || "?";
}

const inicioDoDiaBrasilia = (d: Date) => Math.floor((d.getTime() - 3 * 3_600_000) / 86_400_000);

/** Dias de calendário (em Brasília) até a data: 0 = hoje, 1 = amanhã, negativo = dia que já passou; null se não há data. */
export function diasAte(data: string | Date | null | undefined, agora: Date = new Date()): number | null {
  if (!data) return null;
  const alvo = new Date(data);
  if (Number.isNaN(alvo.getTime())) return null;
  return inicioDoDiaBrasilia(alvo) - inicioDoDiaBrasilia(agora);
}

export type TomPrazo = "urgente" | "normal" | "encerrado" | "semData";

/** Texto e tom do selo de prazo do cartão ("Encerra em 5 dias"). */
export function rotuloPrazo(data: string | Date | null | undefined, agora: Date = new Date()): { texto: string; tom: TomPrazo } {
  const d = diasAte(data, agora);
  if (d === null) return { texto: "Sem data", tom: "semData" };
  if (new Date(data!).getTime() < agora.getTime()) return { texto: "Encerrado", tom: "encerrado" };
  if (d === 0) return { texto: "Encerra hoje", tom: "urgente" };
  if (d === 1) return { texto: "Encerra amanhã", tom: "urgente" };
  return { texto: `Encerra em ${d} dias`, tom: d <= 3 ? "urgente" : "normal" };
}

/** Mesmo dia de calendário (em Brasília) — usado para "captados hoje". */
export function mesmoDiaBrasilia(a: string | Date, b: Date = new Date()): boolean {
  const k = (d: Date) => new Date(d.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
  return k(new Date(a)) === k(b);
}
