import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DemoIdentidade } from "@/app/identidade/DemoIdentidade";

// Página de conferência da identidade visual: existe só nas prévias e no computador de desenvolvimento.
// Em produção ela some (404), então pode ficar no projeto sem aparecer para o público.
export const metadata: Metadata = { title: "Identidade visual — Bidd.IA", robots: { index: false } };

export default function IdentidadePage() {
  if (process.env.VERCEL_ENV === "production") notFound();
  return <DemoIdentidade />;
}
