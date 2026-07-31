-- =========================================================
-- 0016_registrar_venda_com_deteccao_conflito.sql
-- Fase 6.5 — auditoria avançada exige distinguir "sincronizei uma
-- venda nova" de "essa venda já existia, ignorei" (conflito resolvido
-- pela idempotência da migration 0014). Até agora a função só
-- devolvia o id, sem dizer qual dos dois casos aconteceu — impossível
-- para o cliente auditar conflitos de verdade.
--
-- Muda o retorno de `uuid` para `jsonb` com { id, ja_existia }.
-- Precisa DROP porque Postgres não permite mudar o tipo de retorno
-- via CREATE OR REPLACE.
-- =========================================================

drop function if exists registrar_venda_completa(uuid, uuid, text, numeric, jsonb, text);

create function registrar_venda_completa(
  p_id uuid,
  p_funcionario_id uuid,
  p_forma_pagamento text,
  p_total numeric,
  p_itens jsonb,
  p_dispositivo text default null
) returns jsonb as $$
declare
  v_venda_id uuid;
  v_item jsonb;
  v_ja_existia boolean;
begin
  select exists(select 1 from vendas where id = p_id) into v_ja_existia;

  if v_ja_existia then
    return jsonb_build_object('id', p_id, 'ja_existia', true);
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

  return jsonb_build_object('id', v_venda_id, 'ja_existia', false);
end;
$$ language plpgsql;