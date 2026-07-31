-- =========================================================
-- 0013_estoque_abaixo_minimo.sql
-- Correção de auditoria: comparar duas colunas da mesma linha
-- (quantidade_atual < estoque_minimo) não é possível com o filtro
-- simples do PostgREST usado pelo cliente JS (.lt() compara só com
-- um valor fixo). Resolvendo com uma coluna já calculada na view,
-- para o filtro poder ser feito no banco com um simples .eq(true).
-- =========================================================

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
  ), 0) as quantidade_atual,
  coalesce(sum(
    case
      when m.tipo in ('entrada', 'inventario', 'ajuste_entrada') then m.quantidade
      when m.tipo in ('venda', 'perda', 'consumo_interno', 'ajuste_saida') then -m.quantidade
      else 0
    end
  ), 0) < p.estoque_minimo as abaixo_do_minimo
from produtos p
left join movimentacoes_estoque m on m.produto_id = p.id
where p.deleted_at is null
group by p.id, p.nome, p.estoque_minimo;
