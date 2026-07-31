-- =========================================================
-- 0003_vendas_estoque.sql
-- Vendas, itens de venda e movimentações de estoque
-- =========================================================

create table vendas (
  id uuid primary key default gen_random_uuid(),
  funcionario_id uuid not null references funcionarios(id),
  forma_pagamento text not null check (forma_pagamento in ('dinheiro', 'debito', 'credito', 'pix')),
  total numeric(10,2) not null default 0,
  cancelada boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table itens_venda (
  id uuid primary key default gen_random_uuid(),
  venda_id uuid not null references vendas(id),
  produto_id uuid not null references produtos(id),
  quantidade numeric(10,3) not null check (quantidade > 0),
  -- preço é copiado no momento da venda: se o preço do produto mudar depois,
  -- o histórico da venda antiga não pode mudar junto.
  preco_unitario numeric(10,2) not null,
  created_at timestamptz not null default now()
);

create table movimentacoes_estoque (
  id uuid primary key default gen_random_uuid(),
  produto_id uuid not null references produtos(id),
  tipo text not null check (tipo in ('entrada', 'venda', 'perda', 'ajuste', 'inventario', 'consumo_interno')),
  quantidade numeric(10,3) not null check (quantidade > 0), -- sempre positiva; o tipo define se soma ou subtrai
  funcionario_id uuid not null references funcionarios(id),
  observacao text,
  venda_id uuid references vendas(id), -- preenchido só quando tipo = 'venda'
  created_at timestamptz not null default now()
  -- sem updated_at/deleted_at de propósito: movimentação de estoque é
  -- um fato histórico e nunca deve ser editada ou apagada. Um erro se
  -- corrige com uma nova movimentação do tipo 'ajuste', não editando a antiga.
);

create trigger trg_vendas_updated_at before update on vendas
  for each row execute function set_updated_at();

-- =========================================================
-- Trigger: toda venda de um item gera automaticamente sua
-- movimentação de estoque. Ninguém precisa lembrar de fazer
-- isso manualmente em nenhuma tela — o banco garante.
-- =========================================================
create or replace function gerar_movimentacao_venda()
returns trigger as $$
begin
  insert into movimentacoes_estoque (produto_id, tipo, quantidade, funcionario_id, venda_id)
  select new.produto_id, 'venda', new.quantidade, v.funcionario_id, new.venda_id
  from vendas v
  where v.id = new.venda_id;
  return new;
end;
$$ language plpgsql;

create trigger trg_itens_venda_gera_movimentacao
  after insert on itens_venda
  for each row execute function gerar_movimentacao_venda();

-- índices para os relatórios e para o dashboard não ficarem lentos
create index idx_movimentacoes_produto on movimentacoes_estoque(produto_id);
create index idx_movimentacoes_created_at on movimentacoes_estoque(created_at);
create index idx_vendas_created_at on vendas(created_at);
create index idx_itens_venda_venda on itens_venda(venda_id);
