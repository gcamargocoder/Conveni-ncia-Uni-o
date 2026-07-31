-- =========================================================
-- 0007_dashboard.sql
-- Consultas agregadas do dashboard, feitas no banco por serem
-- mais rápidas aqui do que somando no JavaScript a cada acesso.
-- =========================================================

create view resumo_vendas_hoje as
select
  count(*) as quantidade_vendas,
  coalesce(sum(total), 0) as faturamento
from vendas
where cancelada = false
  and created_at >= date_trunc('day', now())
  and created_at < date_trunc('day', now()) + interval '1 day';

create or replace function produtos_mais_vendidos(p_dias int default 30, p_limite int default 5)
returns table (produto_id uuid, nome text, quantidade_total numeric) as $$
  select
    p.id as produto_id,
    p.nome,
    sum(iv.quantidade) as quantidade_total
  from itens_venda iv
  join vendas v on v.id = iv.venda_id
  join produtos p on p.id = iv.produto_id
  where v.cancelada = false
    and v.created_at >= now() - (p_dias || ' days')::interval
  group by p.id, p.nome
  order by quantidade_total desc
  limit p_limite;
$$ language sql stable;
