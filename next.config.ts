import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // As fontes Unicode (Noto Sans) dos PDFs são lidas do disco em runtime (ver
  // src/lib/agents/pdf-fontes.ts) — o rastreamento automático de arquivos da Vercel não
  // enxerga leituras montadas com path.join, então inclui a pasta explicitamente em
  // qualquer rota de API que possa gerar PDF.
  outputFileTracingIncludes: {
    "/api/**/*": ["./src/lib/agents/fonts/**/*"],
  },
};

export default nextConfig;
