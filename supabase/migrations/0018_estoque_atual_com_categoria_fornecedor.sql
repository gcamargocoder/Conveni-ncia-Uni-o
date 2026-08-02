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
  ), 0) < p.estoque_minimo as abaixo_do_minimo,
  p.codigo_barras,
  c.nome as categoria_nome,
  f.nome as fornecedor_nome
from produtos p
left join categorias c on c.id = p.categoria_id
left join fornecedores f on f.id = p.fornecedor_id
left join movimentacoes_estoque m on m.produto_id = p.id
where p.deleted_at is null
group by p.id, p.nome, p.estoque_minimo, p.codigo_barras, c.nome, f.nome;