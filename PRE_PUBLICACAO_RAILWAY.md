# Pré-publicação da autenticação no Railway

Documento de planejamento. **Nada aqui foi executado contra o ambiente real**: nenhuma migration aplicada, nenhuma conta criada, nenhuma variável alterada, nenhum deploy. Foi feita apenas leitura do código (`AUTENTICACAO.md`, `prisma/schema.prisma`, migration `20260102000000_autenticacao`, `scripts/criar-admin.ts`, `lib/email/enviar.ts`, `services/backup.service.ts`, serviços de sincronização offline).

Convenções: `<PUBLIC_URL>` = `DATABASE_PUBLIC_URL` do plugin Postgres (digite no terminal, não salve em arquivo). `<APP>` = URL pública do app.

---

## 0. Pendências bloqueadoras (resolver antes de publicar)

| # | Pendência | Por quê |
|---|---|---|
| B1 | **Descobrir o estado de migrations do banco de produção** (script pronto e validado: `scripts/diagnostico-banco.sql`; falta rodá-lo em produção). Não sei se ele já tem a tabela `_prisma_migrations` com `20260101000000_init` aplicada. | O `npm start` roda `prisma migrate deploy` sozinho. Se o banco tem tabelas de negócio mas **não** tem histórico (ex.: dados foram restaurados pela tela Backup num banco vazio *depois* de uma migration, ou criados por outro meio), o deploy falha com `P3005`/conflito. Se o banco estiver vazio, o `init` será aplicado inteiro. Só consulta, sem risco: `SELECT migration_name, finished_at FROM _prisma_migrations;` e `\dt`. |
| B2 | **Não existe backup REAL validado do banco de produção** (o procedimento está validado em ensaio: `npm run backup:ensaio`; falta executá-lo contra produção e restaurar esse dump). Neste computador não há `pg_dump`/`psql` (só Docker). | A tela **Backup** do sistema **não serve** como backup de recuperação: exporta só 10 tabelas de negócio em JSON, sem schema, triggers, funções, views, `usuarios` ou `_prisma_migrations`. É útil como cópia extra, não como plano de recuperação. |
| B3 | **O deploy aplica a migration automaticamente no start**, sem etapa de aprovação. | Backup (B2) e verificação (B1) têm que estar prontos *antes* do push que dispara o deploy. |
| B4 | **Provedor de e-mail não configurado/validado** (Resend: conta, domínio verificado, `RESEND_API_KEY`, `EMAIL_FROM`). | Sem isso o admin não recupera senha **nem a ativação inicial (§3.1) funciona**; o sistema não simula envio. Ver §4. |
| B5 | **Servidor confia em `funcionario_id` e preços enviados pela fila offline** (ver §6.3) e **entrega `pin_hash` de todos os funcionários a qualquer sessão**. | Não bloqueia a autenticação em si, mas é a decisão de risco que o dono precisa tomar conscientemente. Proposta separada em §7. |
| B6 | Testes de integração e navegador precisam ser **reexecutados no commit exato** que será publicado, e a verificação pós-deploy da §5 só existe como roteiro (não foi executada em produção). | Evidência exigida na §5. |

Itens que **não** são bloqueadores mas precisam estar cientes: `AUTENTICACAO.md` → "Limites conhecidos"; ausência de CSP; lint não configurado.

---

## 0.1 Estado REAL das verificações (fase de integridade do PDV)

Tudo abaixo foi executado nesta máquina contra um PostgreSQL 16 **descartável em Docker** e o Chrome instalado. Nada de produção, Railway, commit, push ou deploy.

| Verificação | Resultado real |
|---|---|
| `npx tsc --noEmit` | sem erros |
| `npx vitest run` (unitários) | 29 arquivos, 309/309 |
| `npm run test:integracao` (Postgres real) | 2 arquivos, 86/86 |
| `npm run build` | concluído (código de saída 0) |
| Migration `20260103000000_integridade_vendas_pdv` | aplicada **só** no banco de teste; num banco com dados prévios, vendas, itens, movimentações, total e estoque ficaram idênticos |
| Chrome real: IndexedDB **legado v5** com `pin_hash` de todos, migração offline | passou: hashes removidos de todos os funcionários; PIN offline preservado só de caixa e frentista (byte a byte); fila e venda pendente legadas intactas; caixa e frentista vendem offline; gerente e estoquista não; reconexão enviou as 3 vendas sem duplicar, com estoque conferido |
| Chrome real: logout e novo login | logout apaga os PINs offline e preserva a fila; novo login ressincroniza os PINs |
| Chrome real: migração **interrompida** (aba fechada durante o upgrade; atrasos de 0, 15, 40, 90 e 200 ms; 20 mil registros) | nos 5 casos o banco ficou íntegro (v5 intacto, nunca estado misto) e a migração completou ao reabrir |
| Chrome real: IndexedDB mais **novo** que o app | o Dexie abre o banco (cria a tabela que falta, sobe para v7.1), sem erro de JS; venda pendente preservada. Isto **não** é uma falha real da função de upgrade, que não consegui provocar |
| Chrome real: venda offline, preço adulterado, revisão, indicador no menu, logout | passou (20 verificações; 3 rodadas seguidas passaram) |

Evidência: logs em `scratchpad/logs/` da sessão (`migracao-idb-final.log`: 32 PASS, 0 FAIL).

**Ocorrências durante a validação (registradas como aconteceram):**
- Uma execução da migração ficou ~9 min sem saída no cenário S5 e foi encerrada por mim; a **causa não foi identificada**. Uma reexecução isolada de S5/S6 falhou no login: o formulário foi enviado antes de hidratar e o navegador fez GET com e-mail e senha na URL. Isso foi corrigido (`method="post"` nos 4 formulários + teste). Depois da correção, a execução completa passou (S1 a S6).
- Antes dos ajustes da fila, um envio podia ficar preso em "sincronizando" para sempre (aba fechada ou conexão caída). Corrigido: limite de 30 s por envio e recuperação após 60 s (testes unitários e Chrome).

**Ainda NÃO verificado ou dependente de decisão/ação em produção (nada abaixo está concluído):**
- backup, validação e restauração do banco de produção (§2); estado de `_prisma_migrations` em produção (B1);
- aplicar as migrations em produção; criar o primeiro administrador real;
- e-mail real (Resend), variáveis do Railway, recuperação de senha em produção;
- roteiro pós-deploy (§5.2) em produção;
- aparelhos reais (Android/iOS, PWA instalado, service worker em produção); só Chrome desktop headless foi usado. O service worker `v4` (sem cache de dados privados e com HTML neutro, ver `AUTENTICACAO.md`) foi validado só nele: após o deploy, conferir `caches.keys()` sem `-v2`/`-v3`, que o HTML guardado em `/pdv` não contém nome/e-mail (DevTools → Application → Cache Storage) e o PDV offline num aparelho real, além da tela `/offline.html` (desconectar a rede e abrir uma rota qualquer fora do PDV);
- indicador de revisão em dois aparelhos de administrador (a contagem atualiza em até 60 s; só um aparelho foi testado);
- latência de entrega de uma venda offline após reconectar: não medida de forma controlada (depende do limite de 30 s, do intervalo de 15 s do worker e do *backoff*);
- causa do travamento isolado em S5 (acima);
- decisões do dono: gerente/proprietário sem venda offline; revisão manual de divergências de preço (sem tolerância automática); risco residual dos PINs de caixa e frentista no aparelho (`INTEGRIDADE_PDV.md`).

**O PDV e a autenticação NÃO devem ser considerados prontos para produção** enquanto os itens acima estiverem pendentes.

## 0.2 Etapa de preparação para publicação (executada em ambiente descartável)

Tudo abaixo rodou num PostgreSQL 16.15 **descartável em Docker** (bancos `*_test`). **Nada** foi feito no Railway: sem deploy, sem migration, sem leitura nem alteração de dados de produção, sem e-mail enviado, sem commit/push.

| Verificação | Evidência real |
|---|---|
| Migrations num banco **novo**: ordem e idempotência | `prisma migrate deploy` aplicou as 5 na ordem (`init` → `autenticacao` → `integridade_vendas_pdv` → `ativacao_inicial` → `conta_unica_gatilho`); a 2ª execução = "No pending migrations"; `migrate status` = em dia; 18 tabelas, view `estoque_atual`, gatilho `usuarios_conta_unica`, extensões `pgcrypto`/`pg_trgm` |
| Schema × migrations (deriva) | `prisma migrate diff` banco × `schema.prisma`: **uma única diferença, intencional**: o índice GIN trigram `idx_produtos_nome_trgm` (SQL manual na `init`, o Prisma não o modela). **Consequência:** nunca rodar `prisma migrate dev` nem `db push` contra produção (propõem apagar esse índice); só `migrate deploy`, que é o que o `npm start` faz |
| Migrations **destrutivas?** | `grep` por DROP/TRUNCATE/DELETE/UPDATE/ALTER COLUMN/RENAME/SET NOT NULL nas 5: **nenhuma** (só CREATE e ADD CONSTRAINT/TRIGGER) |
| **Atualizar** banco com dados (só a `init` + dados → 4 migrations restantes) | contagens, soma das vendas e estoque **idênticos** antes e depois; `vendas.usuario_id` = NULL nas vendas existentes |
| Banco **com tabelas e sem histórico** (cenário B1) | `migrate deploy` falha com **P3005** (reproduzido); `prisma migrate resolve --applied 20260101000000_init` (não executa SQL) seguido de `migrate deploy` funcionou |
| Diagnóstico somente-leitura de produção | `scripts/diagnostico-banco.sql` (agora com **classificação A–E calculada**, usuário/permissões e extensões *trusted*) validado em banco vazio (A), com tabelas sem histórico (B), totalmente migrado (C), migration não concluída (D) e dois casos divergentes (E); em sessão `default_transaction_read_only=on` o servidor recusa escrita ("cannot execute INSERT in a read-only transaction") |
| **Backup e restauração** | `npm run backup:ensaio` (`scripts/validar-backup-restore.mjs`): 22 verificações OK. Dump com o **mesmo comando da produção** (`docker run postgres:16 pg_dump --format=custom`), `pg_restore --list`, restauração num banco novo com `--exit-on-error`, comparação de **25 itens** (contagem + hash do conteúdo de todas as tabelas, gatilhos, funções, views, índices, constraints, extensões, migrations), `migrate status` em dia no restaurado, gatilho de venda/view de estoque e gatilho de conta única funcionando depois de restaurar, e **controle negativo** (uma linha alterada é detectada). Os bancos de ensaio são removidos ao final. **Comparação de produção × restauração:** `scripts/fotografia-banco.sql` (somente leitura) + os comandos PowerShell do §2.0–2.4 foram executados contra um banco local (dump → restauração em contêiner descartável → fotografias idênticas; esquema × init idêntico; controles negativos detectados). **Isto prova os comandos, não o banco do Railway** |
| Configuração de produção | `npm run verificar:producao` (`lib/config/verificar-producao.ts`, 15 testes): confere presença/forma de `DATABASE_URL`, `APP_URL` (https, sem barra), `RESEND_API_KEY`, `EMAIL_FROM`, `ATIVACAO_INICIAL_CODIGO` (≥ 24, não previsível), ausência de `ADMIN_SENHA`/`TEST_DATABASE_URL`; **nunca imprime valores**. `--resend` (GET /domains, sem enviar) e `--dns` (DKIM) existem mas só foram testados com respostas simuladas |
| Sonda de IP do proxy | `npm run sonda:ip` (`scripts/sonda-ip.ts`): validada em 4 cenários locais — sem proxy / proxy que só repassa → **INSEGURO** (cabeçalho forjado aceito); proxy que sobrescreve `x-real-ip` → **OK**; proxy que dá o mesmo IP interno a todos → **ATENÇÃO**. Descoberta útil: o servidor Next define `x-forwarded-for` com o IP do socket quando o cabeçalho não vem, **e não acrescenta** se o cliente já enviou um |
| **Simulação de deploy em Linux** (`npm run simular:deploy`, container `node:22-slim`, Node 22 / npm 10) | Com **só os arquivos de um `git add -A`** (304; sem `.env.local`, `node_modules`, `.next`): `npm ci` OK → `npm run build` OK → `npm prune --omit=dev` → **CLI `prisma` e Prisma Client (gerado para Linux) presentes** → `npm start`: **banco novo** aplica as 5 migrations e serve `/login` 200 (e `/pdv` sem cookie → 307 para `/login`); **banco já migrado** (reinício): "No pending migrations", sobe; **banco com tabelas e sem histórico**: falha com **P3005** e o app **não sobe** (nada é alterado); após o baseline sobe, aplica as 4 restantes e os dados continuam lá. O lockfile traz os binários Linux (`@node-rs/argon2-linux-*`, `@next/swc-linux-*`). **Nenhum defeito encontrado** — nenhuma mudança em `package.json`/lockfile foi necessária. **Contraexemplo reproduzido:** com `NODE_ENV=production` presente já no `npm ci`, as devDependencies (tailwind, typescript…) não são instaladas e o **build falha** ("Build failed because of webpack errors") → **não cadastrar `NODE_ENV` como variável do serviço** (o `verificar:producao` avisa). Limite: simula o comportamento dos builders, não o Railway em si |
| `npx tsc --noEmit` | código 0 |
| `npx vitest run` | código 0 — 35 arquivos, **460** testes |
| `npm run test:integracao` | código 0 — 6 arquivos, **156** testes (Postgres real) |
| `npm run build` | código 0 |

**Depende do Railway ou de aparelhos reais — NÃO verificado:** versão do PostgreSQL do plugin e se `CREATE EXTENSION pgcrypto/pg_trgm` é permitido ao usuário do app (a `init` exige); estado real de `_prisma_migrations` e do schema de produção (rodar `scripts/diagnostico-banco.sql`, §2.1); backup/dump **real**, sua restauração de ensaio e a comparação das fotografias (§2.2–2.3); **o resultado A–E de hoje é desconhecido**; que o app consegue `DATABASE_URL` interna e sobe; qual IP o Railway entrega (sonda); domínio Resend verificado (SPF/DKIM), chave com permissão de envio e **entrega real** do e-mail; PWA instalada em Android e iOS; tempo/limite de memória do build no Railway.

**Bloqueios para publicar (hoje):** B1 (rodar o diagnóstico em produção), B2 (dump **real** + restauração de ensaio **do dump real**), B4 (Resend + teste de entrega), B6 (reexecutar os testes no commit exato). Nenhum defeito de código impede a publicação; o que falta é validação operacional.

## 1. Natureza da migration (verificado por leitura)

`prisma/migrations/20260102000000_autenticacao/migration.sql`:
- Só `CREATE TABLE` (`usuarios`, `sessoes`, `tokens_recuperacao`, `limites_tentativa`), `CREATE INDEX`, `ADD CONSTRAINT` (FKs entre as tabelas novas; CHECKs de papel e e-mail minúsculo) e `CREATE TRIGGER` na tabela nova.
- **Nenhum** `DROP`, `ALTER` ou `UPDATE` em tabelas de negócio. Vendas, estoque, clientes e contas a receber não são tocados.
- Depende da função `set_updated_at()` criada na migration `init` (confirmado na linha 266 do `init`). Se o banco de produção não tiver essa função (B1), a migration falha **antes** de commitar (Postgres executa DDL em transação; a migration inteira é revertida).
- As migrations `20260104000000_ativacao_inicial` (cria `ativacoes_iniciais`) e `20260105000000_conta_unica_gatilho` (função + gatilho; nenhuma linha lida ou alterada) são aditivas; testadas só em banco descartável.
- A migration `20260103000000_integridade_vendas_pdv` (fase de integridade do PDV, ver `INTEGRIDADE_PDV.md`) é igualmente aditiva: cria `vendas_revisao` e adiciona `vendas.usuario_id` **nullable**; não reescreve linhas existentes.
- Consequência importante para rollback: a versão anterior do app **continua funcionando** com as 4 tabelas novas presentes (são ignoradas). Reverter o *código* não exige restaurar o banco.

---

## 2. Backup do banco de produção e recuperação

### 2.0 Preparar o terminal (PowerShell, na raiz do projeto) sem expor a URL
> **Legenda de evidência.** 🧪 = comprovado só em Postgres descartável local (os comandos abaixo foram testados assim, contra um banco local). ☁ = evidência **real**, só existe depois que **você** rodar contra o Railway. Nada de ☁ foi executado até aqui.

Use a **`DATABASE_PUBLIC_URL`** (Railway → serviço Postgres → *Variables*/*Connect*; a URL `*.railway.internal` não resolve fora do Railway). Os comandos usam `docker run -e DB_URL` **sem valor**: o Docker herda a variável do terminal, então a URL **não aparece** na linha de comando, no histórico de comandos nem na saída.

```powershell
$s = Read-Host "DATABASE_PUBLIC_URL" -AsSecureString          # digitação oculta; não grava arquivo
$env:DB_URL = [System.Net.NetworkCredential]::new("", $s).Password; Remove-Variable s
$bk  = "C:\backups-conveniencia"                              # FORA do projeto e FORA do OneDrive (o dump tem dados de clientes)
New-Item -ItemType Directory -Force $bk | Out-Null
$sql = "$((Get-Location).Path)\scripts"
$ts  = Get-Date -Format "yyyyMMdd-HHmm"                       # nomes únicos: nada abaixo sobrescreve arquivo existente
$ro  = "default_transaction_read_only=on"
```
Ao final de tudo: `Remove-Item Env:DB_URL` e fechar o terminal. Não cole saídas que contenham a URL (nenhum comando abaixo a imprime; se um erro de conexão a mostrar, apague antes de compartilhar).

### 2.1 Diagnóstico somente leitura (etapa 3) — ☁ pendente
```powershell
docker run --rm -e DB_URL -e PGOPTIONS="-c $ro" -v "${sql}:/sql:ro" postgres:16 sh -c 'psql "$DB_URL" -v ON_ERROR_STOP=1 -f /sql/diagnostico-banco.sql 2>&1' | Tee-Object "$bk\diagnostico-$ts.txt"
```
A sessão é `read_only`: o servidor recusa qualquer escrita (🧪 `cannot execute DELETE in a read-only transaction`). A saída tem só versão, nomes de objetos e contagens — **sem dados de clientes e sem credenciais**; pode ser trazida para revisão. A **linha `CASO …` da seção 5 é calculada pelo script** (🧪 testada em A, B, C, D e dois E). Guarde a versão do servidor (seção 1): a imagem do `pg_dump` abaixo precisa ser de major **igual ou maior** (`$img`).

### 2.2 Backup consistente (etapa 4) — ☁ pendente
`pg_dump --format=custom` lê tudo numa **única transação com snapshot**: o dump é consistente em si. Para provar que nada mudou *entre* o dump e a comparação, tire a fotografia (§2.3) **antes e depois**; faça isto **fora do horário de venda** (as vendas feitas no intervalo aparecem como diferença legítima).
```powershell
$img = "postgres:16"                                          # major >= o do servidor (seção 1 do diagnóstico)
$arq = "conveniencia-$ts.dump"
if (Test-Path "$bk\$arq") { throw "$arq já existe; não sobrescrevo." }
function Foto($saida) { docker run --rm -e DB_URL -e PGOPTIONS="-c $ro" -v "${sql}:/sql:ro" $img sh -c 'psql "$DB_URL" -q -v ON_ERROR_STOP=1 -f /sql/fotografia-banco.sql' | Out-File -Encoding utf8 -NoClobber $saida }
Foto "$bk\foto-prod-antes-$ts.txt"
docker run --rm -e DB_URL -e ARQ=$arq -v "${bk}:/backup" $img sh -c 'pg_dump "$DB_URL" --format=custom --no-owner --no-privileges -f "/backup/$ARQ"'
Foto "$bk\foto-prod-depois-$ts.txt"
Set-ItemProperty "$bk\$arq" -Name IsReadOnly -Value $true
(Get-FileHash "$bk\$arq").Hash                                # anote: prova de que o arquivo não mudou depois
```
Critérios: `pg_dump` sem erro; o arquivo existe e tem tamanho plausível; `foto-prod-antes` = `foto-prod-depois` (`(Get-FileHash a).Hash -eq (Get-FileHash b).Hash`). Se diferirem, veja `Compare-Object (Get-Content a) (Get-Content b)`: só linhas de tabelas com movimento (vendas, sessões…) são aceitáveis, e então a comparação final deve ser feita contra a fotografia **mais próxima do dump** — na dúvida, repita com o sistema parado.

Conferência de conteúdo do arquivo (sem restaurar):
```powershell
docker run --rm -e ARQ=$arq -v "${bk}:/backup" $img sh -c 'pg_restore --list "/backup/$ARQ"' | Select-String "TABLE DATA public (vendas|itens_venda|produtos|movimentacoes_estoque|contas_receber|recebimentos|clientes|funcionarios|_prisma_migrations) |FUNCTION public (gerar_movimentacao_venda|produtos_mais_vendidos|set_updated_at)|VIEW public (estoque_atual|resumo_vendas_hoje)"
```
Devem aparecer as tabelas (mais `usuarios`, `sessoes`… se a autenticação já existir no banco), as 3 funções e as 2 views. O arquivo contém dados pessoais e hashes de PIN: não anexar a chats, e-mails nem ao Git (o `.gitignore` já ignora `*.dump` e `/backup/`). Cópia adicional: tela **Backup** do sistema (JSON) — não substitui o dump. Conferir também no painel do Railway se há backups automáticos do volume (depende do plano; **não verificado**).

### 2.3 Restaurar num PostgreSQL descartável e comparar (etapa 4) — ☁ pendente
Nunca restaure no Railway nem sobre o banco em uso. O descartável é um contêiner **novo, sem porta publicada** (nada de rede, nem senha em linha de comando):
```powershell
$ens = "pg-ensaio-restore"
if (docker ps -a --filter "name=^$ens$" -q) { throw "contêiner $ens já existe; use outro nome (não removo o que não criei)." }
docker run -d --name $ens -e POSTGRES_HOST_AUTH_METHOD=trust $img | Out-Null
docker exec $ens sh -c 'until pg_isready -U postgres -q; do sleep 1; done'
docker exec $ens createdb -U postgres ensaio_restore
docker cp "$bk\$arq" "${ens}:/tmp/r.dump"
docker cp "$sql\fotografia-banco.sql" "${ens}:/tmp/foto.sql"
docker exec $ens pg_restore -U postgres --no-owner --exit-on-error -d ensaio_restore /tmp/r.dump
docker exec $ens psql -U postgres -d ensaio_restore -q -v ON_ERROR_STOP=1 -f /tmp/foto.sql | Out-File -Encoding utf8 -NoClobber "$bk\foto-restaurado-$ts.txt"
(Get-FileHash "$bk\foto-prod-depois-$ts.txt").Hash -eq (Get-FileHash "$bk\foto-restaurado-$ts.txt").Hash   # True = idênticos
```
`pg_restore --exit-on-error` aborta no primeiro erro. A fotografia (`scripts/fotografia-banco.sql`, transação `REPEATABLE READ READ ONLY`, só `SELECT`) compara por `diff`/hash: **migrations** (nome, conclusão, checksum), **todas as tabelas** (contagem + md5 do conteúdo), **colunas**, **gatilhos** (definição e estado), **funções** (md5 do corpo), **views** (md5), **índices**, **constraints**, **extensões** e **sequências**. 🧪 Testado: origem × restaurado idênticos (368 linhas) e, após alterar uma linha, a diferença é acusada.
**Aprovado** somente se: restauração sem erro **e** `True` acima. `False` → `Compare-Object (Get-Content "$bk\foto-prod-depois-$ts.txt") (Get-Content "$bk\foto-restaurado-$ts.txt")` e **trazer a diferença para revisão**; o backup **não** está validado.
Limites: não compara papéis/permissões (usa-se `--no-owner --no-privileges`) nem os valores atuais das sequências. Remoção (só o seu contêiner): `docker rm -f pg-ensaio-restore`; o dump fica guardado.

### 2.4 Ação segura para cada resultado do diagnóstico
**Nenhum resultado autoriza escrita automática.** Todos os comandos de escrita abaixo são **seus**, depois de revisão conjunta.

| Resultado | Significado | Ação segura |
|---|---|---|
| **A** vazio | sem tabelas e sem histórico | Nada a perder. Pode publicar; o `npm start` aplica as 5 migrations. Backup é opcional |
| **B** tabelas da init **sem** histórico | o `npm start` aborta com P3005 e **nada é alterado** | **PARAR.** Pré-requisitos, todos: (1) dump do dia **validado** (§2.2–2.3 aprovados); (2) o **esquema de produção bate com a init** (comparação abaixo); (3) **sua confirmação explícita** por escrito. Só então o baseline: `$env:DATABASE_URL=$env:DB_URL; npx prisma migrate resolve --applied 20260101000000_init` (grava **uma linha** em `_prisma_migrations`; não executa SQL de negócio). Depois, `diagnostico-banco.sql` de novo deve dar **C** |
| **C** histórico íntegro | migrations pendentes serão aplicadas no deploy | Dump validado (§2.2–2.3) e deploy normal; todas são aditivas (§1) |
| **D** migration não concluída/revertida | uma migration falhou antes | **PARAR.** Não rodar deploy, `resolve` nem `migrate dev/reset`. Trazer a saída (seção 2 do diagnóstico) e o log do erro |
| **E** divergente/parcial | núcleo da init incompleto, objetos posteriores sem histórico, ou migration desconhecida | **PARAR.** Não foi criado só pela init: aplicar migrations poderia falhar ou duplicar. Trazer a saída; decidir caso a caso |

Comparação do esquema de produção com a init (obrigatória no caso B; 🧪 testada com bancos locais):
```powershell
docker exec $ens createdb -U postgres ref_init
docker cp "$((Get-Location).Path)\prisma\migrations\20260101000000_init\migration.sql" "${ens}:/tmp/init.sql"
docker exec $ens psql -U postgres -d ref_init -q -v ON_ERROR_STOP=1 -f /tmp/init.sql 2>$null | Out-Null
docker exec $ens psql -U postgres -d ref_init -q -v ON_ERROR_STOP=1 -f /tmp/foto.sql | Out-File -Encoding utf8 -NoClobber "$bk\foto-referencia-init-$ts.txt"
function Esquema($f) { $o = $true; foreach ($l in Get-Content $f) { if ($l -like '## *') { $o = ($l -notlike '## tabelas*' -and $l -ne '## migrations') }; if ($o) { $l } } }
Compare-Object (Esquema "$bk\foto-prod-depois-$ts.txt") (Esquema "$bk\foto-referencia-init-$ts.txt")   # vazio = esquema igual ao da init
```
Qualquer linha de diferença → tratar como **E** (parar e trazer para revisão). Essa comparação só é válida no caso B (sem tabelas posteriores à init); precisa do contêiner `$ens` do §2.3.

### 2.5 Se algo falhar / reversão
| Situação | Ação |
|---|---|
| Migration falha no deploy | Cada migration roda numa transação do Postgres: se falhar, **nada** daquela migration permanece e as anteriores continuam aplicadas. O app não sobe (o `npm start` aborta, pois `prisma migrate deploy && next start`); **o comportamento do Railway nesse caso (manter o deploy anterior no ar ou entrar em loop de reinício) não foi verificado** — acompanhar os logs do deploy. Ver `_prisma_migrations`: se uma linha ficou com `finished_at` nulo, **não force**; investigar e, se for o caso, `prisma migrate resolve --rolled-back <nome>` e novo deploy corrigido. Dados de negócio não foram tocados |
| App publicado com defeito (migrations já aplicadas) | **Preferir corrigir para frente** (novo deploy). As migrations são **aditivas**, então uma versão anterior do código continua funcionando com o banco novo (colunas/tabelas novas são ignoradas; a `usuario_id` das vendas é opcional). **Atenção:** voltar para uma versão **anterior à autenticação reabre o sistema SEM login** — só com decisão consciente do dono, e idealmente com o serviço pausado até a correção |
| Reverter o deploy no Railway | Deployments → versão anterior → *Redeploy*. Não reverte o banco. Verificado em ensaio: um código com **menos** migrations (só `init` + `autenticacao`) rodando `prisma migrate deploy` contra um banco que já tem as 5 termina com código 0 ("No pending migrations to apply") e **não altera** o histórico — logo o `npm start` de uma versão anterior sobe normalmente. (Versão do Prisma do ensaio: a do projeto, 6.19.3; o Railway usa a do `package-lock.json`.) |
| Dados de negócio corrompidos (improvável: as migrations não os tocam) | Restaurar o dump **num banco novo** do Railway, validar contagens (§2.3) e só então apontar `DATABASE_URL` para ele. **Nunca** `pg_restore --clean` sobre o banco em uso. Vendas feitas depois do dump precisam ser reconciliadas à parte |
| Sonda de IP reprova (etapa 8) | Não liberar o uso: nada foi aberto ao público além das telas de login. Corrigir `ipDoCliente()` e republicar |
| Ativação concluída com a conta errada | A conta única é imposta no banco; não crie outra. Redefina o acesso pelo e-mail correto (recuperação de senha) ou, com acesso à infraestrutura, `npm run admin:criar -- --email <o e-mail da conta> --forcar`. Apagar a linha de `usuarios` é destrutivo: só com backup e decisão do dono |
| Remover as 4+ tabelas de autenticação | É destrutivo (só nelas). Só com decisão explícita; nunca automático |

### 2.6 Reversibilidade: o que um rollback de **código** NÃO desfaz
O Prisma não gera "down": nenhuma migration é revertida pelo Railway nem por `migrate deploy`. Todas são aditivas, então código mais antigo continua rodando (verificado: `migrate deploy` de uma versão com menos migrations termina com código 0 sem alterar o histórico; o **uso** das consultas antigas contra o schema novo é por análise — colunas/tabelas novas são ignoradas —, não foi executado). Mas:

| Migration | Rollback de código basta? | Efeito que permanece / reversão manual do schema (**destrutiva; só com backup e decisão do dono**) |
|---|---|---|
| `0102_autenticacao` | Sim para o banco; **mas** código anterior à autenticação = sistema **sem login** | `DROP TABLE tokens_recuperacao, sessoes, limites_tentativa, usuarios` (apaga a conta principal) |
| `0103_integridade_vendas_pdv` | Parcial: a versão antiga grava vendas sem `usuario_id` (coluna opcional), **porém** ignora `vendas_revisao`: vendas já retidas para revisão **continuam fora do faturamento e do estoque** e a validação de preço/funcionário no servidor deixa de existir | `DROP TABLE vendas_revisao`; `ALTER TABLE vendas DROP COLUMN usuario_id` (perde a autoria das vendas) |
| `0104_ativacao_inicial` | Sim (tabela ignorada) | `DROP TABLE ativacoes_iniciais` |
| `0105_conta_unica_gatilho` | **Não é neutra:** o gatilho continua barrando a 2ª conta em `usuarios` mesmo com código antigo | `DROP TRIGGER usuarios_conta_unica ON usuarios; DROP FUNCTION usuarios_conta_unica();` |
| IndexedDB dos aparelhos (v5→v6, no navegador) | **Não**: a migração apaga `pin_hash` locais (só caixa/frentista ficam em `credenciais_pin_local`). Com código antigo o PIN offline só volta depois de uma sincronização **online**; a **fila de vendas não é tocada** | sem reversão automática |

Regra prática: se algo der errado depois do deploy, **corrija para frente**; reverter o código é possível, mas não devolve o estado anterior do banco nem dos aparelhos.

---

## 3. Primeiro administrador (sem cadastro público, sem senha padrão)

Verificado em `scripts/criar-admin.ts`: pede e-mail e nome; senha por prompt oculto (com confirmação) ou `ADMIN_SENHA`; aplica a política de senha; grava só o hash Argon2id; **recusa** rodar se já existir admin ativo (exceto `--forcar`); `--forcar` redefine/reativa/promove e encerra sessões. Não imprime senha.

Procedimento (após a migration aplicada, §5 passo 7):
1. Num terminal **seu**, interativo (não um terminal compartilhado/gravado): digite a variável sem salvar em arquivo:
   - PowerShell: `$env:DATABASE_URL = Read-Host "URL publica"` (mostra o texto; se preferir ocultar, use `-AsSecureString` e converta, ou cole e limpe o histórico).
   - Depois: `npm run admin:criar -- --email <seu-email> --nome "<Seu Nome>"` e digite a senha nos prompts ocultos.
2. Nunca use `ADMIN_SENHA` se houver terminal interativo. Se for inevitável, defina só na sessão do terminal e remova com `Remove-Item Env:ADMIN_SENHA`.
3. Ao terminar: `Remove-Item Env:DATABASE_URL`, e feche o terminal.
4. Critério de aceite: a saída diz `Administrador ... criado`; `SELECT email, papel, ativo FROM usuarios;` mostra exatamente 1 linha `admin/true`; login em `<APP>/login` funciona; rodar o script de novo **recusa** (prova da trava).
5. Importante: o app **não tem acesso público** antes disso — todo acesso exige login, e até o passo 4 ninguém entra, nem o dono. Planeje a janela: PDV fora do ar para quem não estiver logado. Aparelhos offline já abertos continuam operando localmente? **Não**: sem marcador `sessao_offline_v1` o PDV é bloqueado (a fila é preservada). Avisar os operadores para sincronizar as vendas pendentes **antes** da publicação.
6. Senha forte e única (≥10 caracteres, letras e números; use gerenciador de senhas). Crie um **segundo admin** logo depois, para não depender de um único acesso.

---

## 3.1 Alternativa: ativação inicial pelo próprio cliente (`/configurar-conta`)

Detalhes em `AUTENTICACAO.md` ("Ativação inicial da conta principal"). Resumo operacional — **nada disto foi executado em produção**:

| Item | Ação | Critério de aceite |
|---|---|---|
| Migrations | `20260104000000_ativacao_inicial` (cria `ativacoes_iniciais`) e `20260105000000_conta_unica_gatilho` (função + gatilho que impede 2ª conta no PostgreSQL; não altera linhas) — ambas aditivas, vão no deploy (§5 passo 7) | tabela e gatilho `usuarios_conta_unica` existem; `_prisma_migrations` com 5 linhas concluídas |
| `ATIVACAO_INICIAL_CODIGO` | gerar ≥ 24 caracteres aleatórios; cadastrar **só** no Railway (segredo); entregar ao cliente por canal separado | variável presente; **ausente do Git/logs/capturas** |
| `APP_URL`, `RESEND_API_KEY`, `EMAIL_FROM` | obrigatórias (§4): sem elas a página mostra “e-mail não configurado” e nada é ativado | ver §4 |
| Teste real de e-mail | pedir a ativação com um e-mail do dono e receber o link na caixa de entrada (não spam), painel Resend *Delivered* | **ainda não feito** — sem isso o fluxo não está pronto para produção |
| Ativar | cliente abre `<APP>/configurar-conta`, informa código + dados, abre o link, clica *Ativar conta principal*, entra em `/login` | `SELECT email, papel, ativo FROM usuarios;` → 1 linha `admin/true` |
| Encerramento | **remover `ATIVACAO_INICIAL_CODIGO` do Railway** após a ativação; `/configurar-conta` passa a dizer “não está disponível” | variável removida; segundo pedido recusado |

**Revisão de segurança (resultado em `AUTENTICACAO.md`):** corrigidos limite de tentativas não atômico, chaves de IP contornáveis por formato, hashes de pedidos não concluídos, erros inesperados sem tratamento e cabeçalhos de `/ativar-conta`; conta única agora também no PostgreSQL. **Pendências desta frente:** (1) enviar e-mail real e validar o link ponta a ponta; (2) aplicar as migrations só no deploy aprovado (antes: backup; o gatilho não altera linhas existentes, mas se já houver mais de uma conta o gatilho apenas passa a barrar novas); (3) gerar `ATIVACAO_INICIAL_CODIGO` aleatório (≥ 24 caracteres) **no momento da implantação** — não foi gerado nem armazenado em lugar nenhum; (4) remover a variável após ativar; (5) login e recuperação já usam contagem atômica e IP canônico; **validar na implantação** que o Railway sobrescreve `x-real-ip` (teste com cabeçalhos forjados descrito em `AUTENTICACAO.md`) — sem essa validação o limite por IP não é confiável (o limite por conta continua valendo); o limitador de PIN segue como estava.

Escolha **um** dos caminhos para o primeiro acesso (§3 script ou §3.1); os dois recusam criar uma segunda conta.

## 4. Variáveis no Railway e validação de e-mail

| Variável | Valor | Observação |
|---|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | referência; já existente |
| `APP_URL` | `https://<domínio-do-app>` sem barra final | base dos links de recuperação; em produção, sem ela nenhum link é gerado |
| `RESEND_API_KEY` | chave da Resend | marcar como segredo; nunca no repositório |
| `EMAIL_FROM` | `Conveniência União <nao-responder@seudominio.com.br>` | domínio **verificado** na Resend (SPF/DKIM) |
| `ATIVACAO_INICIAL_CODIGO` | ≥ 24 caracteres aleatórios, **somente** para a ativação inicial | segredo; só no Railway; **remover após ativar** (§3.1) |
| `NEXT_PUBLIC_SESSAO_OFFLINE_HORAS` | opcional (padrão 72) | é embutida no build (`NEXT_PUBLIC_`): alterar exige novo build |

`ADMIN_SENHA` e `TEST_DATABASE_URL` **não** devem existir no serviço de produção.

**Validação sem expor segredos** (nada disso foi feito ainda):
1. Na Resend: domínio com status *Verified*; chave criada com permissão apenas de envio.
2. No painel do Railway confira que as 3 variáveis existem (sem exibir valores em captura de tela).
3. Em `<APP>/recuperar-senha`, peça recuperação para o e-mail do admin. A tela responde a mesma mensagem existindo ou não o e-mail — **portanto a resposta da tela não prova envio**. A prova é: (a) a mensagem chega na caixa de entrada (e não em spam); (b) o painel da Resend mostra *Delivered*; (c) os logs do Railway **não** mostram `[email] ... não enviado`/`HTTP 4xx`/`falha ao contatar` (o código só loga o status, nunca token nem link).
4. Abrir o link: leva a `/redefinir-senha`, definir nova senha, entrar com ela; a senha antiga deixa de valer; o mesmo link, reaberto, é recusado (uso único).
5. Teste negativo: e-mail inexistente → mesma tela, **nenhum** e-mail enviado (Resend sem novo registro).
6. A tela **Usuários** não deve exibir o alerta de e-mail não configurado.
Não cole o link nem o token em chats/tickets; use-o uma vez e descarte.

### 4.1 Descobrir qual IP o Railway entrega ao app (`npm run sonda:ip`)

**Não presumir** que `x-real-ip` esteja correto. O limite de tentativas por IP só vale se (a) o app enxergar o IP **real** de quem chama e (b) um cabeçalho forjado pelo cliente **não** for aceito. Esta sonda mede as duas coisas, de forma segura:

1. Faz **3 tentativas de login com e-mails fictícios** (`…@example.invalid`) e senha errada: (A) com `X-Real-IP` e `X-Forwarded-For` forjados, (B) só com `X-Forwarded-For` forjado, (C) sem cabeçalhos. Não toca na conta real; só soma 3 falhas ao contador do **seu** IP (expira sozinho; limite de 20/15 min — não rode em loop).
2. Lê (somente `SELECT`) as chaves `login:ip:*` que o app gravou e compara com os IPs forjados e com o seu.

Como rodar (depois do deploy, **antes** de liberar o uso, etapa 8):
```
# PowerShell — digite a URL pública do banco sem salvá-la em arquivo
$env:DATABASE_URL = Read-Host "DATABASE_PUBLIC_URL"
npm run sonda:ip -- --url https://SEU-APP.up.railway.app --meu-ip <SEU IP PÚBLICO>
Remove-Item Env:DATABASE_URL
```
Interpretação (o código de saída é 0 só se tudo estiver certo):
| Saída | Significado | Ação |
|---|---|---|
| `OK … nenhum IP forjado foi usado` e `OK … enxerga o IP real` | proxy sobrescreve/anexa corretamente | liberar |
| `INSEGURO … aceitou cabeçalho forjado` | o proxy repassa `x-real-ip`/`x-forwarded-for` do cliente; o limite por IP é contornável | **não liberar**; ajustar `ipDoCliente()` (`lib/auth/ip.ts`) ao cabeçalho que a plataforma realmente controla; reexecutar a sonda |
| `ATENÇÃO … NÃO enxerga o seu IP: viu <IP>` | o app recebe o IP interno do proxy: **todos** os usuários dividem um contador (um atacante trava o login de todos) | **não liberar**; descobrir o cabeçalho certo (ver a saída) e ajustar |
| `ATENÇÃO … nenhuma chave nova` | a sonda não chegou ao app ou `DATABASE_URL` é de outro banco | conferir URL e banco |

**Os testes locais da sonda (4 cenários simulados com um proxy de ensaio) só provam que a *sonda* distingue os casos — NÃO provam nada sobre o Railway.** Só vale o resultado obtido contra o app publicado.

**Resultados reais que BLOQUEIAM a liberação (qualquer um):**
1. `INSEGURO` — o app usou um IP enviado pelo cliente.
2. `ATENÇÃO … NÃO enxerga o seu IP` — o app vê outro IP (ex.: o do proxy): todos dividem um contador.
3. `ATENÇÃO … nenhuma chave nova` ou erro (código de saída 2) — a sonda não mediu nada; **sem medição não há aprovação**.
4. Aprovação numa rede só: repetir a sonda a partir de **uma segunda rede** (ex.: dados móveis, com o `--meu-ip` dessa rede). Só libere se as duas aprovarem **e** os dois IPs registrados forem diferentes (prova que o app acompanha o IP de quem chama, não um valor fixo).
Se `--meu-ip` não casar por você estar atrás de VPN/CGNAT/IPv6, o resultado é `ATENÇÃO` (bloqueia): use um IP que você consiga confirmar no registro do próprio servidor, ou rode a sonda de outra rede.

A proteção por **conta** (hash do e-mail) não depende do IP e continua valendo em qualquer cenário.

---

## 5. Checklist de implantação (ordem exata)

Cada etapa só libera a próxima com a **evidência** indicada. Marque como feito **apenas** o que foi realmente feito.

| # | Etapa | Comando / ação | Evidência para liberar |
|---|---|---|---|
| 1 | Congelar o commit candidato | Revisar o diff; o commit/push é **decisão do dono** (não feito aqui). **Atenção:** há 51 arquivos modificados e **70 entradas não rastreadas** (`??`) que SÃO necessárias: todo o módulo de autenticação (`app/login`, `app/ativar-conta`…, `components/auth`, `lib/auth`, `lib/email`, `lib/usuarios`, `lib/config`, `services/auth`), `middleware.ts`, `public/offline.html`, `scripts/`, os testes e as migrations `20260102…`–`20260105…`. Se o commit as omitir, o deploy aplicaria só a `init` e o app quebraria. Conferir: `git ls-files --cached --others --exclude-standard` (é o que um `git add -A` leva; hoje 305 arquivos, `.env.local`/`node_modules`/`.next` ficam de fora pelo `.gitignore`) e rodar `npm run simular:deploy` sobre esse conjunto | hash do commit anotado; `git ls-files prisma/migrations` lista as 5 pastas + `migration_lock.toml`; simulação sem falhas |
| 2 | Testes pré-deploy **no commit exato** | `npx tsc --noEmit`; `npx vitest run`; `npm run test:integracao` (`TEST_DATABASE_URL` de um Postgres descartável terminado em `_test`); `npm run build`; `npm run backup:ensaio` | todos com código 0 (no estado desta revisão: unit 460/460, integração 156/156) |
| 3 | **Diagnóstico do banco de produção** (somente leitura) ☁ | §2.0 e §2.1 (sessão `read_only`; a URL não aparece em linha de comando) | saída com a linha `CASO A/B/C/D/E` (calculada pelo script). **A/C →** segue. **B →** PARAR: baseline só com dump validado + comparação do esquema com a init + sua confirmação explícita (§2.4). **D/E →** PARAR e trazer a saída para revisão |
| 4 | **Backup real** + restauração de ensaio ☁ | §2.2 (dump com `pg_dump --format=custom`, fotografia antes/depois, hash do arquivo) e §2.3 (restaurar num contêiner descartável **sem porta** e comparar) | `foto-prod-depois` = `foto-restaurado` (`True`): migrations, todas as tabelas (contagem+md5), colunas, gatilhos, funções, views, índices, constraints, extensões. Só então o backup está **validado** |
| 5 | Preparar variáveis | §4: `APP_URL`, `RESEND_API_KEY`, `EMAIL_FROM`, `ATIVACAO_INICIAL_CODIGO` (se for usar a ativação); `railway run npm run verificar:producao -- --resend --dns` | **0 erro(s)**; domínio Resend "verificado" |
| 6 | Esvaziar filas offline | Pedir que cada aparelho abra **Sincronização** online até zerar pendências | pendências = 0 (ou ciência de que continuam na fila — são preservadas) |
| 7 | Publicar | deploy do commit; o start roda `prisma migrate deploy`. Na simulação Linux, mesmo após `npm prune --omit=dev` o CLI `prisma` permanece (o npm o mantém por ser peer opcional de `@prisma/client`), então o `start` funciona. Se o Railway ainda assim mostrar "prisma: not found" **antes** de qualquer migration, nada foi alterado: mover `prisma` para `dependencies` e republicar. **Não** definir `NODE_ENV` nas variáveis do serviço | log: `Applying migration …` para as pendentes, depois `Ready`; `_prisma_migrations` com 5 linhas concluídas; contagens de negócio iguais às da etapa 4 |
| 8 | **Sonda de IP — ANTES de liberar o uso** | §4.1 (`npm run sonda:ip`) | veredito **OK** em todas as linhas. Se "INSEGURO" ou "ATENÇÃO": **não liberar**; corrigir `ipDoCliente()` e republicar |
| 9 | Primeiro acesso | §3.1 (ativação) **ou** §3 (script) — um só caminho | 1 linha `admin/true` em `usuarios`; login funciona; 2ª tentativa recusada |
| 10 | Encerrar a ativação | **remover `ATIVACAO_INICIAL_CODIGO`** do Railway; abrir `<APP>/configurar-conta` | "não está disponível" |
| 11 | Testes pós-deploy (§5.2) e PWA instalada (§5.3) | conforme as tabelas | todos OK nas linhas aplicáveis |
| 12 | Encerrar | remover variáveis temporárias do terminal; guardar o dump com segurança por alguns dias | — |

### 5.1 Testes **antes** da implantação (ambiente local/descartável)
Já existentes e executados (reexecutar no commit final — etapa 2):
- Unitários (`npx vitest run`): senha, limitador, IP, middleware (todas as páginas, `/api`, cabeçalhos forjados), cobertura de guardas, service worker v4 (com o `sw.js` real), tela offline estática, configuração de produção, fila offline.
- Integração contra Postgres real (`npm run test:integracao`): login, bloqueio atômico, recuperação, ativação inicial (concorrência, expiração, uso único), conta única no banco, integridade das vendas do PDV.
- Navegador (Playwright + Chrome, scripts no scratchpad da sessão, **não versionados**): ver `AUTENTICACAO.md` e `INTEGRIDADE_PDV.md`.
- Procedimento de backup/restauração: `npm run backup:ensaio`.

### 5.2 Testes **depois** da implantação (produção, sem dados reais alterados)
Executar manualmente; **só marcar como feito o que for realmente feito**:
1. `GET <APP>/pdv` e `/usuarios` sem cookie → redireciona a `/login`. `GET <APP>/api/<qualquer>` → 401. `GET <APP>/offline.html` → 200 sem login.
2. Login do admin com senha correta → entra; com senha errada → mensagem genérica.
3. Bloqueio: errar a senha 6 vezes com um **e-mail inexistente** (ex.: `teste-bloqueio@example.invalid`) → a 6ª tentativa já responde "Muitas tentativas" (o comportamento é idêntico ao de uma conta real, por desenho). **Não** teste o bloqueio com o e-mail da conta real: o limite por conta é um vetor de negação de serviço conhecido e travaria o próprio dono por alguns minutos.
4. Permissões do PDV (sem criar outra conta de login — a conta é única): em **Funcionários**, criar um funcionário de teste com cargo `caixa` e PIN próprio → ele vende no PDV; ações restritas (estoque, funcionários) exigem PIN de um cargo autorizado; ao final, desativar o funcionário de teste. **Não** desabilite o gatilho `usuarios_conta_unica` em produção.
5. Logout → voltar com o botão do navegador não mostra dados; cookie removido.
6. Recuperação de senha completa (§4.3–4.5) — **único teste que envia e-mail real**.
7. Offline (aparelho de teste, DevTools → Offline): PDV abre e vende na fila; reconectar sincroniza; com sessão expirada a venda permanece na fila e sincroniza após novo login.
8. Contagens de negócio idênticas às do backup (menos vendas feitas depois).
9. Logs do Railway sem senhas, tokens, links ou `DATABASE_URL`.
10. Service worker `v4`: DevTools → Application → Cache Storage sem `-v2`/`-v3`; a entrada `/pdv` em `paginas-v4` **não contém** nome/e-mail do usuário.

### 5.3 PWA instalada — Android e iOS (**NÃO executado; precisa de aparelhos reais**)
Registrar aparelho, versão do sistema/navegador e resultado de cada linha. O que depende de inspeção (Cache Storage/IndexedDB) só é possível no Android (Chrome → `chrome://inspect` com o aparelho em USB) ou no iOS **com um Mac** (Safari → Desenvolver). Sem Mac, no iOS valem só as verificações funcionais.

| # | Teste | Android (Chrome) | iOS (Safari, "Adicionar à Tela de Início") |
|---|---|---|---|
| 1 | Instalar o app e abrir em modo standalone; ícone/splash corretos | ☐ | ☐ |
| 2 | Login; a sessão sobrevive a fechar e reabrir o app (cookie `__Host-sessao`, Secure) | ☐ | ☐ |
| 3 | Abrir PDV, Pin e Sincronização online; confirmar service worker `v4` ativo e `caches.keys()` sem `-v2`/`-v3` | ☐ | ☐ (só com Mac) |
| 4 | Modo avião → reabrir o app → PDV abre com o nome do operador (do marcador local) e o menu correto para o papel | ☐ | ☐ |
| 5 | Modo avião → abrir uma rota fora do PDV (ex.: Clientes) → aparece a tela estática "Sistema funcionando offline", com logo e contagem de pendentes | ☐ | ☐ |
| 6 | Registrar uma venda offline → aparece como pendente; reconectar → sincroniza e some das pendências | ☐ | ☐ |
| 7 | Entrada `/pdv` em `paginas-v4` sem nome/e-mail; `/clientes` e `/estoque` ausentes do cache | ☐ | ☐ (só com Mac) |
| 8 | Logout → modo avião → reabrir: sem identidade do usuário anterior; fila de vendas pendentes preservada | ☐ | ☐ |
| 9 | Trocar de usuário no mesmo aparelho: nada do anterior aparece | ☐ | ☐ |
| 10 | Persistência dos dados do aparelho (IndexedDB) após dias sem abrir o app — no iOS, o WebKit pode limpar dados de sites **não instalados** inativos por ~7 dias; confirmar que a **PWA instalada** mantém catálogo e fila | ☐ (reabrir após 1–2 dias) | ☐ (reabrir após 8+ dias) |
| 11 | Atualização do service worker após um novo deploy: aparece o aviso de atualização; após atualizar nada se perde | ☐ | ☐ |
| 12 | Leitor de código de barras (câmera) funciona dentro da PWA | ☐ | ☐ |

---

## 6. Avaliação de risco offline — dois riscos **separados**

### 6.1 Barreira offline do PDV (`GuardaSessao` / `sessao_offline_v1`)
- **O que é**: marcador em `localStorage` (usuarioId, nome, horários). Decide, no cliente, se mostra o PDV. Prazo: 72 h desde a última validação online, limitado ao teto de 7 dias da sessão.
- **Não é controle de segurança.** Quem tem o aparelho pode escrever esse marcador no console do navegador ou usar o navegador sem passar pelo overlay. Um usuário sem autorização com acesso físico/ao perfil do navegador consegue, offline:
  - abrir o PDV, ver o catálogo local (produtos, preços, estoque), lista de clientes e funcionários replicados;
  - registrar vendas na fila local (IndexedDB), inclusive adulterando preços/quantidades/funcionário na própria fila;
  - se ele já tinha a sessão do usuário legítimo no aparelho, nada o impede de operar por até 72 h mesmo que a conta tenha sido desativada.
  - **Sem sessão válida e sem dados prévios no aparelho** (nunca logou ali), não há catálogo local: o PDV fica vazio. A exposição é dos dados **já replicados** naquele navegador.
- **Controles de servidor na sincronização** (verificados no código): `sincronizarVendaAction` e `buscarAlteracoesCatalogoAction` exigem `verificarAcesso()` (sessão válida e usuário ativo) como primeira instrução; sem sessão, nada é gravado e a venda fica na fila (`requerLogin`); idempotência por `id` da venda; transação.
- **Lacunas do servidor (reais, hoje)** — o que o servidor **não** valida em `registrarVenda`:
  1. `preco_unitario` e `quantidade` vêm do cliente; o total é recalculado a partir **dos preços enviados**, não dos preços do cadastro.
  2. `funcionario_id` não é checado contra a sessão nem se o funcionário está ativo (apenas a FK exige que exista).
  3. Não há verificação de que o PIN foi realmente informado; o vínculo venda↔usuário-do-login não é gravado.
  4. Qualquer sessão válida (inclusive `operador`) pode chamar o endpoint com payload arbitrário.
  Impacto: um operador autenticado (ou alguém com uma sessão roubada) pode lançar vendas com preço manipulado ou em nome de outro funcionário, e isso será aceito e baixará estoque via trigger. É um risco de **integridade/fraude interna**, não de acesso anônimo.
- **Riscos que permanecem**: conta desativada opera local até 72 h; adulteração do relógio/marcador local; dados de negócio permanecem no navegador após o uso (apagados no logout, mas não se o aparelho for apenas abandonado).

### 6.2 PINs replicados no IndexedDB (risco pré-existente, não alterado pela autenticação)
- `buscarAlteracoesCatalogoAction` devolve a linha completa de `funcionarios`, incluindo **`pin_hash`** (bcrypt) — `listarFuncionariosAlteradosDesde` não faz `select` restrito. O hash é salvo em `funcionarios_local` e usado em `pin-local.service.ts` para validar PIN offline.
- **Quem recebe**: qualquer sessão autenticada (também `operador`) em qualquer aparelho, e também quem chamar a Server Action diretamente com um cookie válido.
- **Risco**: PIN de 4 dígitos = 10.000 possibilidades; um bcrypt desses é quebrado em segundos/minutos offline. Quem extrair o IndexedDB obtém **todos os PINs, inclusive de gerente/admin**, e passa a poder autorizar operações sensíveis (ajuste de estoque, gestão de funcionários) *dentro de uma sessão de login válida* — o PIN é segunda camada, não substitui o login. O contador de tentativas local (`tentativas_pin_local`) também está no IndexedDB e pode ser zerado.
- **Mitigação existente**: exige sessão autenticada para obter os hashes; cache/IndexedDB é limpo no logout (as filas de vendas não).
- **Não resolvido** e fora da correção de autenticação.

---

## 7. Proposta separada — endurecimento do sincronismo e do PIN offline

> **Status:** P1 e P2 foram implementados (e P3 parcialmente) na fase descrita em `INTEGRIDADE_PDV.md`, em migration própria (`20260103000000_integridade_vendas_pdv`, ainda **não aplicada em produção**). As seções 6.1 (lacunas do servidor) e 6.2 abaixo descrevem o estado ANTERIOR e ficam como registro; o estado atual e o risco residual estão em `INTEGRIDADE_PDV.md`.


Para decidir **depois** da publicação da autenticação, em PRs distintos:
- **P1 (menor risco, alto ganho)**: na sincronização de vendas, o servidor busca os preços atuais dos produtos e rejeita/sinaliza divergências; valida `funcionario_id` ativo; grava o `usuario_id` da sessão na venda (exige migration aditiva: coluna nullable). Decidir política para vendas feitas offline com preço antigo (tolerância/aceitar com registro de divergência), para não perder vendas legítimas.
- **P2**: `select` explícito em `listarFuncionariosAlteradosDesde` sem `pin_hash` — **mas** isso quebra a validação de PIN offline; só junto de P3.
- **P3**: redesenhar PIN offline (ex.: hash com custo alto + salt por dispositivo, PIN mais longo, ou autorização offline limitada a vendas e operações sensíveis exigindo reconexão). É a "Fase 5 PIN local-first" já anotada no README.
- Cada uma exige testes próprios e validação de que a fila offline atual continua sincronizando.

---

## 8. O que **não** foi verificado
- Estado real do banco de produção (B1) e da existência de backups automáticos no plano do Railway.
- Entrega de e-mail real (Resend) e variáveis no Railway.
- Execução do roteiro pós-deploy.
- Testes de integração e de navegador **não** foram reexecutados nesta etapa; só leitura de código. Unitários, `tsc` e build foram executados na etapa anterior desta sessão (246/246, sem erros, build ok).
