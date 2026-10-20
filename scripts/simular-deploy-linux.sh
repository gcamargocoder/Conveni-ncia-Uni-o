#!/usr/bin/env bash
# Simula o deploy do Railway num container Linux (node:22-slim) contra um Postgres DESCARTÁVEL local.
# Nunca toca em produção. Requer Docker e o container de ensaio com Postgres (padrão: conveniencia-pg-teste, porta 55432).
#
#   bash scripts/simular-deploy-linux.sh [container-postgres]
#
# O que reproduz: SÓ os arquivos que um `git add -A` incluiria (sem .env.local, node_modules, .next) -> `npm ci` ->
# `npm run build` -> `npm prune --omit=dev` (como os builders de produção) -> `npm start` (prisma migrate deploy && next start)
# em 3 cenários de banco: novo, já migrado (reinício) e com tabelas porém SEM histórico de migrations (P3005 + baseline).
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
export MSYS_NO_PATHCONV=1
C=${1:-conveniencia-pg-teste}
PW=$(docker exec "$C" printenv POSTGRES_PASSWORD) || exit 1
novo() { docker exec "$C" psql -U postgres -qAt -c "DROP DATABASE IF EXISTS $1" >/dev/null 2>&1; docker exec "$C" psql -U postgres -qAt -c "CREATE DATABASE $1" >/dev/null; }
novo sim_novo_test; novo sim_semhist_test
docker exec -i "$C" psql -U postgres -d sim_semhist_test -qAt < prisma/migrations/20260101000000_init/migration.sql >/dev/null 2>&1
docker exec "$C" psql -U postgres -d sim_semhist_test -qAt -c "insert into categorias(nome) values ('Bebidas')" >/dev/null
U() { echo "postgresql://postgres:$PW@host.docker.internal:55432/$1"; }
echo "arquivos no pacote (o que um 'git add -A' incluiria): $(git ls-files --cached --others --exclude-standard | wc -l)"
git ls-files -z --cached --others --exclude-standard | tar --null -T - -cf - | \
docker run --rm -i --add-host=host.docker.internal:host-gateway -e URL_NOVO="$(U sim_novo_test)" -e URL_SEMHIST="$(U sim_semhist_test)" -w /app node:22-slim bash -c '
mkdir -p /app && tar -xf - -C /app
ls .env* 2>/dev/null | grep -v example && echo "ATENÇÃO: .env no pacote" || echo "pacote sem .env.local (ok)"
apt-get update -qq >/dev/null 2>&1; apt-get install -y -qq openssl ca-certificates >/dev/null 2>&1
echo "node $(node -v) | npm $(npm -v)"
echo "== npm ci"; npm ci 2>&1 | grep -E "^added|ERR|error"
echo "== npm run build"; DATABASE_URL="postgresql://u:p@localhost:5432/x" npm run build > /tmp/build.log 2>&1; echo "exit_build=$?"; grep -E "Compiled|Failed|error TS|Type error" /tmp/build.log | head -3
echo "== npm prune --omit=dev"; npm prune --omit=dev 2>&1 | grep -E "^removed|up to date|ERR"
ls node_modules/.bin/prisma >/dev/null 2>&1 && echo "CLI prisma: PRESENTE" || echo "CLI prisma: AUSENTE"
node -e "const {PrismaClient}=require(\"@prisma/client\"); new PrismaClient(); console.log(\"Prisma Client: carrega e instancia (gerado para linux)\")" 2>&1 | tail -1
iniciar() { (DATABASE_URL="$1" APP_URL="https://exemplo.invalid" PORT=$2 timeout 28 npm start > /tmp/start_$2.log 2>&1 &); sleep 20
  node -e "fetch(\"http://localhost:$2/login\").then(r=>console.log(\"   GET /login ->\",r.status)).catch(()=>console.log(\"   GET /login falhou (app não subiu)\"))"
  grep -E "Applying|No pending|All migrations|Error: P|not found|Ready" /tmp/start_$2.log | sed "s/^/   /" | head -9; sleep 9; }
echo; echo "== CENÁRIO 1: banco NOVO"; iniciar "$URL_NOVO" 3001
echo; echo "== CENÁRIO 2: banco JÁ MIGRADO (reinício do serviço)"; iniciar "$URL_NOVO" 3002
echo; echo "== CENÁRIO 3: banco COM TABELAS e SEM histórico"; iniciar "$URL_SEMHIST" 3003
echo "   -- baseline (marca a init como aplicada; não executa SQL) e novo start:"
DATABASE_URL="$URL_SEMHIST" npx prisma migrate resolve --applied 20260101000000_init 2>&1 | tail -1 | sed "s/^/   /"
iniciar "$URL_SEMHIST" 3004
'
echo; echo "== estado final dos bancos do ensaio (dados preservados no cenário 3):"
for d in sim_novo_test sim_semhist_test; do docker exec "$C" psql -U postgres -d $d -qAt -c "select '$d: migrations='||count(*)||' categorias='||(select count(*) from categorias) from _prisma_migrations where finished_at is not null"; done
for d in sim_novo_test sim_semhist_test; do docker exec "$C" psql -U postgres -qAt -c "DROP DATABASE IF EXISTS $d" >/dev/null 2>&1; done
