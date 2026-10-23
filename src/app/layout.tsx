import type { Metadata } from "next";
import { Rubik, DM_Sans } from "next/font/google";
import "./globals.css";

// Identidade visual Bidd.IA: Rubik nos títulos (500 e 600) e DM Sans no texto (400, 500 e 700), em qualquer tela.
const rubik = Rubik({ variable: "--font-rubik", subsets: ["latin"], weight: ["500", "600"], display: "swap" });
const dmSans = DM_Sans({ variable: "--font-dmsans", subsets: ["latin"], weight: ["400", "500", "700"], display: "swap" });

export const metadata: Metadata = {
  title: "Bidd.IA — Agentes de IA para Licitações",
  description:
    "Plataforma de agentes de IA que captam, analisam e preparam propostas para licitações públicas de forma autônoma.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={`${rubik.variable} ${dmSans.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-page text-ink">{children}</body>
    </html>
  );
}
