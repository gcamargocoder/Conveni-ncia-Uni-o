-- =========================================================
-- 0004_view_estoque_atual.sql
-- Estoque atual = soma das entradas - soma das saídas.
-- Nunca é uma coluna gravada: é sempre calculado a partir do
-- histórico de movimentações, então é impossível ficar "errado".
-- =========================================================

create view estoque_atual as
select
  p.id as produto_id,
  p.nome,
  p.estoque_minimo,
  coalesce(sum(
    case
      when m.tipo in ('entrada', 'inventario') then m.quantidade
      when m.tipo in ('venda', 'perda', 'consumo_interno') then -m.quantidade
      when m.tipo = 'ajuste' then m.quantidade -- ajuste pode ser positivo ou negativo, tratado na aplicação
      else 0
    end
  ), 0) as quantidade_atual
from produtos p
left join movimentacoes_estoque m on m.produto_id = p.id
where p.deleted_at is null
group by p.id, p.nome, p.estoque_minimo;

-- Observação sobre 'ajuste': para ficar correto no cálculo acima,
-- a aplicação deve gravar 'ajuste' já com o sinal certo tratado
-- na regra de negócio (lib/estoque), nunca deixando a tela decidir isso.
-- Vamos resolver esse detalhe quando construirmos lib/estoque na Etapa 3.
