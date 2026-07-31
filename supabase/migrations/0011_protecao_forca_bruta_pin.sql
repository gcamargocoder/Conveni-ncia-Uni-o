-- =========================================================
-- 0011_protecao_forca_bruta_pin.sql
-- PIN de 4 dígitos = só 10.000 combinações possíveis. Sem limite
-- de tentativas, um script poderia testar todas em minutos.
-- Solução: rastrear tentativas por origem (IP) e bloquear
-- temporariamente após muitas falhas seguidas.
-- =========================================================

create table tentativas_pin (
  identificador text primary key, -- IP de origem
  tentativas_falhas int not null default 0,
  bloqueado_ate timestamptz,
  updated_at timestamptz not null default now()
);
