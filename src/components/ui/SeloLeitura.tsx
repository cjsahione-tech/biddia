import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { Chip, type TomChip } from "@/components/ui/Chip";

// Selo de leitura do Auditor: quanto do edital foi lido.
//  completa   = leu tudo                       (sucesso)
//  parcial    = leu o principal, faltou parte   (atenção)
//  incompleta = não leu o bastante              (erro) — com leitura incompleta, NUNCA mostrar "Habilitada".
//
// ATENÇÃO: este componente é só VISUAL. Ele ainda NÃO está ligado às regras da auditoria nem ao banco; quem liga é o dono
// do projeto (decidir de onde vem o estado). Hoje ninguém o usa nas telas reais.
export type EstadoLeitura = "completa" | "parcial" | "incompleta";

export const ROTULO_LEITURA: Record<EstadoLeitura, string> = {
  completa: "Leitura completa",
  parcial: "Leitura parcial",
  incompleta: "Leitura incompleta",
};

const CONFIG: Record<EstadoLeitura, { tom: TomChip; icone: typeof CheckCircle2 }> = {
  completa: { tom: "sucesso", icone: CheckCircle2 },
  parcial: { tom: "atencao", icone: AlertTriangle },
  incompleta: { tom: "erro", icone: XCircle },
};

export function SeloLeitura({ estado, className }: { estado: EstadoLeitura; className?: string }) {
  const { tom, icone } = CONFIG[estado];
  return (
    <Chip tom={tom} icone={icone} className={className}>
      {ROTULO_LEITURA[estado]}
    </Chip>
  );
}
