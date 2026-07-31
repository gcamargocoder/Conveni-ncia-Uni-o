-- =========================================================
-- 0014_registrar_venda_idempotente.sql
-- CORREÇÃO CRÍTICA para a Fase 4 (sincronização): a função criada na
-- Etapa 6 nunca aceitava um `id` — sempre gerava um UUID novo no
-- servidor (default gen_random_uuid()). Isso quebrava a idempotência
-- que a arquitetura Offline First promete desde a Fase 3: o UUID
-- gerado no dispositivo no momento da venda precisa ser o MESMO
-- que existe no servidor, senão reenviar por falha de rede criaria
-- uma venda duplicada em vez de ser ignorado.
--
-- Agora a função recebe p_id e verifica primeiro se já existe uma
-- venda com esse id — se existir, não faz nada e apenas retorna o id
-- (idempotente de verdade: reenviar o mesmo id nunca duplica nem
-- gera erro).
-- =========================================================

create or replace function registrar_venda_completa(
  p_id uuid,
  p_funcionario_id uuid,
  p_forma_pagamento text,
  p_total numeric,
  p_itens jsonb,
  p_dispositivo text default null
) returns uuid as $$
declare
  v_venda_id uuid;
  v_item jsonb;
  v_ja_existia boolean;
begin
  select exists(select 1 from vendas where id = p_id) into v_ja_existia;

  if v_ja_existia then
    -- Idempotência: esta venda já foi sincronizada antes (provavelmente
    -- a resposta anterior se perdeu por queda de conexão). Não repete
    -- nada — nem venda, nem itens, nem movimentação.
    return p_id;
  end if;

  insert into vendas (id, funcionario_id, forma_pagamento, total, dispositivo)
  values (p_id, p_funcionario_id, p_forma_pagamento, p_total, p_dispositivo)
  returning id into v_venda_id;

  for v_item in select * from jsonb_array_elements(p_itens)
  loop
    insert into itens_venda (venda_id, produto_id, quantidade, preco_unitario)
    values (
      v_venda_id,
      (v_item->>'produto_id')::uuid,
      (v_item->>'quantidade')::numeric,
      (v_item->>'preco_unitario')::numeric
    );
  end loop;

  update movimentacoes_estoque
  set dispositivo = p_dispositivo
  where venda_id = v_venda_id;

  return v_venda_id;
end;
$$ language plpgsql;
