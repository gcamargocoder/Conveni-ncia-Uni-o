# Autenticação e controle de acesso

Todo o sistema exige login (e-mail + senha). Não existe cadastro público e há uma
**única conta principal** de login (ativada por `/configurar-conta` ou pelo script `admin:criar`). O **PIN de 4 dígitos continua** sendo a identificação
do operador de caixa e a autorização de operações sensíveis (vender, ajustar
estoque, gerenciar funcionários) — o login de site é uma camada **a mais**, não
um substituto.

## Conta principal (regra de negócio)

A entrada do sistema é **uma conta principal com e-mail e senha**. A tela `/login` tem somente e-mail, senha (com botão mostrar/ocultar), **Entrar** e **Esqueci minha senha**; não há "Criar conta" nem cadastro público (garantido por `lib/auth/__tests__/sem-cadastro-publico.test.ts`). Os PINs, funcionários e permissões do PDV são independentes do login e não foram alterados.

**Provisionar a conta principal** (uma vez, por quem tem acesso ao banco; sem senha padrão no código, nas migrations ou no `.env.example`):
```
DATABASE_URL="<URL PÚBLICA do Postgres>" npm run admin:criar -- --email dono@suaempresa.com --nome "Nome do Dono"
```
A senha é pedida com digitação oculta, validada pela política (≥ 10 caracteres, letras e números) e gravada só como hash Argon2id. Uma segunda execução **recusa** enquanto existir um administrador ativo.

### Regra definitiva e limites da tela Usuários

- Existe **uma única conta de login**. **Nenhuma rota cria outras**: não há Server Action nem função de serviço de criação (a `criarUsuarioAction`, `criarUsuario` e o modal "Novo usuário" foram removidos — não só ocultados), nem rota de API, nem cadastro público. O único caminho de criação é o script de infraestrutura `admin:criar`, que agora **recusa criar uma segunda conta** (mesmo com `--forcar`; `--forcar` só recupera o acesso da conta cujo e-mail já existe).
- A tela `/usuarios` (só administrador) **não cria nada**. Serve para: ver a conta, **redefinir acesso** (encerra sessões e envia link de nova senha), ativar/desativar e mudar papel — úteis para tratar contas legadas. Se houver mais de uma conta, a tela mostra um aviso.
- **Contas de login ≠ funcionários/PINs.** Funcionários (tabela `funcionarios`, cargo + PIN) são operadores do PDV, geridos em **Funcionários** com a autorização por PIN; não têm e-mail/senha, não entram no sistema e **não foram alterados**. Vendas, PDV offline e permissões por cargo também não.
- **Contas adicionais já existentes** (por exemplo criadas antes desta regra): **não são apagadas** nem alteradas automaticamente. Tratamento seguro, feito pelo dono: (1) confirmar na tela quais são; (2) **desativar** as que sobrarem (encerra as sessões na hora; o histórico `vendas.usuario_id` é preservado); (3) apagar só se algum dia for realmente necessário, com backup. O sistema nunca remove o último administrador ativo.
- A conta única é imposta também no banco por um gatilho (`20260105000000_conta_unica_gatilho`, ainda **não aplicado em produção**); antes dele, a garantia era só o código da aplicação.

## Visão geral

| Camada | O que faz |
|---|---|
| `middleware.ts` (Edge) | Filtro barato: sem cookie de sessão → redireciona para `/login` (e `/api/*` → 401). **Não decide nada sozinho.** |
| `app/layout.tsx` + cada página | Validação real no servidor, contra o banco: `exigirSessao()` / `exigirAdmin()`. Cookie forjado ou sessão revogada → `/login`. |
| Toda Server Action | `verificarAcesso()` (ou `"admin"`) como primeira instrução. Sem sessão devolve um erro estruturado, sem tocar em dados. |
| Testes (`cobertura-guardas.test.ts`) | Falham se qualquer Server Action ou página privada nova não checar o acesso. |

Papéis: **`admin`** (usuários e backup, além do uso normal) e **`operador`** (usa
o sistema). Regras de negócio por cargo/PIN (`lib/auth/permissoes.ts`) não mudaram.

### Decisão: sessões próprias em vez de Auth.js / Better Auth
O Auth.js (Credentials) não oferece sessão em banco com revogação, nem bloqueio
progressivo persistente; o Better Auth imporia tabelas e fluxos próprios por
cima do schema existente. Optou-se por uma camada **fina** que só combina
primitivas consolidadas: **Argon2id** (`@node-rs/argon2`), **`crypto.randomBytes`**
(256 bits) e SHA-256 do token. Nenhuma criptografia é implementada à mão.

## Segurança implementada

- **Senhas:** Argon2id (19 MiB, 2 iterações), com salt; mín. 10 caracteres, letras e números, bloqueia senhas comuns e o e-mail dentro da senha. Máx. 128 (evita abuso de CPU).
- **Sessão:** token aleatório de 256 bits em cookie **`HttpOnly`**, **`SameSite=Lax`**, **`Secure`** em produção, com prefixo **`__Host-`** em produção. No banco fica só o **hash** do token. Expira por **12 h de inatividade** (renovável) e tem **teto absoluto de 7 dias**. Cada login gera um token novo (sem fixação de sessão). Logout apaga a sessão no servidor. Constantes em `lib/auth/constantes.ts`.
- **CSRF:** Server Actions do Next já validam `Origin`/`Host`; o cookie é `SameSite=Lax`; não há rotas `POST` próprias.
- **Força bruta (persistente, no banco — vale para todas as instâncias):** por **conta** (5 erros/15 min → bloqueio de 1 min, 5, 15, 60, 240 min) e por **IP** (20 erros/15 min → 5, 15, 60 min). O bloqueio vale também para e-mails inexistentes, a tentativa é reservada **antes** da senha e o contador é atômico (`SELECT … FOR UPDATE`; ver “Login e recuperação: contagem atômica”). Zera após 24 h sem tentativas. Código: `lib/auth/limitador.ts`, `services/auth/limitador.store.ts`.
- **Sem enumeração de contas:** mesma mensagem e mesmo custo de CPU para e-mail inexistente, senha errada e conta desativada; recuperação responde igual existindo ou não o e-mail e envia o e-mail em segundo plano.
- **Recuperação de senha:** token de 256 bits, **30 min**, **uso único** (consumo atômico), só o hash no banco, um link válido por vez, limite de 5 pedidos/h por IP e 3/h por e-mail. Ao redefinir: **todas as sessões do usuário são encerradas** e o bloqueio da conta é zerado. O link usa `APP_URL` (nunca o cabeçalho `Host`). A página usa `Referrer-Policy: no-referrer` e `no-store`.
- **Gestão de usuários** (`/usuarios`, só admin; **não cria contas**, ver "Regra definitiva"): ativar/desativar, mudar papel, **redefinir acesso** (encerra sessões + envia link de nova senha — a senha nunca passa pelo administrador). Desativar ou rebaixar encerra as sessões na hora. **Nunca** é possível remover o último administrador ativo (travado em transação, mesmo com requisições simultâneas) nem desativar o próprio acesso.
- **Cabeçalhos:** `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, HSTS (produção). *Não há CSP* (o Next injeta scripts inline); pode ser adicionada depois com nonce.
- **Logs:** nunca registram senhas, tokens, links de recuperação nem o corpo dos e-mails.

## Primeiro administrador (sem senha padrão, sem cadastro público)

O sistema nasce **sem nenhum usuário**. O primeiro admin é criado por um script
que exige acesso ao banco (ou seja, à infraestrutura):

```bash
# 1) aplique as migrations (já feito no start; ver "Deploy")
# 2) crie o administrador — a senha é pedida com digitação oculta:
DATABASE_URL="<URL PÚBLICA do Postgres do Railway>" npm run admin:criar -- --email voce@empresa.com --nome "Seu Nome"
```

- No Railway use a **`DATABASE_PUBLIC_URL`** do plugin Postgres (a URL interna `*.railway.internal` não é alcançável do seu computador). Prefira digitar a variável no terminal a salvá-la em arquivos.
- Em ambiente sem terminal interativo, informe a senha por `ADMIN_SENHA` e **apague-a** em seguida.
- O script **recusa** rodar se já existir um admin ativo. Para recuperar um acesso perdido (todos os admins bloqueados/esquecidos) use `--forcar`: ele redefine a senha do e-mail informado (ou cria), reativa, promove a admin e encerra as sessões antigas.
- Não há outras contas de login a criar: funcionários e PINs são cadastrados em **Funcionários**.

## Ativação inicial da conta principal (pelo próprio cliente)

Alternativa ao script `admin:criar` para o **primeiro acesso**, sem que o cliente precise de acesso ao banco. Reaproveita o Argon2id, a política de senha, o limitador persistente, o gerador de tokens e o serviço de e-mail (Resend) já existentes; não há segundo mecanismo de login.

**Autorização de inicialização.** A página `/configurar-conta` só funciona se o servidor tiver a variável de ambiente **`ATIVACAO_INICIAL_CODIGO`** (segredo, **mínimo 24 caracteres**, cadastrado no Railway e **nunca** no código ou no Git; gere com `openssl rand -base64 32` e entregue ao cliente por um canal separado do e-mail). Sem a variável, o fluxo está **desligado** e a página mostra apenas "não está disponível". A comparação é em tempo constante e as tentativas são limitadas por IP canônico (4 palpites por hora; depois bloqueio de 1 h, 4 h, 24 h), contadas de forma atômica no banco.

**Passo a passo**
1. O cliente abre `<APP_URL>/configurar-conta` (a tela de login **não** tem link para ela) e informa: código de inicialização, nome, e-mail, senha forte (política existente) e confirmação.
2. O servidor confere o código **antes de qualquer outra coisa**. Estando correto, grava um **pedido pendente** (`ativacoes_iniciais`: senha só como hash Argon2id; token só como SHA-256; validade de 30 min; um pedido por vez — o anterior é apagado junto com o link) e envia o link `…/ativar-conta?token=…` por e-mail.
3. O cliente abre o link e clica em **Ativar conta principal**. Abrir o link, por si só, não consome nada (evita que verificadores de e-mail “queimem” o token); só o clique (POST) ativa.
4. Numa transação com `pg_advisory_xact_lock` o servidor confere que **não existe nenhum usuário**, valida o token (existe, não usado, não expirado), cria a conta `admin`, apaga todos os pedidos. O fluxo se **encerra**: depois disso a página e as ações respondem “não está disponível”. Não há login automático: o cliente entra em `/login`.

**Garantias**
- Confirmar o e-mail **isoladamente não dá acesso**: o link só existe porque o código de inicialização foi aceito no passo 2, e é revalidado no passo 4 (se `ATIVACAO_INICIAL_CODIGO` for removida, links pendentes deixam de valer).
- **E-mail real é obrigatório**: sem `RESEND_API_KEY`, `EMAIL_FROM` e `APP_URL` nada é gravado, nenhum sucesso é simulado e a conta não é liberada; se o provedor recusar o envio, o pedido é invalidado.
- **Uma só conta**: confirmações simultâneas (mesmo token ou pedidos diferentes) criam no máximo uma conta; um pedido pendente não cria uma segunda se já existir usuário (inclusive criado pelo script).
- Nada é registrado em log: nem senha, nem token, nem link, nem o código.
- Depois de ativar: **remova `ATIVACAO_INICIAL_CODIGO` do Railway** (o fluxo já está encerrado, mas o segredo não tem mais utilidade).
- `npm run admin:criar` continua existindo como **recuperação** de acesso (`--forcar`) e como alternativa de infraestrutura; ambos recusam criar a segunda conta.

**Migrations:** `20260104000000_ativacao_inicial` e `20260105000000_conta_unica_gatilho` (ambas aditivas). **Limites:** a conta única também é imposta no PostgreSQL por gatilho (ver “Revisão de segurança”), que o dono do banco ainda pode desabilitar. O envio real de e-mail **ainda não foi testado** com a Resend: os testes usam envio simulado/`fetch` falso.

### Revisão de segurança da ativação inicial (resultado)

Falhas **comprovadas por teste que falhava antes da correção** e foram corrigidas:

| # | Falha | Correção |
|---|---|---|
| 1 | O limite de tentativas do código era “conferir bloqueio → avaliar → contar”: uma rajada de 40 palpites simultâneos tinha 39 avaliados (o limite é 5). | A tentativa é **contada antes** de conferir, no contador travado com `FOR UPDATE`: só as que ficam abaixo do limite são avaliadas (a 5ª dispara o bloqueio, mesmo se certa → na prática 4 palpites por hora). O limite de e-mails (3/h) usa o mesmo padrão. |
| 2 | A chave do contador era o texto cru do IP: `203.000.113.050`, `::ffff:203.0.113.50`, `203.0.113.50:80` ou espaços criavam contadores separados; em IPv6, trocar o sufixo dava contador novo a cada pedido. | `lib/auth/ip.ts` (`normalizarIp`): IPv4 canônico (sem zeros/porta/mapeamento) e IPv6 reduzido ao prefixo **/64**. Ilegível → um único contador “desconhecido” (falha fechada). |
| 3 | Pedidos não concluídos (e-mail não saiu, substituídos, ou já ativados) deixavam o **hash Argon2id da senha** na tabela `ativacoes_iniciais`. | Pedidos são **apagados** (substituição, falha de envio, ativação). A tabela fica vazia depois da ativação; “uso único” passa a ser “o pedido deixa de existir”. |
| 4 | Um erro inesperado nas ações públicas subia sem tratamento (a mensagem do Prisma pode trazer `senha_hash`/e-mail para o log do servidor). | As 3 ações capturam o erro, registram só o **nome** do erro e devolvem texto genérico. |
| 5 | `/ativar-conta` (token na URL) não tinha `Cache-Control: no-store` nem `Referrer-Policy: no-referrer`, ao contrário de `/redefinir-senha`. | `next.config.ts` aplica ambos a `/redefinir-senha`, `/ativar-conta` e `/configurar-conta`. |

**Verificado, sem falha:** expiração (30 min), uso único (reutilizar falha; 8 confirmações simultâneas → 1 conta), pedido novo invalida o anterior, falha de envio não libera nada, remoção do código de inicialização invalida links pendentes, e-mail não configurado não grava nada, e **nenhuma** resposta/log contém senha, token, link ou código (só o status HTTP do provedor).

**Código inicial após a ativação:** deixa de ser necessário e de ter efeito — `situacaoAtivacao()` devolve “encerrada” enquanto existir **qualquer** linha em `usuarios` (inclusive desativada). A recuperação de senha só atualiza `senha_hash` da conta existente e não toca `ativacoes_iniciais`; testado: recuperar a senha ou desativar a única conta **não reabre** o cadastro. Mesmo assim, **remova `ATIVACAO_INICIAL_CODIGO`** do Railway. Único caso em que o fluxo reabre: a tabela `usuarios` ficar vazia (ex.: restaurar um backup em banco vazio) com a variável ainda presente — outro motivo para removê-la.

**Conta única no PostgreSQL.** Migration `20260105000000_conta_unica_gatilho` (aditiva: só cria a função e o gatilho `usuarios_conta_unica`; **não lê nem altera linhas**; **não aplicada em produção**). `BEFORE INSERT` em `usuarios`: toma o lock de aviso `7310042` (o mesmo da ativação, o que serializa inserções simultâneas) e recusa (`23514`, “Conta única…”) se já existir alguma linha. Cobre SQL direto, `createMany` e inserções concorrentes (testado: 8 simultâneas → 1). Não impede `UPDATE` (recuperação, desativação), `DELETE` nem o fluxo normal. Alternativas descartadas: índice único em expressão constante (quebraria bancos que já tenham mais de uma conta) e `CHECK` (não enxerga outras linhas). Limites: o dono do banco pode desabilitar o gatilho (`ALTER TABLE … DISABLE TRIGGER`) ou apagar a conta antes de inserir outra; quem já tiver contas adicionais continua com elas (o gatilho só barra novas). Nos testes de integração o gatilho fica **desligado por padrão** (`vitest.integracao.setup.ts`, pois as fixtures criam vários usuários) e é religado nos testes da própria trava.

**Riscos que permanecem:** (a) o código de inicialização tem só **mínimo de 24 caracteres**; a aleatoriedade depende de quem o gera (use `openssl rand -base64 32`); (b) o limitador é por IP — um atacante com muitos IPs distribuídos não é contido por ele (a proteção é a entropia do código); (c) a contagem atômica e a normalização de IP agora também valem para login e recuperação (seção seguinte); o limitador de **PIN** não foi alterado; (d) o envio real de e-mail **continua não testado**.

### Login e recuperação: contagem atômica, IP confiável e falhas internas (revisão)

Falhas **comprovadas** (12 testes falhavam antes da correção) e corrigidas:

| # | Falha | Correção |
|---|---|---|
| 1 | Login e recuperação seguiam “conferir bloqueio → agir → contar”: 40 senhas erradas simultâneas na mesma conta eram **todas avaliadas**; 30 pedidos simultâneos de recuperação enviavam 30 e-mails (limite: 3/h). | `reservarTentativa` (`services/auth/limitador.store.ts`): a tentativa é **reservada antes**, com a linha do contador travada (`FOR UPDATE`). Toleram-se exatamente os limites documentados (5 por conta, 20 por IP, 3 e-mails/h por conta, 5/h por IP, 10 tokens inválidos/h por IP); a seguinte já é barrada. Requisições que chegam durante um bloqueio são recusadas **sem contar** (uma rajada não escala o bloqueio). Login bem-sucedido **devolve** a tentativa do IP (só falhas consomem o limite) e zera a da conta; senha fraca com token válido também devolve. |
| 2 | O IP do limitador era o texto cru do cabeçalho (zeros à esquerda, `::ffff:`, porta, sufixo IPv6 davam contadores novos). | `normalizarIp` aplicado dentro de `autenticar`, `solicitarRecuperacao` e `redefinirSenha` (as chaves nunca recebem o texto cru). IPv6 → prefixo /64. |
| 3 | `obterIp` aceitava o **primeiro** item de `x-forwarded-for`, que o cliente pode forjar. | `ipDoCliente`/`obterIpConfiavel`: `x-real-ip` (definido pelo proxy) → **último** item de `x-forwarded-for` (o acrescentado pelo proxy) → “desconhecido” (um único contador compartilhado: falha fechada). Usado por login, recuperação, redefinição e ativação. O limitador de **PIN** continua com `obterIp`, sem alteração. |
| 4 | Erros inesperados em `loginAction`/`redefinirSenhaAction`/`solicitarRecuperacaoAction` subiam sem tratamento (mensagens do Prisma/driver podem trazer hash, token ou texto do banco ao log). | As ações capturam o erro, registram só o **nome** e devolvem texto genérico (“Não foi possível concluir a operação agora”, distinto de “senha incorreta”). A recuperação responde com a **mesma** mensagem de sempre mesmo se falhar por dentro, para a falha não virar oráculo de existência da conta. |

**Mudança de semântica (intencional):** a contagem agora acontece antes da verificação, então “5 erros” significa “5 tentativas avaliadas; a 6ª já é barrada e dispara o bloqueio” (antes: o bloqueio começava ao registrar o 5º erro). Para o usuário legítimo o efeito é o mesmo; o bloqueio só começa uma tentativa depois.

**Sem enumeração:** o contador da conta usa o hash do e-mail e é contado igualmente para e-mails inexistentes; a resposta e o custo de CPU são os mesmos; a recuperação é contada para qualquer e-mail válido e responde igual (existente, inexistente, limitado, falha interna).

**Pendente de validação operacional (não verificável localmente):** a premissa de que o proxy do Railway **sobrescreve `x-real-ip`** (ou, na falta dele, **anexa** a origem ao final de `x-forwarded-for`). Teste na implantação: `npm run sonda:ip` (`scripts/sonda-ip.ts`, ver `PRE_PUBLICACAO_RAILWAY.md` §4.1) faz tentativas de login fictícias com `X-Real-IP`/`X-Forwarded-For` forjados e lê as chaves `login:ip:*` gravadas para dizer se o IP usado é o real ou o forjado (validada localmente em 4 cenários de proxy; **ainda não executada no Railway**). Se o proxy repassar `x-real-ip` do cliente sem sobrescrever, o limite **por IP** é contornável; a proteção por **conta** (hash do e-mail) continua valendo. O limitador por IP também não contém ataques distribuídos por muitos IPs.

### Cobertura de autenticação (verificação por HTTP real)

Verificado contra o build de produção (`next start`, banco de teste), **sem cookie**: as 18 páginas privadas (incl. `/`, `/pdv/cupom/<id>`, `/pin`, `/usuarios`, `/backup`, `/vendas-revisao`) respondem 307 para `/login`; `/api/*` responde 401; só `/login`, `/recuperar-senha`, `/redefinir-senha`, `/offline`, `/configurar-conta`, `/ativar-conta` (e os estáticos `/sw.js`, `/manifest.webmanifest`, ícones e logos) respondem 200. Cabeçalhos forjados (`x-pathname: /login`, `x-middleware-subrequest`, `next-action` em GET, `RSC`, `x-nextjs-data`), métodos POST/PUT sem cookie e cookie de sessão inválido **não** abrem nenhuma rota (cookie inválido é recusado pelo layout, contra o banco). As 42 Server Actions do build foram chamadas por POST direto, sem sessão, com o `next-action` real: as 33 não públicas devolvem “sessão expirou”/`ok:false`/`null` (ou erro 500 sem dados em `buscarAlteracoesCatalogoAction`, que lança por desenho); as públicas por natureza são só as de entrar/sair/recuperar senha/ativação. **Nenhuma falha de acesso não autenticado foi encontrada**, então nenhum código de produção foi alterado nesta verificação.

Regressão automática (`lib/auth/__tests__/cobertura-rotas.test.ts`): o middleware é exercitado para **toda `page.tsx` existente** (a lista vem do disco, não é escrita à mão — uma página nova pública sem entrar em `ROTAS_PUBLICAS` quebra o teste); proíbe `route.ts` em `app/`; garante que todo arquivo `"use server"` está em `lib/**` e só exporta `export async function` (arrow/`const`/`default` escapariam da checagem estática de guards).

**Validar no ambiente publicado** (não verificável localmente): (1) repetir os `curl` sem cookie nas rotas privadas após o deploy e conferir 307/401; (2) confirmar o cabeçalho `x-real-ip` do proxy (ver acima); (3) abrir `/configurar-conta` e `/ativar-conta` só enquanto a ativação estiver em andamento; (4) em aparelho real com o PWA instalado: após o deploy, conferir que o SW `v4` assumiu (`caches.keys()` sem `-v2`/`-v3`) e que, deslogado/offline, nenhuma tela privada além da casca do PDV abre (ver “Service worker e dados privados”).

### Service worker e dados privados (verificação + correção; atualizado para a v4)

**Exposição comprovada (Chrome real, roteiro fora do repositório, no scratchpad da sessão, service worker `v2`):** o SW guardava no cache toda navegação (HTML) e toda requisição GET interna — inclusive as respostas RSC de navegação, que carregam dados do negócio — de `/clientes`, `/estoque`, `/contas-receber`, `/funcionarios`, `/historico`, `/dashboard`… (89 entradas privadas após uma sessão normal). O logout normal limpava o cache (mensagem `LIMPAR_CACHES`), mas isso é melhor esforço: com a **sessão expirada ou encerrada fora do aparelho** (sem passar pelo botão Sair — expiração de 12 h/7 d, conta desativada, logout em outro aparelho), um aparelho **offline** continuava exibindo os dados do cliente a partir do cache, sem cookie de sessão. Outro defeito achado no caminho: `/favicon.ico` (inexistente, 404 com sessão) fazia o `addAll` do pré-cache falhar, e depois do login/logout o aparelho ficava **sem a tela `/offline`**.

**Correção (`public/sw.js` v3→v4, impacto mínimo):** a segurança não depende mais de limpar o cache — dados privados simplesmente não são guardados.
- Só documentos HTML de **`/pdv`, `/pin` e `/sincronizacao`** (o HTML deles não traz dados do negócio; catálogo, carrinho e fila vêm do IndexedDB) são guardados e servidos offline, indexados só pelo caminho, nunca se forem redirecionados (sessão expirada → `/login`) e por no máximo **72 h** (mesmo teto do uso offline do cliente).
- Qualquer outra página offline cai na tela de fallback estática `/offline.html` (ver abaixo); requisições RSC e demais GET internos passam direto para a rede (não são guardados nem servidos). Continuam em cache: chunks `/_next/static`, ícones/imagens, manifest e `/_next/image` (públicos).
- Pré-cache item a item (a falha de um não derruba os demais); `v2` é apagado na ativação, o que **purga os dados privados já guardados** nos aparelhos existentes.
- O SW nunca toca no IndexedDB: **vendas pendentes e a fila de sincronização ficam intactas** (testado por inspeção do código e em Chrome).
- Verificado em Chrome: logout → offline sem dado; sessão apagada no servidor (online e offline) sem dado; `/pdv` abre offline com sessão válida; navegação interna offline `/sincronizacao` → `/pdv` funciona (cai em navegação completa). Testes: `lib/auth/__tests__/service-worker-cache.test.ts` executa o `sw.js` real com `caches`/`fetch` simulados.

**Identidade fora do HTML guardado (service worker `v4`).** O layout raiz serializa a pessoa logada (id, nome, e-mail, papel e validade da sessão) no HTML de **toda** página — inclusive `/pdv` e a rota `/offline`, que no pré-cache da `v3` também guardava o nome e o e-mail de quem estava logado (achado na verificação do conteúdo real do cache; o pré-cache agora usa o arquivo estático descrito abaixo). Agora o que vai para o cache é sempre uma **cópia neutra**: o service worker a pede à parte (cabeçalho `x-pagina-neutra: 1`), o layout omite os dados da sessão e o middleware confirma com o mesmo cabeçalho; sem a confirmação, nada é guardado (falha fechada), e uma entrada guardada sem a marca nunca é servida. A página entregue ao usuário online continua a normal (com o nome no menu). Offline, a interface obtém nome e papel (**nunca o e-mail**) do marcador local `sessao_offline_v1` — o mesmo que já existia, agora com o papel — que o logout apaga; sem marcador, não aparece identidade. A proteção não depende da limpeza do cache: logout, sessão expirada, revogação em outro aparelho e troca de usuário deixam o mesmo HTML neutro, sem dado de ninguém. Verificado no Chrome real lendo **todas** as entradas do cache (corpo e cabeçalhos): nenhum nome, e-mail, id ou papel de A ou de B após login, logout, troca de usuário e revogação; o IndexedDB do aparelho (fila de vendas) permaneceu intacto.

**Tela offline estática (`public/offline.html`).** Reproduzido no build de produção: a rota React `/offline` aberta sem rede mostrava “Application error” — causa real: o chunk de JavaScript da página (`app/offline/page-<hash>.js`) e o `/_next/image` do logo nunca estavam em cache (só existem se a tela tiver sido visitada online, e o hash muda a cada build), e a página ainda hidrata dentro do layout raiz. O fallback do service worker passou a ser um **arquivo estático autossuficiente** (HTML + CSS + script inline, sem Next.js, sem `/_next`, sem fontes externas), pré-cacheado junto com o logo e os ícones; não tem identidade nem dados de negócio, então não precisa de cópia neutra. Só lê o IndexedDB (contagem de pendentes da fila, somente leitura, e só se o banco já existir) e volta ao PDV quando a conexão retorna. `/offline.html` está fora do middleware (precisa abrir sem sessão). A rota `/offline` do app continua existindo, mas não é mais usada como fallback. Verificado no Chrome: sem sessão e com sessão, offline em `/clientes` e em `/offline` → tela renderizada, logo carregado, sem erro de JavaScript, contagem da fila correta, IndexedDB e fila intactos, e retorno automático ao PDV; o PDV offline legítimo continua abrindo.

**Risco residual:** quem tem posse física do aparelho ainda alcança o IndexedDB e o `localStorage` do navegador (nome e papel no marcador; PINs de caixa/frentista, fila de vendas — §6.2 de `PRE_PUBLICACAO_RAILWAY.md`). A casca guardada de `/pdv` não contém identidade nem dados de vendas, estoque, clientes ou funcionários. Aparelhos reais (Android/iOS, PWA instalado) não foram testados.

**Ativação inicial encerrada (verificação por HTTP real, build de produção):** com conta existente e `ATIVACAO_INICIAL_CODIGO` ainda configurada, `/configurar-conta` mostra só “não está disponível” e a ação de solicitar responde o mesmo; um link antigo/pendente mostra “inválido… ou a configuração inicial foi encerrada” e a ação de confirmar é recusada. Sem contas e **sem o código**, tudo responde “não está disponível”; com o código mas sem e-mail configurado, nada é gravado. Ajuste: se a conta nasceu por outro caminho (script) enquanto havia um pedido pendente, o pedido (e o hash de senha dele) é **descartado** assim que o fluxo é consultado ou o link é aberto.

## E-mail (recuperação de senha)

Não havia provedor de e-mail no projeto. Foi integrada a API HTTPS da **Resend**
(`lib/email/enviar.ts`; o Railway bloqueia SMTP de saída em planos básicos).

1. Crie uma conta na Resend, **verifique o domínio** do remetente e gere uma API key.
2. No Railway, cadastre: `RESEND_API_KEY`, `EMAIL_FROM` (ex.: `Conveniência União <nao-responder@seudominio.com.br>`) e `APP_URL` (URL pública do app, sem barra final).
3. Teste: peça a recuperação de senha de um usuário real em `/recuperar-senha`.

Sem essas variáveis o sistema **não simula envio**: o pedido responde normalmente
ao usuário (sem revelar nada), registra um erro no log do servidor (sem dados
sensíveis) e a tela **Usuários** exibe um alerta. Em produção, sem `APP_URL`
nenhum link é gerado.

## Autenticação × modo offline (Offline First)

O PDV continua funcionando sem internet. Como as duas coisas convivem:

- A **fila de vendas** (IndexedDB) não depende da sessão para ser gravada. Ao sincronizar, o servidor exige sessão válida. Se ela expirou, a venda **continua na fila, sem contar tentativa nem aumentar o atraso**; o worker pausa e retoma sozinho após novo login (`requerLogin` em `sincronizarVendaAction`). Uma exceção inesperada no envio agora vira falha comum (antes poderia prender o item em "sincronizando").
- **Limites de uso offline** (`lib/auth/sessao-offline.ts`, tela `GuardaSessao`): um aparelho já autenticado segue operando o PDV sem conexão por até **72 h desde a última validação online** (ajustável com `NEXT_PUBLIC_SESSAO_OFFLINE_HORAS`) e nunca além do teto absoluto da sessão (7 dias). Passado o prazo, ou sem marcador (logout, dados do navegador apagados), o PDV é bloqueado com pedido para reconectar — a fila de vendas é preservada. Online, a sessão é revalidada a cada 5 min, ao reconectar e ao voltar para a aba; se o servidor disser que ela acabou (expirou, foi revogada ou o usuário foi desativado), o acesso é encerrado **imediatamente**.
- O marcador local guarda só `usuarioId`, nome e horários — **nunca senha, token ou hash**. Nenhuma senha vai para o IndexedDB.
- **Logout** apaga o marcador, esvazia os caches do service worker (que guardavam páginas com dados do negócio) e **não** apaga a fila de vendas. Se for feito offline, fica "pendente" e o servidor é avisado assim que houver conexão.
- O service worker (`public/sw.js`, `v4`) só guarda `/pdv`, `/pin` e `/sincronizacao` (sem dados do negócio) além dos arquivos estáticos; nunca respostas redirecionadas nem dados privados (ver “Service worker e dados privados”). O cache ainda é limpo no login/logout, mas a segurança não depende disso.

### Limites conhecidos (leia antes de publicar)
1. O bloqueio offline do PDV é uma **barreira de interface**, não de segurança: quem controla o aparelho pode adulterar o `localStorage`. A segurança real está no servidor — nada offline é aceito sem sessão válida na sincronização.
2. Uma conta desativada continua podendo operar **localmente** em aparelhos offline por até 72 h (até a próxima validação). Reduza `NEXT_PUBLIC_SESSAO_OFFLINE_HORAS` se isso for inaceitável.
3. ~~As vendas da fila registram só o funcionário (PIN)~~ **Corrigido** (ver `INTEGRIDADE_PDV.md`): a venda grava também `usuario_id` (login) e o servidor confere preços, quantidades e funcionário antes de aceitar.
4. **PIN offline — reduzido, não eliminado** (ver `INTEGRIDADE_PDV.md`): o `pin_hash` saiu do catálogo; só caixa/frentista (cargos que apenas vendem) têm verificador no aparelho, e gerente/proprietário validam no servidor. Os hashes restantes (PIN de 4 dígitos) ainda são quebráveis offline por quem controlar o navegador.
5. O limite por conta pode ser usado por um atacante para **travar temporariamente** uma conta conhecida (compromisso inerente); o limite por IP e o desbloqueio automático/por redefinição de senha mitigam.

## Deploy no Railway

Variáveis do serviço do app: `DATABASE_URL` (`${{Postgres.DATABASE_URL}}`), `APP_URL`, `RESEND_API_KEY`, `EMAIL_FROM`.

Migrations Prisma (aditivas). `20260102000000_autenticacao` **só cria** `usuarios`, `sessoes`, `tokens_recuperacao` e `limites_tentativa`. `20260103000000_integridade_vendas_pdv` cria `vendas_revisao` e adiciona a coluna **nullable** `vendas.usuario_id` (nenhuma linha existente é alterada ou apagada):

```bash
npm run db:migrate        # = prisma migrate deploy (já roda no "npm start")
```

Passo a passo seguro:
1. Faça backup do banco de produção (tela Backup do sistema ou `pg_dump`).
2. Configure as variáveis acima no Railway.
3. Publique. O start executa `prisma migrate deploy`, que aplica `20260102000000_autenticacao` e `20260103000000_integridade_vendas_pdv`.
4. Crie o primeiro administrador (seção acima) e entre em `/login`.
5. Cadastre os demais usuários, teste a recuperação de senha e a saída (logout).

> Atenção: **a partir desta versão todo acesso exige login.** Antes do passo 4, ninguém consegue entrar no sistema (nem as telas), por desenho.

## Testes

```bash
npm test                 # unitários (sem banco): senha, limitador, middleware, offline, cobertura de guardas...
npm run test:integracao  # exige TEST_DATABASE_URL (banco descartável terminado em _test)
```

Os testes de integração rodam contra um PostgreSQL real e cobrem login, bloqueio,
expiração, logout, recuperação (expirado, reutilizado, simultâneo), autorização
admin/operador/anônimo, último administrador e a fila offline sem sessão. O setup
**recusa** qualquer banco cujo nome não termine em `_test`.
