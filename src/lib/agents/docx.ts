import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, BorderStyle } from "docx";
import type { Company } from "@prisma/client";

// Cores/tamanhos escolhidos pra ficar visualmente equivalente ao PDF gerado por
// gerarPdfTimbrado (ver pdf.ts) — tamanho em "half-points" (docx), então 24 = 12pt.
const COR_CINZA_ESCURO = "595959"; // ~rgb(0.35,0.35,0.35)
const COR_CINZA_CLARO = "8C8C8C"; // ~rgb(0.55,0.55,0.55)
const COR_LINHA = "D9D9D9"; // ~rgb(0.85,0.85,0.85)
const COR_CORPO = "262626"; // ~rgb(0.15,0.15,0.15)

function linhaHorizontal(): Paragraph {
  return new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: COR_LINHA, space: 1 } },
    spacing: { after: 240 },
  });
}

function celula(texto: string, opts?: { bold?: boolean; size?: number; color?: string }): TableCell {
  return new TableCell({
    children: [
      new Paragraph({
        children: [new TextRun({ text: texto, bold: opts?.bold, size: opts?.size ?? 16, color: opts?.color ?? COR_CORPO })],
      }),
    ],
    margins: { top: 60, bottom: 60, left: 60, right: 60 },
  });
}

/**
 * Gera um .docx timbrado com o mesmo conteúdo/estrutura visual de gerarPdfTimbrado
 * (pdf.ts) — cabeçalho razão social/CNPJ/endereço, título, parágrafos, tabela opcional,
 * bloco de assinatura. Usado pelo anexo de proposta comercial (ver
 * proposta-comercial.ts), pra sempre gerar as duas versões (PDF + Word) com o mesmo
 * conteúdo.
 */
export async function gerarDocxTimbrado(opts: {
  company: Company;
  titulo: string;
  paragrafos: string[];
  tabela?: { colunas: { label: string }[]; linhas: string[][] };
  rodapeExtra?: string;
}): Promise<Uint8Array> {
  const { company, titulo, paragrafos, tabela, rodapeExtra } = opts;

  const children: (Paragraph | Table)[] = [
    new Paragraph({ children: [new TextRun({ text: company.razaoSocial, bold: true, size: 24 })] }),
    new Paragraph({
      children: [new TextRun({ text: `CNPJ: ${company.cnpj}`, size: 18, color: COR_CINZA_ESCURO })],
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `${company.logradouro}, ${company.numero} - ${company.bairro}, ${company.cidade}/${company.uf}`,
          size: 18,
          color: COR_CINZA_ESCURO,
        }),
      ],
      spacing: { after: 120 },
    }),
    linhaHorizontal(),
    new Paragraph({
      children: [new TextRun({ text: titulo, bold: true, size: 28 })],
      spacing: { after: 240 },
    }),
  ];

  for (const paragrafo of paragrafos) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: paragrafo, size: 21, color: COR_CORPO })],
        spacing: { after: 200 },
      })
    );
  }

  if (tabela && tabela.linhas.length > 0) {
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: tabela.colunas.map((c) => celula(c.label, { bold: true, size: 17, color: COR_CINZA_ESCURO })),
          }),
          ...tabela.linhas.map((linha) => new TableRow({ children: linha.map((v) => celula(v)) })),
        ],
      }),
      new Paragraph({ spacing: { after: 240 } })
    );
  }

  children.push(
    new Paragraph({
      children: [new TextRun({ text: "_______________________________", color: COR_CINZA_ESCURO })],
      spacing: { before: 240, after: 40 },
    }),
    new Paragraph({ children: [new TextRun({ text: company.socioNome, bold: true, size: 20 })] }),
    new Paragraph({
      children: [
        new TextRun({ text: `CPF: ${company.socioCpf} — Sócio(a) e Responsável Legal`, size: 18, color: COR_CINZA_ESCURO }),
      ],
    })
  );

  if (rodapeExtra) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: rodapeExtra, size: 16, color: COR_CINZA_CLARO })],
        spacing: { before: 240 },
      })
    );
  }

  const doc = new Document({
    sections: [{ properties: {}, children }],
    styles: { default: { document: { run: { font: "Helvetica" } } } },
  });

  const buffer = await Packer.toBuffer(doc);
  return new Uint8Array(buffer);
}

export function bytesToDocxDataUrl(bytes: Uint8Array) {
  return `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${Buffer.from(bytes).toString("base64")}`;
}
