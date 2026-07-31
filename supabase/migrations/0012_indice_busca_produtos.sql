-- =========================================================
-- 0012_indice_busca_produtos.sql
-- A busca do PDV usa ILIKE '%termo%' (Etapa de auditoria —
-- services/produtos.service.ts). Um índice B-tree comum não
-- acelera esse tipo de busca (padrão com curinga no início).
-- pg_trgm permite índice GIN que acelera ILIKE mesmo com % nas
-- duas pontas — essencial para a busca continuar rápida com
-- um catálogo de milhares de produtos.
-- =========================================================

create extension if not exists pg_trgm;

create index idx_produtos_nome_trgm on produtos using gin (nome gin_trgm_ops);
