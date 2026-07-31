-- =========================================================
-- 0006_registrar_venda_completa.sql
-- Grava venda + itens numa única transação de banco.
-- Por quê: inserir venda e itens em chamadas separadas do
-- cliente JS deixaria uma janela onde a venda existe sem
-- itens (ou vice-versa) se a conexão cair no meio — exatamente
-- o tipo de falha que o princípio "a venda nunca pode ser
-- impedida/perdida" não pode permitir.
-- =========================================================

create or replace function registrar_venda_completa(
  p_funcionario_id uuid,
  p_forma_pagamento text,
  p_total numeric,
  p_itens jsonb
) returns uuid as $$
declare
  v_venda_id uuid;
  v_item jsonb;
begin
  insert into vendas (funcionario_id, forma_pagamento, total)
  values (p_funcionario_id, p_forma_pagamento, p_total)
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
    -- a movimentação de estoque é criada sozinha pela trigger
    -- trg_itens_venda_gera_movimentacao (migration 0003)
  end loop;

  return v_venda_id;
end;
$$ language plpgsql;
