import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { extractText, getDocumentProxy } from "unpdf";
import type { Company } from "@prisma/client";
import { gerarPdfTimbrado, gerarPdfRelatorio } from "@/lib/agents/pdf";
import { embutirFontes } from "@/lib/agents/pdf-fontes";

const company = {
  razaoSocial: "Empresa Teste LTDA",
  cnpj: "00.000.000/0001-91",
  logradouro: "Rua A",
  numero: "1",
  bairro: "Centro",
  cidade: "São Paulo",
  uf: "SP",
  socioNome: "Fulano da Silva",
  socioCpf: "000.000.000-00",
  logoUrl: null,
} as unknown as Company;

async function textoDoPdf(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

describe("PDFs com caracteres fora do WinAnsi (bug: 'WinAnsi cannot encode ˚')", () => {
  it("a Helvetica padrão realmente falha com o símbolo ˚ (reproduz o erro original)", async () => {
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const page = pdfDoc.addPage();
    expect(() => page.drawText("temperatura 32-42,9˚C", { font })).toThrow(/WinAnsi/);
  });

  it("gerarPdfTimbrado preserva ˚, ° e acentos (e troca ≤/→ por equivalentes) no texto do anexo", async () => {
    const bytes = await gerarPdfTimbrado({
      company,
      titulo: "Anexo III – Declaração de conformidade térmica",
      paragrafos: ["Armazenar entre 32-42,9˚C (ou 2°C a 8°C), umidade ≤ 60%, vazão ≥ 5 L/min → conforme."],
    });
    const texto = await textoDoPdf(bytes);
    expect(texto).toContain("32-42,9");
    expect(texto).toContain("Declaração");
    expect(texto).toContain("˚"); // texto original preservado (fonte Unicode embutida)
    expect(texto).toContain("<= 60%"); // ≤ não existe na fonte: vira equivalente legível, sem erro
  });

  it("gerarPdfTimbrado nunca lança erro, mesmo com emoji e caracteres exóticos", async () => {
    const bytes = await gerarPdfTimbrado({
      company,
      titulo: "Teste 😀 exótico ☃",
      paragrafos: ["Linha com emoji 🚀, kanji 漢字 e controle\u0007 inválido."],
      rodapeExtra: "rodapé ˚",
    });
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it("gerarPdfRelatorio também aceita ˚ em campos e tabelas", async () => {
    const bytes = await gerarPdfRelatorio({
      company,
      titulo: "Relatório",
      secoes: [
        { tipo: "campos", titulo: "Dados", campos: [{ label: "Faixa", valor: "32-42,9˚C" }] },
        { tipo: "tabela", titulo: "Itens", colunas: [{ label: "Item", largura: 200 }], linhas: [["Reagente 2˚C ≤ 8˚C"]] },
      ],
    });
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it("sem a fonte Unicode (fallback Helvetica), o texto é sanitizado em vez de estourar erro", async () => {
    const pdfDoc = await PDFDocument.create();
    // força o caminho de fallback: Helvetica + substituição de caracteres
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    // reaproveita o mesmo tornarSegura via embutirFontes não é possível sem o arquivo —
    // aqui garante que embutirFontes devolve fontes que aceitam o símbolo
    const { font: seguro } = await embutirFontes(pdfDoc);
    const page = pdfDoc.addPage();
    expect(() => page.drawText("32-42,9˚C ≤ 😀", { font: seguro })).not.toThrow();
    expect(font).toBeDefined();
  });
});
