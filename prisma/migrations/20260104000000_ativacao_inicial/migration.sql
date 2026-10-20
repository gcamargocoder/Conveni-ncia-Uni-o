-- Ativação inicial da conta principal (migration ADITIVA: só cria uma tabela nova).
-- Guarda o pedido pendente até o link de e-mail ser confirmado. Nenhuma tabela existente é alterada.
-- A senha fica só como hash Argon2id; o token do link, só como SHA-256.
CREATE TABLE "ativacoes_iniciais" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "senha_hash" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expira_em" TIMESTAMPTZ(6) NOT NULL,
    "usado_em" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ativacoes_iniciais_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ativacoes_iniciais_email_minusculo" CHECK ("email" = lower("email"))
);

CREATE UNIQUE INDEX "ativacoes_iniciais_token_hash_key" ON "ativacoes_iniciais"("token_hash");
