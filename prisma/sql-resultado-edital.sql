-- Bidd.IA: resultado de edital ganho (valor homologado + itens da planilha final)
-- Aditivo e seguro: só CRIA uma tabela nova. Não altera nem apaga nada que já existe.
-- Espelha exatamente o model ResultadoEdital do prisma/schema.prisma.

CREATE TABLE "ResultadoEdital" (
    "id" TEXT NOT NULL,
    "editalId" TEXT NOT NULL,
    "valorHomologado" DOUBLE PRECISION NOT NULL,
    "itensJson" TEXT NOT NULL DEFAULT '[]',
    "nomeArquivo" TEXT,
    "documentoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResultadoEdital_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ResultadoEdital_editalId_key" ON "ResultadoEdital"("editalId");

ALTER TABLE "ResultadoEdital"
    ADD CONSTRAINT "ResultadoEdital_editalId_fkey"
    FOREIGN KEY ("editalId") REFERENCES "Edital"("id") ON DELETE CASCADE ON UPDATE CASCADE;
