import fs from "node:fs";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { StandardFonts, type PDFDocument, type PDFFont } from "pdf-lib";

// A Helvetica "padrão" do PDF só entende o conjunto WinAnsi (latim ocidental básico) —
// qualquer outro caractere (ex: "˚" U+02DA, "≤", "→", aspas tipográficas raras) faz o
// pdf-lib LANÇAR um erro na hora de desenhar o texto, derrubando o agente inteiro. Como
// o texto vem direto do edital, não dá pra prever o que aparece. Solução em duas camadas:
// 1) embutir uma fonte Unicode de verdade (Noto Sans, licença OFL) — preserva o texto
//    original; 2) mesmo com ela (ou se o arquivo da fonte não puder ser lido no servidor),
//    qualquer caractere que a fonte escolhida não tenha é trocado por um equivalente seguro
//    em vez de estourar erro.

const DIR_FONTES = path.join(process.cwd(), "src", "lib", "agents", "fonts");

let bytesFontes: { regular: Uint8Array; bold: Uint8Array } | null | undefined;

function lerFontes() {
  if (bytesFontes !== undefined) return bytesFontes;
  try {
    bytesFontes = {
      regular: new Uint8Array(fs.readFileSync(path.join(DIR_FONTES, "NotoSans-Regular.ttf"))),
      bold: new Uint8Array(fs.readFileSync(path.join(DIR_FONTES, "NotoSans-Bold.ttf"))),
    };
  } catch (err) {
    console.error("Fonte Unicode (Noto Sans) indisponível — usando Helvetica com substituição de caracteres:", err);
    bytesFontes = null;
  }
  return bytesFontes;
}

const SUBSTITUICOES: Record<string, string> = {
  "˚": "°", // ˚ (anel acima) -> ° (grau)
  "⁰": "°",
  "≤": "<=",
  "≥": ">=",
  "≠": "!=",
  "→": "->",
  "←": "<-",
  "↔": "<->",
  "−": "-", // sinal de menos
  "‑": "-", // hífen não separável
  "‐": "-",
  " ": " ",
  " ": " ",
  " ": " ",
  " ": " ",
  "​": "",
  "‌": "",
  "‍": "",
  "﻿": "",
  "­": "",
};

function criarLimpador(font: PDFFont) {
  const suportados = new Set<number>(font.getCharacterSet());
  return (texto: string) => {
    let saida = "";
    for (const ch of texto) {
      const cp = ch.codePointAt(0)!;
      if (cp === 0x09 || cp === 0x0a || cp === 0x0d) {
        saida += " ";
        continue;
      }
      if (suportados.has(cp)) {
        saida += ch;
        continue;
      }
      const sub = SUBSTITUICOES[ch];
      if (sub !== undefined) {
        // a substituição também precisa ser desenhável (ex: "°" na Helvetica sim)
        saida += Array.from(sub).every((c) => suportados.has(c.codePointAt(0)!)) ? sub : "?";
      } else {
        saida += "?";
      }
    }
    return saida;
  };
}

/** Faz a fonte aceitar QUALQUER texto sem lançar erro — o que ela não tiver vira
 * equivalente seguro (ver SUBSTITUICOES) ou "?". Aplicado também a widthOfTextAtSize,
 * senão a quebra de linha mediria um texto diferente do que é desenhado. */
function tornarSegura(font: PDFFont): PDFFont {
  const limpar = criarLimpador(font);
  const encode = font.encodeText.bind(font);
  const largura = font.widthOfTextAtSize.bind(font);
  font.encodeText = (texto: string) => encode(limpar(texto));
  font.widthOfTextAtSize = (texto: string, tamanho: number) => largura(limpar(texto), tamanho);
  return font;
}

export async function embutirFontes(pdfDoc: PDFDocument): Promise<{ font: PDFFont; fontBold: PDFFont }> {
  const bytes = lerFontes();
  if (bytes) {
    try {
      pdfDoc.registerFontkit(fontkit);
      const font = await pdfDoc.embedFont(bytes.regular, { subset: true });
      const fontBold = await pdfDoc.embedFont(bytes.bold, { subset: true });
      return { font: tornarSegura(font), fontBold: tornarSegura(fontBold) };
    } catch (err) {
      console.error("Falha ao embutir a fonte Unicode — usando Helvetica com substituição de caracteres:", err);
    }
  }
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  return { font: tornarSegura(font), fontBold: tornarSegura(fontBold) };
}
