import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { Company } from "@prisma/client";

const MARGIN = 56;
const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;

function wrapText(text: string, font: import("pdf-lib").PDFFont, size: number, maxWidth: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const attempt = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(attempt, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = attempt;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Desenha uma tabela (cabeçalho + linhas, colunas de largura fixa) a partir da posição
 * atual do cursor, paginando quando necessário — extraído do que antes só existia
 * dentro de gerarPdfRelatorio, agora reaproveitado também por gerarPdfTimbrado (anexo
 * de proposta comercial, que precisa de tabela E bloco de assinatura no mesmo PDF).
 * Muta `ctx` (pode trocar de página) e devolve o cursorY final.
 */
function desenharTabela(
  ctx: { pdfDoc: PDFDocument; page: import("pdf-lib").PDFPage; cursorY: number },
  font: import("pdf-lib").PDFFont,
  fontBold: import("pdf-lib").PDFFont,
  colunas: { label: string; largura: number }[],
  linhas: string[][]
): void {
  const novaPaginaSeNecessario = (alturaNecessaria: number) => {
    if (ctx.cursorY < MARGIN + alturaNecessaria) {
      ctx.page = ctx.pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      ctx.cursorY = PAGE_HEIGHT - MARGIN;
    }
  };

  novaPaginaSeNecessario(30);
  let x = MARGIN;
  for (const coluna of colunas) {
    ctx.page.drawText(coluna.label, { x, y: ctx.cursorY, size: 8.5, font: fontBold, color: rgb(0.3, 0.3, 0.3) });
    x += coluna.largura;
  }
  ctx.cursorY -= 12;
  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.cursorY + 4 },
    end: { x: PAGE_WIDTH - MARGIN, y: ctx.cursorY + 4 },
    thickness: 0.5,
    color: rgb(0.85, 0.85, 0.85),
  });
  ctx.cursorY -= 4;

  for (const linha of linhas) {
    novaPaginaSeNecessario(18);
    let xCel = MARGIN;
    linha.forEach((valor, i) => {
      const largura = colunas[i]?.largura ?? 60;
      const textoTruncado = truncarParaLargura(valor, font, 8, largura - 4);
      ctx.page.drawText(textoTruncado, { x: xCel, y: ctx.cursorY, size: 8, font, color: rgb(0.15, 0.15, 0.15) });
      xCel += largura;
    });
    ctx.cursorY -= 13;
  }
}

/**
 * Gera um PDF timbrado com logo/cabeçalho da empresa, título e parágrafos de corpo.
 * `tabela` é opcional (usado pelo anexo de proposta comercial — ver
 * proposta-comercial.ts) e é desenhada entre os parágrafos e o bloco de assinatura.
 * Retorna os bytes do PDF já prontos para persistir em base64.
 */
export async function gerarPdfTimbrado(opts: {
  company: Company;
  titulo: string;
  paragrafos: string[];
  tabela?: { colunas: { label: string; largura: number }[]; linhas: string[][] };
  rodapeExtra?: string;
}): Promise<Uint8Array> {
  const { company, titulo, paragrafos, tabela, rodapeExtra } = opts;

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let cursorY = PAGE_HEIGHT - MARGIN;

  let logoDims: { width: number; height: number } | null = null;
  let logoImage: import("pdf-lib").PDFImage | null = null;
  if (company.logoUrl && company.logoUrl.startsWith("data:image")) {
    try {
      const base64 = company.logoUrl.split(",")[1];
      const bytes = Uint8Array.from(Buffer.from(base64, "base64"));
      logoImage = company.logoUrl.includes("png")
        ? await pdfDoc.embedPng(bytes)
        : await pdfDoc.embedJpg(bytes);
      const scale = 40 / logoImage.height;
      logoDims = { width: logoImage.width * scale, height: 40 };
    } catch {
      logoImage = null;
    }
  }

  const headerTextX = logoImage ? MARGIN + (logoDims?.width ?? 0) + 12 : MARGIN;

  if (logoImage && logoDims) {
    page.drawImage(logoImage, {
      x: MARGIN,
      y: cursorY - logoDims.height,
      width: logoDims.width,
      height: logoDims.height,
    });
  }

  page.drawText(company.razaoSocial, {
    x: headerTextX,
    y: cursorY - 14,
    size: 12,
    font: fontBold,
    color: rgb(0.1, 0.1, 0.1),
  });
  page.drawText(`CNPJ: ${company.cnpj}`, {
    x: headerTextX,
    y: cursorY - 28,
    size: 9,
    font,
    color: rgb(0.35, 0.35, 0.35),
  });
  page.drawText(
    `${company.logradouro}, ${company.numero} - ${company.bairro}, ${company.cidade}/${company.uf}`,
    { x: headerTextX, y: cursorY - 40, size: 9, font, color: rgb(0.35, 0.35, 0.35) }
  );

  cursorY -= 64;
  page.drawLine({
    start: { x: MARGIN, y: cursorY },
    end: { x: PAGE_WIDTH - MARGIN, y: cursorY },
    thickness: 1,
    color: rgb(0.85, 0.85, 0.85),
  });
  cursorY -= 32;

  page.drawText(titulo, {
    x: MARGIN,
    y: cursorY,
    size: 14,
    font: fontBold,
    color: rgb(0, 0, 0),
  });
  cursorY -= 28;

  const bodySize = 10.5;
  const lineHeight = 16;
  const maxWidth = PAGE_WIDTH - MARGIN * 2;

  for (const paragrafo of paragrafos) {
    const lines = wrapText(paragrafo, font, bodySize, maxWidth);
    for (const line of lines) {
      if (cursorY < MARGIN + 60) {
        page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        cursorY = PAGE_HEIGHT - MARGIN;
      }
      page.drawText(line, { x: MARGIN, y: cursorY, size: bodySize, font, color: rgb(0.15, 0.15, 0.15) });
      cursorY -= lineHeight;
    }
    cursorY -= 10;
  }

  if (tabela && tabela.linhas.length > 0) {
    cursorY -= 12;
    const ctx = { pdfDoc, page, cursorY };
    desenharTabela(ctx, font, fontBold, tabela.colunas, tabela.linhas);
    page = ctx.page;
    cursorY = ctx.cursorY;
  }

  cursorY -= 30;
  if (cursorY < MARGIN + 80) {
    page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    cursorY = PAGE_HEIGHT - MARGIN;
  }
  page.drawLine({
    start: { x: MARGIN, y: cursorY },
    end: { x: MARGIN + 220, y: cursorY },
    thickness: 0.8,
    color: rgb(0.6, 0.6, 0.6),
  });
  cursorY -= 14;
  page.drawText(company.socioNome, { x: MARGIN, y: cursorY, size: 10, font: fontBold });
  cursorY -= 13;
  page.drawText(`CPF: ${company.socioCpf} — Sócio(a) e Responsável Legal`, {
    x: MARGIN,
    y: cursorY,
    size: 9,
    font,
    color: rgb(0.35, 0.35, 0.35),
  });

  if (rodapeExtra) {
    cursorY -= 24;
    const lines = wrapText(rodapeExtra, font, 8, maxWidth);
    for (const line of lines) {
      page.drawText(line, { x: MARGIN, y: cursorY, size: 8, font, color: rgb(0.55, 0.55, 0.55) });
      cursorY -= 11;
    }
  }

  return pdfDoc.save();
}

export function bytesToDataUrl(bytes: Uint8Array) {
  return `data:application/pdf;base64,${Buffer.from(bytes).toString("base64")}`;
}

export type SecaoRelatorio =
  | { tipo: "campos"; titulo: string; campos: { label: string; valor: string }[] }
  | { tipo: "texto"; titulo: string; texto: string }
  | { tipo: "tabela"; titulo: string; colunas: { label: string; largura: number }[]; linhas: string[][] }
  // Gráfico de barras horizontais desenhado com retângulos do próprio pdf-lib (sem
  // depender de rasterizar imagem nenhuma) — usado pelo Dashboard de Resultados para dar
  // uma leitura visual rápida de distribuições (funil de etapas, por portal, por UF...).
  | { tipo: "barras"; titulo: string; itens: { label: string; valor: number; valorLabel: string }[] };

function truncarParaLargura(texto: string, font: import("pdf-lib").PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(texto, size) <= maxWidth) return texto;
  let resultado = texto;
  while (resultado.length > 1 && font.widthOfTextAtSize(`${resultado}…`, size) > maxWidth) {
    resultado = resultado.slice(0, -1);
  }
  return `${resultado}…`;
}

/**
 * Gera um PDF de relatório (seções de campos/texto/tabela) com o mesmo cabeçalho
 * timbrado de gerarPdfTimbrado, mas sem bloco de assinatura — é um resumo pra consulta,
 * não uma declaração assinada. Usado pelo relatório final do Estudo de Viabilidade.
 */
export async function gerarPdfRelatorio(opts: {
  company: Company;
  titulo: string;
  subtitulo?: string;
  secoes: SecaoRelatorio[];
}): Promise<Uint8Array> {
  const { company, titulo, subtitulo, secoes } = opts;

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let cursorY = PAGE_HEIGHT - MARGIN;

  function novaPaginaSeNecessario(alturaNecessaria: number) {
    if (cursorY < MARGIN + alturaNecessaria) {
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      cursorY = PAGE_HEIGHT - MARGIN;
    }
  }

  let logoDims: { width: number; height: number } | null = null;
  let logoImage: import("pdf-lib").PDFImage | null = null;
  if (company.logoUrl && company.logoUrl.startsWith("data:image")) {
    try {
      const base64 = company.logoUrl.split(",")[1];
      const bytes = Uint8Array.from(Buffer.from(base64, "base64"));
      logoImage = company.logoUrl.includes("png") ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
      const scale = 40 / logoImage.height;
      logoDims = { width: logoImage.width * scale, height: 40 };
    } catch {
      logoImage = null;
    }
  }
  const headerTextX = logoImage ? MARGIN + (logoDims?.width ?? 0) + 12 : MARGIN;
  if (logoImage && logoDims) {
    page.drawImage(logoImage, {
      x: MARGIN,
      y: cursorY - logoDims.height,
      width: logoDims.width,
      height: logoDims.height,
    });
  }
  page.drawText(company.razaoSocial, { x: headerTextX, y: cursorY - 14, size: 12, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
  page.drawText(`CNPJ: ${company.cnpj}`, { x: headerTextX, y: cursorY - 28, size: 9, font, color: rgb(0.35, 0.35, 0.35) });

  cursorY -= 64;
  page.drawLine({
    start: { x: MARGIN, y: cursorY },
    end: { x: PAGE_WIDTH - MARGIN, y: cursorY },
    thickness: 1,
    color: rgb(0.85, 0.85, 0.85),
  });
  cursorY -= 30;

  page.drawText(titulo, { x: MARGIN, y: cursorY, size: 15, font: fontBold, color: rgb(0, 0, 0) });
  cursorY -= 20;
  if (subtitulo) {
    page.drawText(subtitulo, { x: MARGIN, y: cursorY, size: 10, font, color: rgb(0.4, 0.4, 0.4) });
    cursorY -= 24;
  } else {
    cursorY -= 6;
  }

  const maxWidth = PAGE_WIDTH - MARGIN * 2;

  for (const secao of secoes) {
    novaPaginaSeNecessario(50);
    cursorY -= 8;
    page.drawText(secao.titulo, { x: MARGIN, y: cursorY, size: 12, font: fontBold, color: rgb(0.15, 0.15, 0.5) });
    cursorY -= 18;

    if (secao.tipo === "campos") {
      for (const campo of secao.campos) {
        novaPaginaSeNecessario(30);
        const labelText = `${campo.label}: `;
        page.drawText(labelText, { x: MARGIN, y: cursorY, size: 9.5, font: fontBold, color: rgb(0.3, 0.3, 0.3) });
        const labelWidth = fontBold.widthOfTextAtSize(labelText, 9.5);
        const linhas = wrapText(campo.valor || "—", font, 9.5, maxWidth - labelWidth);
        page.drawText(linhas[0] ?? "—", { x: MARGIN + labelWidth, y: cursorY, size: 9.5, font, color: rgb(0.1, 0.1, 0.1) });
        cursorY -= 14;
        for (const extra of linhas.slice(1)) {
          novaPaginaSeNecessario(20);
          page.drawText(extra, { x: MARGIN + labelWidth, y: cursorY, size: 9.5, font, color: rgb(0.1, 0.1, 0.1) });
          cursorY -= 14;
        }
      }
    } else if (secao.tipo === "texto") {
      const linhas = wrapText(secao.texto, font, 9.5, maxWidth);
      for (const linha of linhas) {
        novaPaginaSeNecessario(20);
        page.drawText(linha, { x: MARGIN, y: cursorY, size: 9.5, font, color: rgb(0.15, 0.15, 0.15) });
        cursorY -= 14;
      }
    } else if (secao.tipo === "barras") {
      const labelWidth = 170;
      const valorWidth = 80;
      const barAreaWidth = maxWidth - labelWidth - valorWidth;
      const barHeight = 10;
      const maxValor = Math.max(...secao.itens.map((i) => i.valor), 1);

      for (const item of secao.itens) {
        novaPaginaSeNecessario(18);
        const labelTruncado = truncarParaLargura(item.label, font, 8.5, labelWidth - 6);
        page.drawText(labelTruncado, { x: MARGIN, y: cursorY, size: 8.5, font, color: rgb(0.25, 0.25, 0.25) });

        // Barra "de fundo" (teto) sutil, pra dar noção de escala mesmo quando o valor é
        // pequeno perto do maior item — sem ela, itens baixos ficam quase invisíveis.
        page.drawRectangle({
          x: MARGIN + labelWidth,
          y: cursorY - 2,
          width: barAreaWidth,
          height: barHeight,
          color: rgb(0.95, 0.95, 0.97),
        });
        const larguraBarra = Math.max(2, (item.valor / maxValor) * barAreaWidth);
        page.drawRectangle({
          x: MARGIN + labelWidth,
          y: cursorY - 2,
          width: larguraBarra,
          height: barHeight,
          color: rgb(0.267, 0.216, 0.792), // indigo — mesma cor da marca (--brand)
        });

        page.drawText(item.valorLabel, {
          x: MARGIN + labelWidth + barAreaWidth + 8,
          y: cursorY,
          size: 8.5,
          font,
          color: rgb(0.25, 0.25, 0.25),
        });
        cursorY -= 16;
      }
    } else {
      const ctx = { pdfDoc, page, cursorY };
      desenharTabela(ctx, font, fontBold, secao.colunas, secao.linhas);
      page = ctx.page;
      cursorY = ctx.cursorY;
    }
    cursorY -= 12;
  }

  novaPaginaSeNecessario(20);
  page.drawText(`Gerado por Bidd.IA em ${new Date().toLocaleDateString("pt-BR")}`, {
    x: MARGIN,
    y: cursorY,
    size: 8,
    font,
    color: rgb(0.6, 0.6, 0.6),
  });

  return pdfDoc.save();
}
