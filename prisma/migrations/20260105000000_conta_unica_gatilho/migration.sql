-- Conta única também no PostgreSQL (migration ADITIVA: só cria uma função e um gatilho).
-- Nenhuma linha existente é lida, alterada ou apagada: contas que já existam continuam como estão
-- (só passa a ser recusada a INSERÇÃO de uma nova conta quando já existe alguma).
-- O lock de aviso usa a mesma chave da ativação inicial da aplicação (7310042), o que serializa
-- inserções simultâneas: a segunda espera a primeira confirmar e então enxerga a linha.
CREATE FUNCTION "usuarios_conta_unica"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(7310042);
  IF EXISTS (SELECT 1 FROM "usuarios") THEN
    RAISE EXCEPTION 'Conta única: já existe uma conta de login' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "usuarios_conta_unica"
BEFORE INSERT ON "usuarios"
FOR EACH ROW EXECUTE FUNCTION "usuarios_conta_unica"();
