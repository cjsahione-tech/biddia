import { FileCheck2, FileWarning } from "lucide-react";

/** Sinaliza se um resultado de IA foi baseado no texto real do edital ou é uma estimativa. */
export function FonteBadge({ baseadoEmTextoCompleto }: { baseadoEmTextoCompleto: boolean }) {
  if (baseadoEmTextoCompleto) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent">
        <FileCheck2 className="h-3.5 w-3.5" />
        Baseado no texto do edital
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning">
      <FileWarning className="h-3.5 w-3.5" />
      Estimativa — texto do edital indisponível
    </span>
  );
}
