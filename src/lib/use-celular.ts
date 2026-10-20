"use client";

import { useSyncExternalStore } from "react";

const CONSULTA = "(max-width: 767.98px)";

function assinar(aoMudar: () => void) {
  const mq = window.matchMedia(CONSULTA);
  mq.addEventListener("change", aoMudar);
  return () => mq.removeEventListener("change", aoMudar);
}

/** true quando a tela é de celular (até 768px). No servidor e na primeira pintura vale false (visual do computador). */
export function useCelular(): boolean {
  return useSyncExternalStore(
    assinar,
    () => window.matchMedia(CONSULTA).matches,
    () => false
  );
}
