/**
 * Ensaio COMPLETO de backup e restauração, só em Postgres DESCARTÁVEL local (Docker). Nunca toca em produção.
 *
 *   node scripts/validar-backup-restore.mjs [--container conveniencia-pg-teste] [--porta 55432]
 *
 * O que faz (o mesmo procedimento de PRE_PUBLICACAO_RAILWAY.md §2, contra bancos de teste):
 *  1. cria o banco de origem `bkp_origem_test`, aplica as migrations (`prisma migrate deploy`) e semeia dados
 *     representativos (negócio + conta + sessão);
 *  2. faz o backup com `docker run postgres:16 pg_dump --format=custom` (o mesmo comando da produção);
 *  3. confere o arquivo (`pg_restore --list`);
 *  4. restaura num banco NOVO e vazio `bkp_restore_test` com `pg_restore`;
 *  5. compara origem × restauração: contagem e hash do conteúdo de TODAS as tabelas, e também gatilhos, funções,
 *     views, índices, constraints, extensões e o histórico de migrations; roda `prisma migrate status`;
 *     e prova que gatilhos/views funcionam depois de restaurar (uma venda de teste baixa o estoque);
 *  6. controle negativo: altera uma linha na restauração e exige que a comparação acuse a diferença;
 *  7. remove SOMENTE os dois bancos e o arquivo que ele mesmo criou.
 *
 * Segurança: só aceita bancos cujo nome termina em `_test`; a senha do container é lida do ambiente do próprio
 * container e nunca é impressa.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

const arg = (nome, padrao) => {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : padrao;
};
const CONTAINER = arg("container", "conveniencia-pg-teste");
const PORTA = arg("porta", "55432");
const ORIGEM = "bkp_origem_test";
const RESTAURADO = "bkp_restore_test";
const IMAGEM = arg("imagem", "postgres:16");

for (const nome of [ORIGEM, RESTAURADO]) {
  if (!nome.endsWith("_test")) throw new Error(`Recusado: banco "${nome}" não termina em _test.`);
}

const run = (cmd, args, opcoes = {}) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], ...opcoes });
const SENHA = run("docker", ["exec", CONTAINER, "printenv", "POSTGRES_PASSWORD"]).trim();
const urlLocal = (db) => `postgresql://postgres:${SENHA}@localhost:${PORTA}/${db}`;
const urlDocker = (db) => `postgresql://postgres:${SENHA}@host.docker.internal:${PORTA}/${db}`;
const psql = (db, sql, entrada) => run("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1", "-qAt", ...(sql ? ["-c", sql] : [])], entrada ? { input: entrada } : {});
const admin = (sql) => run("docker", ["exec", CONTAINER, "psql", "-U", "postgres", "-qAt", "-c", sql]);
const prisma = (args, db) => run(process.platform === "win32" ? "npx.cmd" : "npx", ["prisma", ...args], { env: { ...process.env, DATABASE_URL: urlLocal(db) }, shell: process.platform === "win32" });

let falhas = 0;
const ok = (condicao, mensagem) => {
  console.log(`${condicao ? "PASS" : "FAIL"}  ${mensagem}`);
  if (!condicao) falhas++;
};

const pasta = mkdtempSync(path.join(tmpdir(), "backup-ensaio-"));
const ARQUIVO = "ensaio.dump";

try {
  // ---------------------------------------------------------------- 1. origem
  for (const db of [ORIGEM, RESTAURADO]) admin(`DROP DATABASE IF EXISTS ${db}`);
  admin(`CREATE DATABASE ${ORIGEM}`);
  const aplicadas = prisma(["migrate", "deploy"], ORIGEM);
  ok(/All migrations have been successfully applied/.test(aplicadas), "origem: migrations aplicadas num banco novo");

  psql(
    ORIGEM,
    null,
    `
INSERT INTO categorias(id,nome) VALUES ('11111111-1111-4111-8111-111111111111','Bebidas');
INSERT INTO funcionarios(id,nome,cargo,pin_hash) VALUES ('22222222-2222-4222-8222-222222222222','Gil','proprietario','$2a$10$hashfalsohashfalsohashfalso');
INSERT INTO clientes(id,nome,telefone) VALUES ('33333333-3333-4333-8333-333333333333','Cliente Fiado','11999990000');
INSERT INTO produtos(id,nome,categoria_id,preco_venda,preco_custo,codigo_barras) VALUES ('44444444-4444-4444-8444-444444444444','Água 500ml','11111111-1111-4111-8111-111111111111',10.50,4,'7891234567890');
INSERT INTO movimentacoes_estoque(produto_id,tipo,quantidade,funcionario_id) VALUES ('44444444-4444-4444-8444-444444444444','entrada',100.5,'22222222-2222-4222-8222-222222222222');
INSERT INTO vendas(id,funcionario_id,cliente_id,forma_pagamento,total) VALUES ('55555555-5555-4555-8555-555555555555','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','fiado',21);
INSERT INTO itens_venda(venda_id,produto_id,quantidade,preco_unitario) VALUES ('55555555-5555-4555-8555-555555555555','44444444-4444-4444-8444-444444444444',2,10.50);
INSERT INTO usuarios(id,email,nome,senha_hash,papel) VALUES ('66666666-6666-4666-8666-666666666666','dona@loja.com','Dona','$argon2id$v=19$m=19456,t=2,p=1$falso$falso','admin');
INSERT INTO sessoes(usuario_id,token_hash,expira_em,expira_absoluta_em) VALUES ('66666666-6666-4666-8666-666666666666','hash-de-sessao-ensaio', now()+interval '1 hour', now()+interval '1 day');
INSERT INTO limites_tentativa(chave,falhas) VALUES ('login:ip:203.0.113.1', 2);
`
  );

  const tabelas = psql(ORIGEM, "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1").trim().split("\n");
  ok(tabelas.length >= 18, `origem: ${tabelas.length} tabelas`);

  // ---------------------------------------------------------------- 2. backup (mesmo comando da produção)
  run("docker", [
    "run", "--rm", "--add-host=host.docker.internal:host-gateway", "-v", `${pasta}:/backup`, IMAGEM,
    "pg_dump", urlDocker(ORIGEM), "--format=custom", "--no-owner", "--no-privileges", "-f", `/backup/${ARQUIVO}`,
  ]);
  const tamanho = statSync(path.join(pasta, ARQUIVO)).size;
  ok(tamanho > 10_000, `backup: arquivo gerado (${tamanho} bytes)`);

  // ---------------------------------------------------------------- 3. listagem
  const lista = run("docker", ["run", "--rm", "-v", `${pasta}:/backup`, IMAGEM, "pg_restore", "--list", `/backup/${ARQUIVO}`]);
  for (const t of ["vendas", "itens_venda", "produtos", "movimentacoes_estoque", "contas_receber", "funcionarios", "clientes", "usuarios", "_prisma_migrations"]) {
    ok(new RegExp(`TABLE DATA public ${t} `).test(lista), `pg_restore --list contém os dados de ${t}`);
  }
  ok(/FUNCTION public usuarios_conta_unica/.test(lista) && /TRIGGER public usuarios usuarios_conta_unica/.test(lista), "pg_restore --list contém a função e o gatilho de conta única");
  ok(/VIEW public estoque_atual/.test(lista), "pg_restore --list contém a view estoque_atual");

  // ---------------------------------------------------------------- 4. restauração num banco NOVO e vazio
  admin(`CREATE DATABASE ${RESTAURADO}`);
  run("docker", [
    "run", "--rm", "--add-host=host.docker.internal:host-gateway", "-v", `${pasta}:/backup`, IMAGEM,
    "pg_restore", "--no-owner", "--exit-on-error", "-d", urlDocker(RESTAURADO), `/backup/${ARQUIVO}`,
  ]);
  ok(true, "restauração: pg_restore terminou sem erro (--exit-on-error)");

  // ---------------------------------------------------------------- 5. comparação
  const fotografia = (db) => {
    const saida = {};
    for (const t of tabelas) {
      saida[`tabela:${t}`] = psql(db, `select count(*)||' / '||md5(coalesce(string_agg(x::text,'|' order by x::text),'')) from "${t}" x`).trim();
    }
    const consultas = {
      gatilhos: "select tgrelid::regclass||'.'||tgname||':'||tgenabled::text from pg_trigger where not tgisinternal order by 1",
      funcoes: "select proname||'/'||md5(prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where nspname='public' order by 1",
      views: "select viewname||'/'||md5(definition) from pg_views where schemaname='public' order by 1",
      indices: "select indexdef from pg_indexes where schemaname='public' order by 1",
      constraints: "select conrelid::regclass||'.'||conname||'/'||pg_get_constraintdef(oid) from pg_constraint where connamespace='public'::regnamespace order by 1",
      extensoes: "select extname from pg_extension where extname in ('pgcrypto','pg_trgm') order by 1",
      migracoes: "select migration_name||':'||(finished_at is not null) from _prisma_migrations order by 1",
    };
    for (const [nome, sql] of Object.entries(consultas)) saida[nome] = psql(db, sql).trim();
    return saida;
  };
  const diferencas = (a, b) => Object.keys(a).filter((k) => a[k] !== b[k]);

  const antes = fotografia(ORIGEM);
  const depois = fotografia(RESTAURADO);
  const dif = diferencas(antes, depois);
  ok(dif.length === 0, `comparação: ${Object.keys(antes).length} itens idênticos entre origem e restauração${dif.length ? " — DIFERENTES: " + dif.join(", ") : ""}`);
  ok(/^1 \//.test(antes["tabela:vendas"]) && /^1 \//.test(antes["tabela:usuarios"]), "comparação: os dados semeados estão presentes (não é uma comparação de tabelas vazias)");
  ok(/5 /.test(String(antes.migracoes.split("\n").length)) || antes.migracoes.split("\n").length === 5, "comparação: as 5 migrations constam como concluídas");

  const status = prisma(["migrate", "status"], RESTAURADO);
  ok(/Database schema is up to date/.test(status), "restaurado: `prisma migrate status` = banco em dia (nenhuma migration pendente)");

  // objetos funcionando depois da restauração
  psql(RESTAURADO, null, `
INSERT INTO vendas(id,funcionario_id,forma_pagamento,total) VALUES ('77777777-7777-4777-8777-777777777777','22222222-2222-4222-8222-222222222222','pix',10.50);
INSERT INTO itens_venda(venda_id,produto_id,quantidade,preco_unitario) VALUES ('77777777-7777-4777-8777-777777777777','44444444-4444-4444-8444-444444444444',1,10.50);
`);
  const estoque = psql(RESTAURADO, "select quantidade_atual from estoque_atual where produto_id='44444444-4444-4444-8444-444444444444'").trim();
  ok(Number(estoque) === 100.5 - 2 - 1, `restaurado: gatilho de venda e view de estoque funcionam (100,5 − 2 − 1 = ${estoque})`);
  let bloqueou = false;
  try {
    psql(RESTAURADO, "delete from usuarios where false; truncate sessoes; insert into usuarios(email,nome,senha_hash,papel) values ('outra@loja.com','O','x','operador')");
  } catch (e) {
    bloqueou = /Conta única/.test(String(e.stderr ?? e.message));
  }
  ok(bloqueou, "restaurado: o gatilho de conta única continua barrando uma 2ª conta");

  // ---------------------------------------------------------------- 6. controle negativo
  psql(RESTAURADO, "update produtos set preco_venda = 99.99 where id='44444444-4444-4444-8444-444444444444'");
  const adulterado = diferencas(antes, fotografia(RESTAURADO));
  ok(adulterado.includes("tabela:produtos"), "controle negativo: a comparação ACUSA uma linha alterada (a verificação não é cega)");
} catch (e) {
  falhas++;
  console.log("ERRO:", String(e.stderr ?? e.message).split("\n").slice(0, 6).join(" | "));
} finally {
  for (const db of [ORIGEM, RESTAURADO]) {
    try {
      if (db.endsWith("_test")) admin(`DROP DATABASE IF EXISTS ${db}`);
    } catch {
      /* melhor esforço */
    }
  }
  rmSync(pasta, { recursive: true, force: true });
}

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nBACKUP E RESTAURAÇÃO VALIDADOS (ambiente descartável)");
process.exit(falhas ? 1 : 0);
