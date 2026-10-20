-- Diagnóstico SOMENTE LEITURA do banco (para descobrir o estado de migrations ANTES de publicar).
-- Só tem SELECT (e um bloco DO que apenas lê). Execute SEMPRE com a sessão em modo somente leitura, assim o
-- servidor recusa qualquer escrita. Passo a passo sem expor a URL: PRE_PUBLICACAO_RAILWAY.md §2.0.
--
-- Não imprime dados de clientes: só contagens e nomes de objetos.

\echo '== 1. Servidor e permissões'
select version();
select 'usuario atual: ' || current_user
    || ' | superusuario=' || (select rolsuper::text from pg_roles where rolname = current_user)
    || ' | CREATE no banco=' || has_database_privilege(current_user, current_database(), 'CREATE')::text;
select 'pgcrypto/pg_trgm instaladas: ' || coalesce(string_agg(extname, ', ' order by extname), '(nenhuma)') from pg_extension where extname in ('pgcrypto', 'pg_trgm');
select 'extensões disponíveis p/ a init: ' || coalesce(string_agg(name || ' (trusted=' || coalesce(to_jsonb(v)->>'trusted', '?') || ')', ', ' order by name), '(nenhuma!)')
from (select distinct on (name) * from pg_available_extension_versions where name in ('pgcrypto', 'pg_trgm') order by name, version desc) v;

\echo '== 2. Histórico de migrations (_prisma_migrations) — saída em NOTICE'
DO $$
DECLARE r record;
BEGIN
  IF to_regclass('public._prisma_migrations') IS NULL THEN
    RAISE NOTICE 'AUSENTE: o banco não tem histórico do Prisma (se também tiver tabelas de negócio, o deploy falha com P3005 — ver item 5, caso B)';
  ELSE
    FOR r IN EXECUTE 'select migration_name, (finished_at is not null) as ok, (rolled_back_at is not null) as rev from public._prisma_migrations order by 1' LOOP
      RAISE NOTICE '% | concluida=% | revertida=%', r.migration_name, r.ok, r.rev;
    END LOOP;
  END IF;
END $$;

\echo '== 3. Tabelas e objetos esperados'
select t.nome as objeto,
       case when to_regclass('public.' || t.nome) is null then 'AUSENTE' else 'presente' end as situacao
from (values ('categorias'),('fornecedores'),('funcionarios'),('clientes'),('produtos'),('vendas'),('itens_venda'),
             ('movimentacoes_estoque'),('contas_receber'),('recebimentos'),('estoque_atual'),
             ('usuarios'),('sessoes'),('tokens_recuperacao'),('limites_tentativa'),('tentativas_pin'),
             ('vendas_revisao'),('ativacoes_iniciais')) as t(nome)
order by 1;
select 'gatilho usuarios_conta_unica: ' || case when exists (select 1 from pg_trigger where tgname = 'usuarios_conta_unica') then 'presente' else 'ausente' end;
select 'coluna vendas.usuario_id: ' || case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='vendas' and column_name='usuario_id') then 'presente' else 'ausente' end;

\echo '== 4. Quantidade de linhas (só contagens)'
select t.nome as tabela,
       case when to_regclass('public.' || t.nome) is null then '(ausente)'
            else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.' || quote_ident(t.nome), false, true, '')))[1]::text end as linhas
from (values ('categorias'),('funcionarios'),('clientes'),('produtos'),('vendas'),('itens_venda'),
             ('movimentacoes_estoque'),('contas_receber'),('recebimentos'),('usuarios'),('vendas_revisao')) as t(nome)
order by 1;

\echo '== 5. CLASSIFICAÇÃO (A–E) — calculada, não interpretada à mão'
with est as (
  select
    to_regclass('public._prisma_migrations') is not null as tem_hist,
    -- "núcleo da init": as 11 tabelas da migration init + a view estoque_atual
    (select count(*) from (values ('categorias'),('fornecedores'),('funcionarios'),('clientes'),('produtos'),('vendas'),
        ('itens_venda'),('movimentacoes_estoque'),('contas_receber'),('recebimentos'),('tentativas_pin'),('estoque_atual')) n(nome)
      where to_regclass('public.' || n.nome) is not null) as nucleo_presente,
    -- objetos criados por migrations POSTERIORES à init
    (select count(*) from (values ('usuarios'),('sessoes'),('tokens_recuperacao'),('limites_tentativa'),('vendas_revisao'),('ativacoes_iniciais')) n(nome)
      where to_regclass('public.' || n.nome) is not null)
      + (select count(*) from information_schema.columns where table_schema='public' and table_name='vendas' and column_name='usuario_id') as posteriores_presentes,
    case when to_regclass('public._prisma_migrations') is null then 0
         else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public._prisma_migrations where finished_at is null or rolled_back_at is not null', false, true, '')))[1]::text::int end as problematicas,
    case when to_regclass('public._prisma_migrations') is null then 0
         else (xpath('/row/c/text()', query_to_xml($q$select count(*) as c from public._prisma_migrations where migration_name not in
              ('20260101000000_init','20260102000000_autenticacao','20260103000000_integridade_vendas_pdv','20260104000000_ativacao_inicial','20260105000000_conta_unica_gatilho')$q$, false, true, '')))[1]::text::int end as desconhecidas,
    case when to_regclass('public._prisma_migrations') is null then 0
         else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public._prisma_migrations where finished_at is not null and rolled_back_at is null', false, true, '')))[1]::text::int end as concluidas
)
select case
  when problematicas > 0 then 'CASO D — alguma migration NÃO concluída ou revertida. PARE. Não rode deploy nem "resolve".'
  when not tem_hist and nucleo_presente = 0 and posteriores_presentes = 0 then 'CASO A — banco vazio, sem histórico. O deploy aplica as 5 migrations do zero.'
  when not tem_hist and nucleo_presente = 12 and posteriores_presentes = 0 then 'CASO B — tabelas da init SEM histórico. O deploy falharia com P3005. Nada é alterado sozinho: exige backup validado + confirmação explícita antes do baseline.'
  when not tem_hist then 'CASO E — banco sem histórico com objetos parciais/inesperados (núcleo ' || nucleo_presente || '/12, posteriores ' || posteriores_presentes || '). PARE: não foi criado pela init; compare antes de qualquer migration.'
  when desconhecidas > 0 then 'CASO E — o histórico contém ' || desconhecidas || ' migration(s) que este código não conhece. PARE e compare.'
  when nucleo_presente < 12 then 'CASO E — há histórico, mas faltam objetos da init (núcleo ' || nucleo_presente || '/12). PARE e compare.'
  else 'CASO C — histórico íntegro (' || concluidas || ' de 5 concluídas). O deploy aplica só as que faltam (' || (5 - concluidas) || ').'
end as classificacao
from est;

\echo '== 6. O que fazer em cada caso (nenhum caso autoriza escrita automática)'
\echo 'A) Vazio                -> backup opcional (nada a perder); deploy aplica tudo.'
\echo 'B) Tabelas sem histórico -> PARAR. Só com dump validado (restaurado e comparado) E sua confirmação explícita: baseline = prisma migrate resolve --applied 20260101000000_init; depois deploy.'
\echo 'C) Histórico íntegro    -> dump validado; deploy aplica as pendentes.'
\echo 'D) Migration falha/revertida -> PARAR; investigar a causa; não forçar deploy nem resolve.'
\echo 'E) Divergente/parcial   -> PARAR; trazer esta saída (sem credenciais) para revisão.'
