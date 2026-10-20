-- "Fotografia" SOMENTE LEITURA do banco, para comparar PRODUÇÃO × RESTAURAÇÃO linha a linha com `diff`.
-- Só SELECT, numa transação REPEATABLE READ READ ONLY (visão única e consistente de todas as tabelas).
-- Não imprime dados de clientes: só contagem + hash (md5) por tabela e nomes/definições de objetos.
-- Passo a passo: PRE_PUBLICACAO_RAILWAY.md §2.0–2.3. Rode contra os dois bancos e compare as saídas.
--
-- Saída determinística: sem hora, sem OID, sem nome de usuário. Duas fotografias iguais = bancos iguais
-- nos itens abaixo (a coluna é comparada pelo texto da linha, não pela ordem física).

\pset format unaligned
\pset tuples_only on
\pset footer off
begin transaction isolation level repeatable read read only;

select '## migrations';
select case when to_regclass('public._prisma_migrations') is null then '(sem histórico de migrations)'
  else (xpath('/row/t/text()', query_to_xml($q$select coalesce(string_agg(migration_name || ' concluida=' || (finished_at is not null) || ' revertida=' || (rolled_back_at is not null) || ' checksum=' || checksum, ' ; ' order by migration_name), '') as t from public._prisma_migrations$q$, false, true, '')))[1]::text end;

select '## tabelas (linhas / md5 do conteúdo)';
select c.relname || ' | ' ||
       (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', c.relname), false, true, '')))[1]::text || ' | ' ||
       (xpath('/row/h/text()', query_to_xml(format('select md5(coalesce(string_agg(x::text, %L order by x::text), %L)) as h from public.%I x', '|', '', c.relname), false, true, '')))[1]::text
from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') order by c.relname;

select '## colunas';
select table_name || '.' || column_name || ' ' || data_type || ' null=' || is_nullable || ' default=' || coalesce(column_default, '-')
from information_schema.columns where table_schema = 'public' order by table_name, column_name;

select '## gatilhos (nome / estado / definição)';
select tgrelid::regclass || '.' || tgname || ' | ' || tgenabled::text || ' | ' || pg_get_triggerdef(oid)
from pg_trigger where not tgisinternal order by 1;

select '## funções (md5 do corpo)';
select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') | ' || md5(p.prosrc)
from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1;

select '## views (md5 da definição)';
select viewname || ' | ' || md5(definition) from pg_views where schemaname = 'public' order by 1;

select '## índices';
select indexdef from pg_indexes where schemaname = 'public' order by indexname;

select '## constraints';
select conrelid::regclass || '.' || conname || ' | ' || pg_get_constraintdef(oid)
from pg_constraint where connamespace = 'public'::regnamespace order by 1;

select '## extensões';
select extname from pg_extension where extname in ('pgcrypto', 'pg_trgm') order by 1;

select '## sequências';
select sequencename from pg_sequences where schemaname = 'public' order by 1;

commit;
