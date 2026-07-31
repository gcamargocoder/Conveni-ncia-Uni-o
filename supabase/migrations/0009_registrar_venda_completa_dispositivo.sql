-- =========================================================
-- 0009_registrar_venda_completa_dispositivo.sql
-- Atualiza a função da Etapa 6 para aceitar e gravar o
-- dispositivo capturado automaticamente (Etapa 11).
-- =========================================================

create or replace function registrar_venda_completa(
  p_funcionario_id uuid,
  p_forma_pagamento text,
  p_total numeric,
  p_itens jsonb,
  p_dispositivo text default null
) returns uuid as $$
declare
  v_venda_id uuid;
  v_item jsonb;
begin
  insert into vendas (funcionario_id, forma_pagamento, total, dispositivo)
  values (p_funcionario_id, p_forma_pagamento, p_total, p_dispositivo)
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

  -- Propaga o dispositivo para as movimentações de estoque geradas
  -- automaticamente por esta venda (trigger da migration 0003).
  update movimentacoes_estoque
  set dispositivo = p_dispositivo
  where venda_id = v_venda_id;

  return v_venda_id;
end;
$$ language plpgsql;
