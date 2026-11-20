-- Controle de caixa (migration ADITIVA e não destrutiva).
-- Cria caixas, movimentos_caixa (imutável), auditoria_caixa (imutável) e caixa_conflitos.
-- Nenhuma tabela existente é apagada/recriada e nenhuma linha existente é alterada.
-- Único ajuste em estrutura existente: vendas_forma_pagamento_check passa a aceitar 'misto'
-- (venda com pagamento dividido; o detalhe de cada forma fica em movimentos_caixa).

-- CreateTable
CREATE TABLE "caixas" (
    "id" UUID NOT NULL,
    "terminal_id" TEXT NOT NULL,
    "terminal_papel" TEXT,
    "status" TEXT NOT NULL DEFAULT 'aberto',
    "fundo_inicial_centavos" INTEGER NOT NULL,
    "observacoes_abertura" TEXT,
    "aberto_em" TIMESTAMPTZ(6) NOT NULL,
    "aberto_por_funcionario_id" UUID NOT NULL,
    "aberto_por_usuario_id" UUID,
    "origem_abertura" TEXT NOT NULL,
    "registrado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechado_em" TIMESTAMPTZ(6),
    "fechado_por_funcionario_id" UUID,
    "fechado_por_usuario_id" UUID,
    "origem_fechamento" TEXT,
    "conferencia" JSONB,
    "resumo_terminal" JSONB,
    "resumo_fechamento" JSONB,
    "diferenca_dinheiro_centavos" INTEGER,
    "diferenca_total_centavos" INTEGER,
    "justificativa_divergencia" TEXT,
    "conferencia_status" TEXT,
    "conferido_por_usuario_id" UUID,
    "conferido_em" TIMESTAMPTZ(6),
    "conferencia_obs" TEXT,
    "reaberturas" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "caixas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimentos_caixa" (
    "id" UUID NOT NULL,
    "caixa_id" UUID NOT NULL,
    "tipo" TEXT NOT NULL,
    "sentido" TEXT NOT NULL,
    "forma_pagamento" TEXT NOT NULL,
    "valor_centavos" INTEGER NOT NULL,
    "funcionario_id" UUID NOT NULL,
    "usuario_id" UUID,
    "dispositivo" TEXT NOT NULL,
    "origem" TEXT NOT NULL,
    "origem_operacao" TEXT NOT NULL,
    "venda_id" UUID,
    "recebimento_id" UUID,
    "estorno_de_id" UUID,
    "ordem" INTEGER,
    "descricao" TEXT,
    "justificativa" TEXT,
    "cartao_bandeira" TEXT,
    "cartao_adquirente" TEXT,
    "cartao_parcelas" INTEGER,
    "cartao_taxa_centavos" INTEGER,
    "transacao_id" TEXT,
    "ocorrido_em" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimentos_caixa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auditoria_caixa" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "caixa_id" UUID NOT NULL,
    "acao" TEXT NOT NULL,
    "funcionario_id" UUID,
    "usuario_id" UUID,
    "dispositivo" TEXT,
    "origem" TEXT,
    "detalhes" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auditoria_caixa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "caixa_conflitos" (
    "id" UUID NOT NULL,
    "tipo" TEXT NOT NULL,
    "caixa_id" TEXT,
    "dispositivo" TEXT,
    "usuario_id" UUID,
    "payload" JSONB NOT NULL,
    "motivo" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "tratado_por" UUID,
    "tratado_em" TIMESTAMPTZ(6),
    "observacao" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "caixa_conflitos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "caixas_terminal_id_status_idx" ON "caixas"("terminal_id", "status");

-- CreateIndex
CREATE INDEX "caixas_aberto_em_idx" ON "caixas"("aberto_em");

-- CreateIndex
CREATE INDEX "caixas_status_idx" ON "caixas"("status");

-- CreateIndex
CREATE UNIQUE INDEX "movimentos_caixa_recebimento_id_key" ON "movimentos_caixa"("recebimento_id");

-- CreateIndex
CREATE UNIQUE INDEX "movimentos_caixa_estorno_de_id_key" ON "movimentos_caixa"("estorno_de_id");

-- CreateIndex
CREATE INDEX "movimentos_caixa_caixa_id_ocorrido_em_idx" ON "movimentos_caixa"("caixa_id", "ocorrido_em");

-- CreateIndex
CREATE INDEX "movimentos_caixa_venda_id_idx" ON "movimentos_caixa"("venda_id");

-- CreateIndex
CREATE INDEX "movimentos_caixa_funcionario_id_idx" ON "movimentos_caixa"("funcionario_id");

-- CreateIndex
CREATE UNIQUE INDEX "movimentos_caixa_venda_id_tipo_ordem_key" ON "movimentos_caixa"("venda_id", "tipo", "ordem");

-- CreateIndex
CREATE INDEX "auditoria_caixa_caixa_id_created_at_idx" ON "auditoria_caixa"("caixa_id", "created_at");

-- CreateIndex
CREATE INDEX "caixa_conflitos_status_idx" ON "caixa_conflitos"("status");

-- AddForeignKey
ALTER TABLE "caixas" ADD CONSTRAINT "caixas_aberto_por_funcionario_id_fkey" FOREIGN KEY ("aberto_por_funcionario_id") REFERENCES "funcionarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caixas" ADD CONSTRAINT "caixas_fechado_por_funcionario_id_fkey" FOREIGN KEY ("fechado_por_funcionario_id") REFERENCES "funcionarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caixas" ADD CONSTRAINT "caixas_aberto_por_usuario_id_fkey" FOREIGN KEY ("aberto_por_usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caixas" ADD CONSTRAINT "caixas_fechado_por_usuario_id_fkey" FOREIGN KEY ("fechado_por_usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentos_caixa" ADD CONSTRAINT "movimentos_caixa_caixa_id_fkey" FOREIGN KEY ("caixa_id") REFERENCES "caixas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentos_caixa" ADD CONSTRAINT "movimentos_caixa_funcionario_id_fkey" FOREIGN KEY ("funcionario_id") REFERENCES "funcionarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentos_caixa" ADD CONSTRAINT "movimentos_caixa_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentos_caixa" ADD CONSTRAINT "movimentos_caixa_venda_id_fkey" FOREIGN KEY ("venda_id") REFERENCES "vendas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentos_caixa" ADD CONSTRAINT "movimentos_caixa_recebimento_id_fkey" FOREIGN KEY ("recebimento_id") REFERENCES "recebimentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentos_caixa" ADD CONSTRAINT "movimentos_caixa_estorno_de_id_fkey" FOREIGN KEY ("estorno_de_id") REFERENCES "movimentos_caixa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auditoria_caixa" ADD CONSTRAINT "auditoria_caixa_caixa_id_fkey" FOREIGN KEY ("caixa_id") REFERENCES "caixas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auditoria_caixa" ADD CONSTRAINT "auditoria_caixa_funcionario_id_fkey" FOREIGN KEY ("funcionario_id") REFERENCES "funcionarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auditoria_caixa" ADD CONSTRAINT "auditoria_caixa_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- =====================================================================
-- Regras que o Prisma não modela
-- =====================================================================

ALTER TABLE "vendas" DROP CONSTRAINT vendas_forma_pagamento_check;
ALTER TABLE "vendas" ADD CONSTRAINT vendas_forma_pagamento_check
  CHECK (forma_pagamento IN ('dinheiro', 'debito', 'credito', 'pix', 'fiado', 'misto'));

ALTER TABLE "caixas" ADD CONSTRAINT caixas_status_check CHECK (status IN ('aberto', 'fechado'));
ALTER TABLE "caixas" ADD CONSTRAINT caixas_fundo_check CHECK (fundo_inicial_centavos >= 0);
ALTER TABLE "caixas" ADD CONSTRAINT caixas_origem_check CHECK (origem_abertura IN ('online', 'offline'));
ALTER TABLE "caixas" ADD CONSTRAINT caixas_conferencia_status_check
  CHECK (conferencia_status IS NULL OR conferencia_status IN ('pendente', 'conferido'));
-- Fechado exige quem e quando fechou.
ALTER TABLE "caixas" ADD CONSTRAINT caixas_fechamento_completo_check
  CHECK (status = 'aberto' OR (fechado_em IS NOT NULL AND fechado_por_funcionario_id IS NOT NULL));

-- No máximo UM caixa aberto por terminal (vale também sob concorrência).
CREATE UNIQUE INDEX "caixas_um_aberto_por_terminal" ON "caixas" ("terminal_id") WHERE status = 'aberto';

ALTER TABLE "movimentos_caixa" ADD CONSTRAINT movimentos_caixa_valor_check CHECK (valor_centavos > 0);
ALTER TABLE "movimentos_caixa" ADD CONSTRAINT movimentos_caixa_sentido_check CHECK (sentido IN ('entrada', 'saida'));
ALTER TABLE "movimentos_caixa" ADD CONSTRAINT movimentos_caixa_origem_check CHECK (origem IN ('online', 'offline'));
ALTER TABLE "movimentos_caixa" ADD CONSTRAINT movimentos_caixa_tipo_check CHECK (tipo IN (
  'venda', 'recebimento_conta', 'suprimento', 'outra_entrada', 'ajuste_entrada',
  'sangria', 'despesa', 'outra_saida', 'ajuste_saida', 'estorno'));
ALTER TABLE "movimentos_caixa" ADD CONSTRAINT movimentos_caixa_forma_check
  CHECK (forma_pagamento IN ('dinheiro', 'pix', 'credito', 'debito', 'fiado'));
ALTER TABLE "movimentos_caixa" ADD CONSTRAINT movimentos_caixa_origem_operacao_check
  CHECK (origem_operacao IN ('pdv', 'conta_receber', 'caixa'));
ALTER TABLE "movimentos_caixa" ADD CONSTRAINT movimentos_caixa_taxa_check
  CHECK (cartao_taxa_centavos IS NULL OR (cartao_taxa_centavos >= 0 AND cartao_taxa_centavos <= valor_centavos));
-- Sangria, suprimento, despesa, saídas/entradas avulsas e ajustes sempre movem DINHEIRO.
ALTER TABLE "movimentos_caixa" ADD CONSTRAINT movimentos_caixa_dinheiro_avulso_check
  CHECK (tipo NOT IN ('suprimento', 'outra_entrada', 'ajuste_entrada', 'sangria', 'despesa', 'outra_saida', 'ajuste_saida')
         OR forma_pagamento = 'dinheiro');
-- Quem move dinheiro sem ser venda precisa explicar (descrição ou justificativa).
ALTER TABLE "movimentos_caixa" ADD CONSTRAINT movimentos_caixa_explicacao_check
  CHECK (tipo IN ('venda', 'recebimento_conta')
         OR length(btrim(coalesce(justificativa, '') || coalesce(descricao, ''))) > 0);
ALTER TABLE "movimentos_caixa" ADD CONSTRAINT movimentos_caixa_venda_check
  CHECK (tipo <> 'venda' OR (venda_id IS NOT NULL AND ordem IS NOT NULL));

ALTER TABLE "caixa_conflitos" ADD CONSTRAINT caixa_conflitos_status_check CHECK (status IN ('pendente', 'tratado'));

-- Movimento só entra em caixa ABERTO (defesa no banco, além da regra da aplicação).
CREATE FUNCTION "movimentos_caixa_exige_caixa_aberto"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "caixas" WHERE id = NEW.caixa_id AND status = 'aberto') THEN
    RAISE EXCEPTION 'Caixa fechado ou inexistente: movimentação recusada' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "movimentos_caixa_exige_caixa_aberto"
BEFORE INSERT ON "movimentos_caixa"
FOR EACH ROW EXECUTE FUNCTION "movimentos_caixa_exige_caixa_aberto"();

-- Imutabilidade: nunca se apaga; a única atualização tolerada é a anulação de usuario_id
-- feita pelo próprio banco (ON DELETE SET NULL de um login removido).
CREATE FUNCTION "caixa_registro_imutavel"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Registro de caixa imutável: não pode ser apagado (%).', TG_TABLE_NAME USING ERRCODE = '23514';
  END IF;
  IF NEW.usuario_id IS NULL AND (to_jsonb(NEW) - 'usuario_id') = (to_jsonb(OLD) - 'usuario_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Registro de caixa imutável: não pode ser alterado (%). Registre um estorno ou ajuste.', TG_TABLE_NAME USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER "movimentos_caixa_imutavel"
BEFORE UPDATE OR DELETE ON "movimentos_caixa"
FOR EACH ROW EXECUTE FUNCTION "caixa_registro_imutavel"();
CREATE TRIGGER "auditoria_caixa_imutavel"
BEFORE UPDATE OR DELETE ON "auditoria_caixa"
FOR EACH ROW EXECUTE FUNCTION "caixa_registro_imutavel"();

-- Caixa: a identidade e a abertura não mudam; nunca é apagado; reabrir só com reaberturas + 1
-- (a aplicação exige permissão administrativa, justificativa e grava a auditoria).
CREATE FUNCTION "caixas_protege_historico"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Caixa não pode ser apagado.' USING ERRCODE = '23514';
  END IF;
  IF NEW.id <> OLD.id OR NEW.terminal_id <> OLD.terminal_id OR NEW.aberto_em <> OLD.aberto_em
     OR NEW.aberto_por_funcionario_id <> OLD.aberto_por_funcionario_id
     OR NEW.fundo_inicial_centavos <> OLD.fundo_inicial_centavos THEN
    RAISE EXCEPTION 'Dados de abertura do caixa não podem ser alterados.' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'fechado' AND NEW.status = 'aberto' AND NEW.reaberturas <> OLD.reaberturas + 1 THEN
    RAISE EXCEPTION 'Reabertura de caixa exige registro de reabertura.' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'fechado' AND NEW.status = 'fechado' AND NEW.fechado_em IS DISTINCT FROM OLD.fechado_em THEN
    RAISE EXCEPTION 'Caixa já fechado não pode ser fechado de novo.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "caixas_protege_historico"
BEFORE UPDATE OR DELETE ON "caixas"
FOR EACH ROW EXECUTE FUNCTION "caixas_protege_historico"();


-- Autorizações por PIN (validadas no servidor) das operações administrativas do caixa.
CREATE TABLE "autorizacoes_caixa" (
    "id" UUID NOT NULL,
    "funcionario_id" UUID NOT NULL,
    "usuario_id" UUID,
    "permissao" TEXT NOT NULL,
    "escopo" TEXT NOT NULL,
    "expira_em" TIMESTAMPTZ(6) NOT NULL,
    "consumida_em" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "autorizacoes_caixa_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "autorizacoes_caixa_expira_em_idx" ON "autorizacoes_caixa"("expira_em");

-- Uso único: depois de consumida, a autorização é imutável (nem reaberta, nem alterada, nem apagada).
CREATE FUNCTION "autorizacoes_caixa_uso_unico"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."consumida_em" IS NOT NULL THEN
      RAISE EXCEPTION 'Autorização de caixa já utilizada não pode ser apagada';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."consumida_em" IS NOT NULL THEN
    RAISE EXCEPTION 'Autorização de caixa já utilizada não pode ser alterada';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "autorizacoes_caixa_uso_unico"
BEFORE UPDATE OR DELETE ON "autorizacoes_caixa"
FOR EACH ROW EXECUTE FUNCTION "autorizacoes_caixa_uso_unico"();
