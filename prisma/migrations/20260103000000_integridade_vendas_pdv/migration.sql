-- Integridade das vendas do PDV (aditiva e não destrutiva).
--  * vendas.usuario_id: quem (login) estava autenticado ao registrar a venda.
--    Nullable: vendas existentes ficam NULL; nada é reescrito.
--  * vendas_revisao: vendas recebidas da fila offline que o servidor NÃO aceitou
--    automaticamente (preço divergente, funcionário inativo etc.). Ficam retidas
--    com os motivos até um administrador aprovar ou rejeitar — nunca são descartadas.

-- AlterTable
ALTER TABLE "vendas" ADD COLUMN "usuario_id" UUID;

-- CreateTable
CREATE TABLE "vendas_revisao" (
    "id" UUID NOT NULL,
    "usuario_id" UUID,
    "funcionario_id" TEXT,
    "payload" JSONB NOT NULL,
    "motivos" JSONB NOT NULL,
    "bloqueante" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "decidido_por" UUID,
    "decidido_em" TIMESTAMPTZ(6),
    "observacao" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendas_revisao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vendas_usuario_id_idx" ON "vendas"("usuario_id");

-- CreateIndex
CREATE INDEX "vendas_revisao_status_idx" ON "vendas_revisao"("status");

-- AddForeignKey
ALTER TABLE "vendas" ADD CONSTRAINT "vendas_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendas_revisao" ADD CONSTRAINT "vendas_revisao_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendas_revisao" ADD CONSTRAINT "vendas_revisao_decidido_por_fkey" FOREIGN KEY ("decidido_por") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Regras que o Prisma não modela
ALTER TABLE "vendas_revisao" ADD CONSTRAINT vendas_revisao_status_check CHECK (status IN ('pendente', 'aprovada', 'rejeitada'));
