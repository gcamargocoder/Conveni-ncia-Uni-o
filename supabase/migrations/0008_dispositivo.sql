-- =========================================================
-- 0008_dispositivo.sql
-- Adiciona rastreio de equipamento, exigido pelo documento
-- mestre ("registrar operador, data, hora, operação, equipamento").
-- Captura automática (user-agent), sem exigir nada do usuário.
-- =========================================================

alter table vendas add column dispositivo text;
alter table movimentacoes_estoque add column dispositivo text;
