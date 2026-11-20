-- Horário de OCORRÊNCIA da venda (informado pelo dispositivo), separado do horário de RECEBIMENTO no servidor.
--
-- vendas.created_at  = horário confiável de gravação no servidor (nunca vem do dispositivo).
-- vendas.ocorrido_em = horário em que a venda aconteceu segundo o relógio do terminal, já validado
--                      (janela de sincronização de 48 h, não anterior à abertura do caixa, no máximo 5 min no futuro).
--
-- Migration ADITIVA: só acrescenta uma coluna anulável. Nenhuma linha existente é alterada ou reinterpretada:
-- vendas antigas ficam com ocorrido_em NULL e continuam usando created_at nos relatórios e no recibo.
ALTER TABLE "vendas" ADD COLUMN "ocorrido_em" TIMESTAMPTZ(6);

COMMENT ON COLUMN "vendas"."ocorrido_em" IS 'Horário da venda segundo o dispositivo (validado). NULL = venda antiga ou sem horário informado; nesses casos vale created_at.';
COMMENT ON COLUMN "vendas"."created_at" IS 'Horário de gravação/recebimento no servidor. Nunca é substituído por horário informado pelo dispositivo.';

CREATE INDEX "vendas_ocorrido_em_idx" ON "vendas"("ocorrido_em");
