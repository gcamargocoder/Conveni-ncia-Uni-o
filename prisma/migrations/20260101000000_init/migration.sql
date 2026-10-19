CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "categorias" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nome" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "categorias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fornecedores" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nome" TEXT NOT NULL,
    "razao_social" TEXT,
    "telefone" TEXT,
    "whatsapp" TEXT,
    "email" TEXT,
    "cnpj_cpf" TEXT,
    "endereco" TEXT,
    "cidade" TEXT,
    "estado" TEXT,
    "observacoes" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "fornecedores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funcionarios" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nome" TEXT NOT NULL,
    "cargo" TEXT NOT NULL,
    "pin_hash" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "funcionarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clientes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nome" TEXT NOT NULL,
    "telefone" TEXT,
    "cpf" TEXT,
    "endereco" TEXT,
    "observacoes" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "clientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "produtos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nome" TEXT NOT NULL,
    "categoria_id" UUID NOT NULL,
    "fornecedor_id" UUID,
    "codigo_barras" TEXT,
    "descricao" TEXT,
    "preco_venda" DECIMAL(10,2) NOT NULL,
    "preco_custo" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "estoque_minimo" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "unidade" TEXT NOT NULL DEFAULT 'un',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "produtos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "funcionario_id" UUID NOT NULL,
    "cliente_id" UUID,
    "forma_pagamento" TEXT NOT NULL,
    "total" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "desconto" DECIMAL(10,2),
    "valor_recebido" DECIMAL(10,2),
    "troco" DECIMAL(10,2),
    "cancelada" BOOLEAN NOT NULL DEFAULT false,
    "dispositivo" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "vendas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "itens_venda" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "venda_id" UUID NOT NULL,
    "produto_id" UUID NOT NULL,
    "quantidade" DECIMAL(10,3) NOT NULL,
    "preco_unitario" DECIMAL(10,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "itens_venda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimentacoes_estoque" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "produto_id" UUID NOT NULL,
    "tipo" TEXT NOT NULL,
    "quantidade" DECIMAL(10,3) NOT NULL,
    "funcionario_id" UUID NOT NULL,
    "observacao" TEXT,
    "venda_id" UUID,
    "dispositivo" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimentacoes_estoque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contas_receber" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cliente_id" UUID NOT NULL,
    "venda_id" UUID NOT NULL,
    "valor_original" DECIMAL(10,2) NOT NULL,
    "saldo_atual" DECIMAL(10,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ABERTA',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contas_receber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recebimentos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conta_receber_id" UUID NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,
    "forma_pagamento" TEXT NOT NULL,
    "observacoes" TEXT,
    "funcionario_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recebimentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tentativas_pin" (
    "identificador" TEXT NOT NULL,
    "tentativas_falhas" INTEGER NOT NULL DEFAULT 0,
    "bloqueado_ate" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tentativas_pin_pkey" PRIMARY KEY ("identificador")
);

-- CreateIndex
CREATE INDEX "produtos_categoria_id_idx" ON "produtos"("categoria_id");

-- CreateIndex
CREATE INDEX "vendas_created_at_idx" ON "vendas"("created_at");

-- CreateIndex
CREATE INDEX "itens_venda_venda_id_idx" ON "itens_venda"("venda_id");

-- CreateIndex
CREATE INDEX "movimentacoes_estoque_produto_id_idx" ON "movimentacoes_estoque"("produto_id");

-- CreateIndex
CREATE INDEX "movimentacoes_estoque_created_at_idx" ON "movimentacoes_estoque"("created_at");

-- CreateIndex
CREATE INDEX "contas_receber_cliente_id_idx" ON "contas_receber"("cliente_id");

-- CreateIndex
CREATE INDEX "contas_receber_status_idx" ON "contas_receber"("status");

-- CreateIndex
CREATE INDEX "recebimentos_conta_receber_id_idx" ON "recebimentos"("conta_receber_id");

-- AddForeignKey
ALTER TABLE "produtos" ADD CONSTRAINT "produtos_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categorias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produtos" ADD CONSTRAINT "produtos_fornecedor_id_fkey" FOREIGN KEY ("fornecedor_id") REFERENCES "fornecedores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendas" ADD CONSTRAINT "vendas_funcionario_id_fkey" FOREIGN KEY ("funcionario_id") REFERENCES "funcionarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendas" ADD CONSTRAINT "vendas_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_venda" ADD CONSTRAINT "itens_venda_venda_id_fkey" FOREIGN KEY ("venda_id") REFERENCES "vendas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_venda" ADD CONSTRAINT "itens_venda_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produtos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacoes_estoque" ADD CONSTRAINT "movimentacoes_estoque_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produtos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacoes_estoque" ADD CONSTRAINT "movimentacoes_estoque_funcionario_id_fkey" FOREIGN KEY ("funcionario_id") REFERENCES "funcionarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacoes_estoque" ADD CONSTRAINT "movimentacoes_estoque_venda_id_fkey" FOREIGN KEY ("venda_id") REFERENCES "vendas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contas_receber" ADD CONSTRAINT "contas_receber_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contas_receber" ADD CONSTRAINT "contas_receber_venda_id_fkey" FOREIGN KEY ("venda_id") REFERENCES "vendas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recebimentos" ADD CONSTRAINT "recebimentos_conta_receber_id_fkey" FOREIGN KEY ("conta_receber_id") REFERENCES "contas_receber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recebimentos" ADD CONSTRAINT "recebimentos_funcionario_id_fkey" FOREIGN KEY ("funcionario_id") REFERENCES "funcionarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =========================================================
-- Regras que o Prisma não modela (consolidam as migrations
-- 0001..0018 do antigo diretório supabase/migrations)
-- =========================================================

-- CHECKs
ALTER TABLE "funcionarios" ADD CONSTRAINT funcionarios_cargo_check
  CHECK (cargo IN ('proprietario', 'gerente', 'caixa', 'estoquista', 'frentista'));
ALTER TABLE "produtos" ADD CONSTRAINT produtos_preco_venda_check CHECK (preco_venda >= 0);
ALTER TABLE "produtos" ADD CONSTRAINT produtos_preco_custo_check CHECK (preco_custo >= 0);
ALTER TABLE "produtos" ADD CONSTRAINT produtos_unidade_check CHECK (unidade IN ('un', 'kg', 'l'));
ALTER TABLE "vendas" ADD CONSTRAINT vendas_forma_pagamento_check
  CHECK (forma_pagamento IN ('dinheiro', 'debito', 'credito', 'pix', 'fiado'));
ALTER TABLE "itens_venda" ADD CONSTRAINT itens_venda_quantidade_check CHECK (quantidade > 0);
ALTER TABLE "movimentacoes_estoque" ADD CONSTRAINT movimentacoes_estoque_quantidade_check CHECK (quantidade > 0);
ALTER TABLE "movimentacoes_estoque" ADD CONSTRAINT movimentacoes_estoque_tipo_check
  CHECK (tipo IN ('entrada', 'venda', 'perda', 'ajuste_entrada', 'ajuste_saida', 'inventario', 'consumo_interno'));
ALTER TABLE "contas_receber" ADD CONSTRAINT contas_receber_status_check
  CHECK (status IN ('ABERTA', 'PARCIAL', 'QUITADA'));

-- Código de barras único (parcial: só ativos e preenchidos)
CREATE UNIQUE INDEX idx_produtos_codigo_barras
  ON "produtos" (codigo_barras)
  WHERE codigo_barras IS NOT NULL AND deleted_at IS NULL;

-- Busca ILIKE '%termo%' do PDV
CREATE INDEX idx_produtos_nome_trgm ON "produtos" USING gin (nome gin_trgm_ops);

-- updated_at sempre correto, mesmo em SQL direto
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_categorias_updated_at BEFORE UPDATE ON "categorias" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_fornecedores_updated_at BEFORE UPDATE ON "fornecedores" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_funcionarios_updated_at BEFORE UPDATE ON "funcionarios" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_clientes_updated_at BEFORE UPDATE ON "clientes" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_produtos_updated_at BEFORE UPDATE ON "produtos" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_vendas_updated_at BEFORE UPDATE ON "vendas" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_contas_receber_updated_at BEFORE UPDATE ON "contas_receber" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Todo item de venda gera sua movimentação de estoque
CREATE OR REPLACE FUNCTION gerar_movimentacao_venda() RETURNS trigger AS $$
BEGIN
  INSERT INTO movimentacoes_estoque (produto_id, tipo, quantidade, funcionario_id, venda_id)
  SELECT NEW.produto_id, 'venda', NEW.quantidade, v.funcionario_id, NEW.venda_id
  FROM vendas v
  WHERE v.id = NEW.venda_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_itens_venda_gera_movimentacao
  AFTER INSERT ON "itens_venda"
  FOR EACH ROW EXECUTE FUNCTION gerar_movimentacao_venda();

-- Estoque atual = soma do histórico (nunca uma coluna gravada)
CREATE VIEW estoque_atual AS
SELECT
  p.id AS produto_id,
  p.nome,
  p.estoque_minimo,
  COALESCE(SUM(
    CASE
      WHEN m.tipo IN ('entrada', 'inventario', 'ajuste_entrada') THEN m.quantidade
      WHEN m.tipo IN ('venda', 'perda', 'consumo_interno', 'ajuste_saida') THEN -m.quantidade
      ELSE 0
    END
  ), 0) AS quantidade_atual,
  COALESCE(SUM(
    CASE
      WHEN m.tipo IN ('entrada', 'inventario', 'ajuste_entrada') THEN m.quantidade
      WHEN m.tipo IN ('venda', 'perda', 'consumo_interno', 'ajuste_saida') THEN -m.quantidade
      ELSE 0
    END
  ), 0) < p.estoque_minimo AS abaixo_do_minimo,
  p.codigo_barras,
  c.nome AS categoria_nome,
  f.nome AS fornecedor_nome
FROM produtos p
LEFT JOIN categorias c ON c.id = p.categoria_id
LEFT JOIN fornecedores f ON f.id = p.fornecedor_id
LEFT JOIN movimentacoes_estoque m ON m.produto_id = p.id
WHERE p.deleted_at IS NULL
GROUP BY p.id, p.nome, p.estoque_minimo, p.codigo_barras, c.nome, f.nome;

-- Dashboard
CREATE VIEW resumo_vendas_hoje AS
SELECT
  count(*) AS quantidade_vendas,
  COALESCE(SUM(total), 0) AS faturamento
FROM vendas
WHERE cancelada = false
  AND created_at >= date_trunc('day', now())
  AND created_at < date_trunc('day', now()) + interval '1 day';

CREATE OR REPLACE FUNCTION produtos_mais_vendidos(p_dias int DEFAULT 30, p_limite int DEFAULT 5)
RETURNS TABLE (produto_id uuid, nome text, quantidade_total numeric) AS $$
  SELECT p.id AS produto_id, p.nome, SUM(iv.quantidade) AS quantidade_total
  FROM itens_venda iv
  JOIN vendas v ON v.id = iv.venda_id
  JOIN produtos p ON p.id = iv.produto_id
  WHERE v.cancelada = false
    AND v.created_at >= now() - (p_dias || ' days')::interval
  GROUP BY p.id, p.nome
  ORDER BY quantidade_total DESC
  LIMIT p_limite;
$$ LANGUAGE sql STABLE;
