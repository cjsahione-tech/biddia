import type { Metadata } from "next";
import { DemoIdentidade } from "@/app/identidade/DemoIdentidade";

// Página de conferência da identidade visual (só para a prévia — sai antes de ir para produção).
export const metadata: Metadata = { title: "Identidade visual — Bidd.IA", robots: { index: false } };

export default function IdentidadePage() {
  return <DemoIdentidade />;
}
