-- =========================================================
-- 0010_seguranca_rls.sql
-- CRÍTICO: sem isso, a chave pública (NEXT_PUBLIC_SUPABASE_ANON_KEY),
-- que fica embutida no JavaScript do navegador, permite consultar e
-- alterar QUALQUER tabela diretamente pela API do Supabase — ignorando
-- PIN, permissões e todas as regras de negócio deste sistema.
--
-- Solução: habilitar RLS em toda tabela, sem nenhuma policy para as
-- roles públicas (anon/authenticated). Isso bloqueia 100% do acesso
-- direto do navegador. O servidor Next.js passa a usar a chave
-- "service_role" (secreta, nunca exposta ao navegador), que ignora
-- RLS — e é o único caminho de acesso ao banco, exatamente como já
-- era a intenção da arquitetura em camadas.
-- =========================================================

alter table categorias enable row level security;
alter table fornecedores enable row level security;
alter table funcionarios enable row level security;
alter table produtos enable row level security;
alter table vendas enable row level security;
alter table itens_venda enable row level security;
alter table movimentacoes_estoque enable row level security;

-- Nenhuma "create policy" de propósito: nenhuma policy = nenhum
-- acesso para anon/authenticated. Só service_role (usado pelo
-- servidor) continua acessando, pois RLS não se aplica a ele.
