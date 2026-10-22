import { describe, expect, it } from "vitest";
import { avisoDeAnexosExternos, detectarAnexosExternos, detectarContradicoes } from "@/lib/habilitacao-sinais";

describe("detectarAnexosExternos", () => {
  it("anexo disponível em link de outro site: avisa", () => {
    const texto = "Os licitantes devem observar o Anexo II (planilha de quantitativos), disponível em https://www.prefeitura.exemplo.sp.gov.br/licitacoes/anexo2.xlsx para download.";
    const r = detectarAnexosExternos(texto);
    expect(r).toHaveLength(1);
    expect(r[0].link).toBe("https://www.prefeitura.exemplo.sp.gov.br/licitacoes/anexo2.xlsx");
    expect(avisoDeAnexosExternos(r)).toMatch(/link externo/);
  });

  it("link do PNCP, Compras.gov.br ou de portal que o sistema já lê não conta", () => {
    const texto = "O edital e seus anexos estão disponíveis em https://pncp.gov.br/app/editais/123 e na plataforma https://www.gov.br/compras/pt-br. Acesse também https://licitanet.com.br/x para os anexos.";
    expect(detectarAnexosExternos(texto)).toEqual([]);
  });

  it("link sem relação com anexo (ex.: site do órgão no rodapé) não conta", () => {
    expect(detectarAnexosExternos("Mais informações no site https://www.orgao.exemplo.gov.br ou pelo telefone.")).toEqual([]);
  });

  it("limita a quantidade e não repete o mesmo link", () => {
    const texto = Array.from({ length: 6 }, (_, i) => `O anexo ${i} está disponível em https://exemplo${i}.com/arquivo${i}.pdf. `).join("\n") + "O anexo 0 está disponível em https://exemplo0.com/arquivo0.pdf.";
    expect(detectarAnexosExternos(texto)).toHaveLength(3);
    expect(avisoDeAnexosExternos([])).toBeNull();
  });
});

describe("detectarContradicoes", () => {
  const b = (origem: string, condicao: string | null, chave: string | null = "tecnica-atestado") => ({ chave, documento: "Atestado de capacidade técnica", origem, condicao });

  it("mesmo documento, arquivos diferentes, números diferentes: avisa", () => {
    const r = detectarContradicoes([b("Edital.pdf", "no mínimo 50% do quantitativo"), b("TR.pdf", "no mínimo 30% do quantitativo")]);
    expect(r).toHaveLength(1);
    expect(r[0]).toContain("Edital.pdf");
    expect(r[0]).toContain("TR.pdf");
  });

  it("mesmos números (só redação diferente), mesmo arquivo, sem número ou sem chave: não avisa", () => {
    expect(detectarContradicoes([b("Edital.pdf", "mínimo de 50% do quantitativo"), b("TR.pdf", "pelo menos 50% do quantitativo")])).toEqual([]);
    expect(detectarContradicoes([b("Edital.pdf", "50%"), b("Edital.pdf", "30%")])).toEqual([]);
    expect(detectarContradicoes([b("Edital.pdf", "compatível"), b("TR.pdf", "similar")])).toEqual([]);
    expect(detectarContradicoes([b("Edital.pdf", "50%", null), b("TR.pdf", "30%", null)])).toEqual([]);
  });
});
