import type { Metadata } from "next";
import { Geist, Geist_Mono, Rubik, DM_Sans } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Fontes do visual de celular (telas até 768px): Rubik nos títulos e DM Sans no texto. Só são usadas dentro do
// @media do globals.css — no computador o texto continua em Geist e o navegador nem baixa estas duas.
const rubik = Rubik({ variable: "--font-rubik", subsets: ["latin"], weight: ["500", "600"] });
const dmSans = DM_Sans({ variable: "--font-dmsans", subsets: ["latin"], weight: ["400", "500", "700"] });

export const metadata: Metadata = {
  title: "Bidd.IA — Agentes de IA para Licitações",
  description:
    "Plataforma de agentes de IA que captam, analisam e preparam propostas para licitações públicas de forma autônoma.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} ${rubik.variable} ${dmSans.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">{children}</body>
    </html>
  );
}
