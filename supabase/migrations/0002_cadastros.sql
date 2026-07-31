-- =========================================================
-- 0002_cadastros.sql
-- Tabelas de cadastro básico
-- =========================================================

create table categorias (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table fornecedores (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  telefone text,
  cnpj_cpf text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- cargo controlado por CHECK: evita valor inválido vindo de qualquer lugar
create table funcionarios (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  cargo text not null check (cargo in ('proprietario', 'gerente', 'caixa', 'estoquista')),
  pin_hash text not null, -- PIN nunca em texto puro (hash gerado na aplicação)
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table produtos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  categoria_id uuid not null references categorias(id),
  fornecedor_id uuid references fornecedores(id),
  codigo_barras text,
  preco_venda numeric(10,2) not null check (preco_venda >= 0),
  preco_custo numeric(10,2) not null default 0 check (preco_custo >= 0),
  estoque_minimo numeric(10,3) not null default 0,
  unidade text not null default 'un' check (unidade in ('un', 'kg', 'l')),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- índice para leitura rápida do código de barras no PDV (operação mais frequente do sistema)
create unique index idx_produtos_codigo_barras
  on produtos (codigo_barras)
  where codigo_barras is not null and deleted_at is null;

create index idx_produtos_categoria on produtos(categoria_id) where deleted_at is null;

-- triggers de updated_at
create trigger trg_categorias_updated_at before update on categorias
  for each row execute function set_updated_at();
create trigger trg_fornecedores_updated_at before update on fornecedores
  for each row execute function set_updated_at();
create trigger trg_funcionarios_updated_at before update on funcionarios
  for each row execute function set_updated_at();
create trigger trg_produtos_updated_at before update on produtos
  for each row execute function set_updated_at();
