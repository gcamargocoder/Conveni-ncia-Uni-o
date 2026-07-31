-- =========================================================
-- 0005_fix_ajuste.sql
-- Resolve a pendência da Etapa 2: 'ajuste' virava negativo,
-- mas quantidade sempre é positiva no banco. Solução: dois
-- tipos separados, sem exceção na regra "quantidade > 0".
-- =========================================================

alter table movimentacoes_estoque drop constraint movimentacoes_estoque_tipo_check;

alter table movimentacoes_estoque add constraint movimentacoes_estoque_tipo_check
  check (tipo in ('entrada', 'venda', 'perda', 'ajuste_entrada', 'ajuste_saida', 'inventario', 'consumo_interno'));

-- Atualiza a view para refletir os novos tipos
create or replace view estoque_atual as
select
  p.id as produto_id,
  p.nome,
  p.estoque_minimo,
  coalesce(sum(
    case
      when m.tipo in ('entrada', 'inventario', 'ajuste_entrada') then m.quantidade
      when m.tipo in ('venda', 'perda', 'consumo_interno', 'ajuste_saida') then -m.quantidade
      else 0
    end
  ), 0) as quantidade_atual
from produtos p
left join movimentacoes_estoque m on m.produto_id = p.id
where p.deleted_at is null
group by p.id, p.nome, p.estoque_minimo;
