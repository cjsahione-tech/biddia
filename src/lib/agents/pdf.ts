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
 * Gera um PDF timbrado com logo/cabeçalho da empresa, título e parágrafos de corpo.
 * Retorna os bytes do PDF já prontos para persistir em base64.
 */
export async function gerarPdfTimbrado(opts: {
  company: Company;
  titulo: string;
  paragrafos: string[];
  rodapeExtra?: string;
}): Promise<Uint8Array> {
  const { company, titulo, paragrafos, rodapeExtra } = opts;

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
