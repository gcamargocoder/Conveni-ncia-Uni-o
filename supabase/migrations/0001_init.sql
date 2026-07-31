-- =========================================================
-- 0001_init.sql
-- Extensões e função utilitária de updated_at automático
-- =========================================================

create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- Toda tabela usa essa função para manter updated_at sempre correto,
-- sem depender de o código da aplicação lembrar de setá-lo.
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;
