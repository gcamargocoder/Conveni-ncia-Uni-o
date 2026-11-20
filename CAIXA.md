# Controle de caixa

Módulo de abertura, movimentação, conferência e fechamento de caixa, integrado ao PDV, às contas a receber e
à arquitetura offline-first. Complementa `OFFLINE_FIRST_ARCHITECTURE.md`, `INTEGRIDADE_PDV.md` e
`AUTENTICACAO.md`. Código: `lib/caixa/`, `services/caixa*.service.ts`, `services/offline/caixa-local.service.ts`,
`components/caixa/`, `app/caixa/`.

## 1. Conceito

- **O caixa pertence ao TERMINAL** (o aparelho/navegador, identificado pelo `dispositivo_id` local), não a um
  funcionário. Vários funcionários movimentam o mesmo caixa; **cada operação guarda o funcionário que digitou
  o PIN naquele momento** e isso nunca muda depois.
- Um terminal tem **no máximo um caixa aberto** — garantido no aparelho (transação do IndexedDB) e no banco
  (índice único parcial `caixas_um_aberto_por_terminal`). Terminais diferentes têm caixas independentes.
- Valores são **inteiros em centavos** em todo o módulo (nunca ponto flutuante). Reais só aparecem na tela.
- Movimentações são **registros imutáveis**. Correção = novo registro de estorno ou ajuste.
- Os ids (caixa, movimentos, operações) são UUIDs gerados no aparelho; é isso que torna a sincronização
  idempotente.

### Quatro grandezas que NUNCA se misturam

| Grandeza | O que é |
|---|---|
| **Total de vendas** (faturamento) | Soma das vendas (inclui fiado), líquida de estornos de venda |
| **Total recebido** | O que de fato entrou (vendas + recebimentos de conta), **sem fiado**, líquido de estornos |
| **Saldo físico de dinheiro** | Fundo + entradas em dinheiro − saídas em dinheiro (o que deve haver na gaveta) |
| **Líquido previsto de cartão** | Bruto − taxas **conhecidas** (uma previsão; nunca é faturamento) |

## 2. Identificação por PIN (preservada)

O sistema continua identificando **funcionários** pelo PIN individual — não há login por senha para frentistas
e atendentes, e o usuário administrativo autenticado não substitui o PIN.

- Toda operação do caixa (abrir, vender, fechar, suprimento, sangria, despesa, ajuste, estorno) pede o PIN
  **a cada vez** (`IdentificacaoPinModal` → `validarPinParaOperacao`, a mesma função do PDV parametrizada por
  permissão). O PIN não é guardado nem enviado depois.
- **Online** o servidor valida o PIN, o cargo, o bloqueio por tentativas (mesmo `validarPinAction`).
- **Offline** vale o mecanismo local existente (hash só de cargos que apenas vendem). Não foi criado outro mecanismo
  e nenhum hash novo vai ao navegador.
- Na **sincronização** o servidor **revalida** o funcionário: existe, está ativo e o cargo tem a permissão. O PIN
  nunca viaja na fila — vai o `funcionario_id`. **O servidor não consegue provar qual PIN foi digitado numa
  operação offline**; ele confere apenas que o funcionário informado existe, está ativo e pode fazer aquilo.
- A auditoria distingue: **funcionário (PIN)**, **usuário administrativo (login)**, **terminal** e **origem
  online/offline** (colunas `funcionario_id`, `usuario_id`, `dispositivo`, `origem` em `movimentos_caixa` e
  `auditoria_caixa`).

## 3. Permissões

| Operação | Permissão | Quem (cargo) | Offline? |
|---|---|---|---|
| Abrir caixa, vender, **fechar caixa** | `pdv.vender` | proprietário, gerente, caixa, frentista | sim (PIN local) |
| Suprimento, sangria, despesa, ajustes, estorno de movimento | `caixa.movimentar` | proprietário, gerente | **não** (PIN de gerente nunca sai do servidor) |
| Cancelar venda (estorno de venda) | `pdv.cancelar_venda` | proprietário, gerente | **não** |
| Reabrir caixa fechado | `caixa.reabrir` **+ login admin** | proprietário, gerente (PIN) | não |
| Conferir divergência | `caixa.consultar` **+ login admin** | proprietário, gerente (PIN) | não |
| Histórico, relatórios, conflitos | login com papel `admin` | administrador | não |

**Autorização no servidor das operações administrativas.** Sangria, suprimento, despesa, ajuste e estorno
NÃO aceitam o `funcionario_id` do aparelho como prova. Ao confirmar o PIN, o aparelho chama
`autorizarOperacaoCaixaAction`: o servidor valida o PIN e o cargo e grava uma autorização
(`autorizacoes_caixa`) presa à **operação** (o id da autorização é o id da operação), ao **funcionário**, à
**permissão**, ao **login** e aos **valores** (caixa, tipo, valor, alvo do estorno).

- **Quem cria:** somente `autorizarOperacaoCaixaAction` (Server Action), depois de sessão válida, escopo validado
  (UUIDs, tipo avulso, centavos inteiros positivos, estorno com venda OU movimento, caixa não fechado), PIN válido,
  funcionário ativo e permissão `caixa.movimentar` / `pdv.cancelar_venda` (só proprietário/gerente). Não há outra
  rota: `services/caixa.service.ts` não é Server Action e o cliente não grava a tabela.
- **Validade: 12 horas** (era 30 dias). A autorização nasce ONLINE no momento do PIN e a sincronização vem logo em
  seguida; 12 h cobrem um turno com rede instável. Vencida, a operação não é aplicada: vira conflito preservado
  para o administrador tratar.
- **Uso único e atômico:** dentro da transação que grava a movimentação/estorno (com o caixa travado), um
  `UPDATE … WHERE id, funcionário, login, permissão, escopo, consumida_em IS NULL, expira_em > agora` marca
  `consumida_em`. Só uma transação consegue; se a operação falhar, a transação volta e a autorização continua
  valendo. Depois de consumida, um gatilho do banco proíbe alterá-la, reabri-la ou apagá-la.
- **Idempotência:** reenvio (ou 10 envios simultâneos) da mesma operação devolve `jaExistia` sem duplicar e sem
  consumir de novo. Operação com outro id não reaproveita a autorização.
- **Divergência** (valor/tipo/alvo trocado, outro funcionário, outro login, expirada, ausente, já usada) vira
  conflito preservado (`caixa_conflitos`), nada é gravado no caixa.
- **Queda de conexão:** o modal só executa a operação depois que o servidor confirma a autorização; sem resposta,
  mostra erro e nada é registrado nem anunciado. O id da operação é o mesmo na nova tentativa (a autorização ainda
  não usada é renovada), então repetir não duplica. Se a autorização foi emitida e a resposta se perdeu, ela só
  expira sem efeito.
- Só abrir, vender e fechar (`pdv.vender`) aceitam o funcionário informado offline, conforme a regra do PIN offline.

> **Decisão registrada:** as permissões de caixa/frentista **não** foram ampliadas, porque `cargoPodeUsarPinOffline`
> só replica o hash do PIN de cargos cuja única permissão é vender. Dar a eles sangria/suprimento tiraria o PIN
> offline deles — ou exigiria replicar o PIN de quem pode mais. Consequência: sem internet, o operador abre,
> vende e fecha; sangria, suprimento e estorno esperam a conexão. **Se o negócio quiser sangria offline por
> operador, é uma decisão comercial** (e de segurança) a tomar à parte.

Todas as Server Actions validam sessão e papel no servidor (o teste `cobertura-guardas` garante); valores
financeiros enviados pelo navegador nunca são aceitos sem recálculo/conferência.

## 4. Abertura

Tela `/caixa`: fundo de troco (dinheiro físico no início do expediente, **não é venda**), observações e **PIN
como confirmação explícita**. Registra: id, terminal, papel do terminal, hora (relógio do terminal), funcionário
que abriu, usuário logado, origem. Funciona offline: o caixa nasce no aparelho (`abertura_sincronizada=false`) e
a abertura vai à fila.

Abertura duplicada: bloqueada no aparelho; se o servidor já tiver caixa aberto naquele terminal (ex.: dados do
navegador apagados), a abertura vira **conflito preservado** (§9) — nada é descartado.

## 5. Movimentações

Tipos (`movimentos_caixa.tipo`): `venda`, `recebimento_conta`, `suprimento`, `outra_entrada`, `ajuste_entrada`,
`sangria`, `despesa`, `outra_saida`, `ajuste_saida`, `estorno`.

- **Venda**: um lançamento **por forma de pagamento** (pagamento dividido gera várias linhas; a soma tem de
  fechar o total, conferida no aparelho e no servidor). A venda e seus lançamentos são gravados **na mesma
  transação**; (venda, tipo, ordem) é único → nunca duplica.
- **Fiado**: vira lançamento de forma `fiado` (conta no faturamento, **não** em recebido, entradas nem dinheiro).
  A conta a receber nasce só com a **parcela fiada**. O recebimento da conta entra no caixa **somente quando
  efetivamente recebido** e se houver caixa aberto no terminal que o registrou; senão fica só na conta
  (a tela avisa). Esse lançamento nasce **no servidor** (a conta é paga online); o aparelho o incorpora ao caixa
  local por leitura (`recebimentosDoCaixaAction`, ao abrir a tela, a cada 20 s, ao voltar a conexão e antes de abrir a
  conferência do fechamento), sem criar operação na fila. Offline, mostra o que já incorporou: um recebimento feito
  por outro aparelho em instantes antes só aparece quando houver conexão.
- **Suprimento/sangria/despesa/ajustes**: sempre em **dinheiro**, exigem valor > 0, **motivo** e responsável.
  A sangria/despesa não pode superar o dinheiro esperado no caixa (checagem no aparelho).
- **Estorno/cancelamento**: lança o movimento inverso (um por forma) apontando para o original (`estorno_de_id`,
  único: não estorna duas vezes), exige motivo. Cancelar uma venda também marca `vendas.cancelada = true`.
  O estorno só vale **dentro do caixa aberto ao qual o lançamento original pertence** (a fronteira é o caixa/turno,
  não a data do calendário): o aparelho só oferece estorno do caixa atual e o servidor **recusa** estorno de
  lançamento de outro caixa (já fechado), com a mensagem "O lançamento pertence a outro caixa. Reabra aquele caixa…",
  sem lançar nada e **sem consumir a autorização** (a transação volta). Estorno em caixa fechado também é recusado
  (conflito preservado). Não se estorna estorno nem se estorna duas vezes. Vendas com **qualquer parte em fiado**
  não são estornadas pelo caixa: a interface esconde o botão e mostra "Venda com fiado: tratar na conta a
  receber"; se o pedido chegar ao servidor, ele recusa ("…parte em fiado não podem ser estornadas pelo caixa…") e
  nada muda (venda, conta a receber e autorização intactas). O estorno financeiro **não devolve estoque**.
- **Cartão**: bandeira, operadora, parcelas, taxa **conhecida** (nulo = desconhecida, nunca presumida) e id da
  transação, quando informados. O valor bruto é o do movimento.
- O banco impõe (CHECKs): valor > 0, sentido/tipo/forma válidos, movimentos avulsos só em dinheiro e com
  explicação, taxa ≤ valor.

## 6. Fechamento e conferência

Tela `/caixa` → **Fechar caixa**: o resumo é automático (mesma função pura `resumirCaixa` no aparelho e no
servidor) e a conferência é por forma:

- **Dinheiro**: fundo, vendas, recebimentos, suprimentos, sangrias, despesas, saldo esperado, **valor contado**,
  diferença.
- **Pix**, **crédito**, **débito**: total registrado, quantidade, total informado, diferença; cartões mostram
  taxas conhecidas e líquido previsto em campos **separados**.
- **Fiado**: total a prazo (informativo).

Regras: dinheiro contado é obrigatório; Pix/cartão com movimento exigem o total informado; **qualquer
diferença exige justificativa**; o fechamento exige **confirmação explícita** (caixa de seleção + PIN).
Registra quem abriu e quem fechou (PIN e login), data/hora, origem. Depois de fechado o caixa **não aceita
movimentações** (aparelho, aplicação e gatilho do banco). O servidor **recalcula o resumo oficial** a partir dos
movimentos que ele tem e guarda também o resumo do aparelho; se diferirem, isso fica na auditoria.

Status exibidos (`statusExibicao`): **Aberto**; **Fechamento pendente de sincronização** (fechado só no aparelho —
nunca aparece como confirmado); **Aguardando conferência** (fechado no servidor com diferença, sem revisão do
administrador); **Com divergência** (diferença já revisada); **Fechado**.

**Contrato do fechamento**: a resposta do servidor ao aparelho traz `{ resumo, diferencas }`, onde `diferencas` é a
**lista por forma de pagamento** (`[{ forma, esperado_centavos, informado_centavos, diferenca_centavos }]`) — o mesmo formato
gravado em `caixas.resumo_fechamento.diferencas` e guardado em `caixas_locais.diferencas_local`. (Um erro nesse
contrato derrubava a tela depois do fechamento online; há teste de regressão.)

**Procedimento de conferência (administrador)**: `/caixa/historico` → aba *Divergências* → *Conferir* → ler
resumo, movimentos e auditoria → observação + PIN de proprietário/gerente → o caixa passa a *Com divergência*
(registrado, não apagado).

**Reabertura excepcional**: só login `admin` **+** PIN de proprietário/gerente **+** justificativa (≥ 10
caracteres). A auditoria guarda o fechamento anterior inteiro; `reaberturas` é incrementado; o gatilho do banco
impede reabrir por `UPDATE` direto. Se a venda retida estava num caixa já fechado, a aprovação é recusada com a
orientação de reabrir o caixa ou rejeitar a venda.

## 7. Relatórios (`/caixa/historico`, administrador)

Filtros por período, situação, terminal e operador. Abas: **Caixas** (fechamento por caixa, com detalhe e
auditoria), **Por operador**, **Por terminal**, **Formas de pagamento**, **Sangrias e suprimentos**,
**Despesas**, **Divergências**, **Conflitos de sincronização**. **Imprimir** usa `window.print()` (o menu e os
botões têm `no-print`, como nos demais relatórios) e **Exportar CSV** (caixas e movimentos; UTF-8 com BOM, `;`,
com neutralização de injeção de fórmula). Os relatórios existentes (`/relatorios`, `/historico`) continuam
agrupando `vendas.forma_pagamento`; uma venda dividida aparece lá como **"misto"** — o detalhe por forma está
nos relatórios de caixa.

## 8. Formas de pagamento

`dinheiro`, `pix`, `credito`, `debito`, `fiado` (as já existentes). Não há cadastro configurável de formas no
sistema; acrescentar uma nova exige migration (CHECKs) e ajuste em `lib/caixa/tipos.ts`. A coluna
`vendas.forma_pagamento` passou a aceitar também `misto` (pagamento dividido) — único ajuste em estrutura
existente, via recriação do CHECK.

## 9. Funcionamento offline

**Tudo é gravado primeiro no aparelho** (IndexedDB, versão 7: `caixas_locais`, `movimentos_caixa_locais`) e vai
para a mesma fila de sincronização das vendas (`caixa_abertura`, `caixa_movimento`, `caixa_estorno`,
`caixa_fechamento`). O PDV, a fila e o PIN offline continuam como estavam; só passou a existir a exigência de
caixa aberto para vender.

- **Ordem**: a fila é processada por data de criação (abertura → vendas/movimentos → fechamento). O fechamento
  **só é enviado depois que todas as operações anteriores do mesmo caixa foram aceitas** (`pendenciasDoCaixa`).
- **Venda criada offline antes de a abertura chegar ao servidor**: o servidor responde `aguardando_caixa`; a
  venda **fica pendente, sem contar falha nem entrar em revisão**, e é aceita assim que a abertura sincroniza.
- **Fechamento com operações pendentes**: *com internet*, é **bloqueado** (o botão oferece "Sincronizar
  agora"); *sem internet*, é **permitido** e fica *pendente de sincronização*, na fila depois das pendências. Vendas
  já **retidas para revisão** não bloqueiam, mas a tela avisa que não entram no fechamento.
- **Fechamento definitivo**: o servidor recalcula o resumo com todas as operações válidas; só a resposta dele
  confirma o fechamento no aparelho (`fechamento_confirmado_servidor`). Se o servidor calcular outro saldo, a tela
  mostra os dois e prevalece o do servidor.
- **Leituras do IndexedDB** (`obterCaixaAbertoLocal`, `listarMovimentosLocais`, `resumoLocal`, `pendenciasDoCaixa`) rodam
  em transação de **leitura** (a tela usa `useLiveQuery`) e **nunca criam nada**: o identificador do terminal é lido
  por `lerIdentificadorDispositivo` (só leitura); só abrir caixa/vender o cria. Sem identificador ainda, não há caixa
  deste terminal.
- **Abertura, venda e fechamento offline** (`pdv.vender`, PIN local de cargos que só vendem) funcionam e ficam *pendentes
  de sincronização*, sem mensagem de confirmação do servidor. **Sangria, suprimento, despesa, ajuste e estorno exigem
  conexão** (autorização do servidor, §3): offline a tela diz "exige conexão com o servidor" e **nada é registrado**.
- **Idempotência**: abertura (id do caixa), movimentos (id da operação), vendas ((venda, tipo, ordem)), estornos
  (`estorno_de_id` único + auditoria da operação) e fechamento (caixa já fechado → "já existia"). Reenviar ou
  enviar em paralelo nunca duplica.
- **Conflitos** (movimento para caixa já fechado, abertura em terminal que já tem caixa aberto, funcionário
  inativo/sem permissão, caixa de outro terminal…): o servidor **grava a operação inteira em `caixa_conflitos`**
  (nada é aplicado nem apagado); no aparelho o item fica `em_revisao`, visível, o caixa é marcado com o conflito
  e **vendas novas ficam bloqueadas**. O administrador trata em `/caixa/historico` → *Conflitos*. Vendas
  conflitantes seguem o fluxo já existente (`vendas_revisao`).
- **Falha de rede**: erros de comunicação mantêm o item na fila com *backoff*; "sessão expirada" pausa a fila sem
  contar tentativa; envio abandonado (aba fechada) volta para a fila. Nada se perde.
- Limitação herdada: o relógio e o `dispositivo_id` vêm do aparelho e não são autenticados. O servidor aceita a
  hora do terminal, mas nunca no futuro (tolerância de 5 min), e guarda também `created_at` do servidor.

## 10. Segurança e banco

- Migration **aditiva**: `20260106000000_controle_caixa` (tabelas `caixas`, `movimentos_caixa`, `auditoria_caixa`,
  `caixa_conflitos`, `autorizacoes_caixa`; CHECKs; índice único parcial; gatilhos, inclusive o de uso único das
  autorizações). Nada é apagado nem recriado, exceto o CHECK de
  `vendas.forma_pagamento` (agora aceita `misto`).
- Gatilhos: movimento só entra em caixa **aberto**; `movimentos_caixa` e `auditoria_caixa` são **imutáveis**
  (UPDATE/DELETE recusados; única exceção: o banco anular `usuario_id` quando um login é removido); `caixas` não
  é apagado, a abertura não é reescrita e reabrir exige o registro de reabertura.
- Toda escrita financeira é transacional e **trava a linha do caixa** (`SELECT … FOR UPDATE`), serializando vendas,
  movimentos e fechamento do mesmo caixa. Há testes de concorrência.
- Aplicar: `npm run db:migrate` (o `npm start` já roda `prisma migrate deploy`). **Esta entrega não aplicou
  migration em produção.**

## 11. Decisões comerciais pendentes (não inventadas)

1. **Sangria/suprimento offline** por operador de caixa/frentista (hoje exigem PIN de gerente, com conexão).
2. **Estoque ao cancelar venda**: o cancelamento lança o estorno financeiro e marca a venda cancelada, mas **não
   devolve o estoque** (nenhuma regra existente para isso foi alterada).
3. **Estorno/devolução parcial** e de vendas de **caixas já fechados**: hoje só estorno integral, no caixa aberto
   do dia; devoluções de caixas anteriores exigem tratamento do administrador (reabrir o caixa).
4. **Estorno de venda com parte em fiado**: recusado; tratar na conta a receber.
5. **Taxas de operadora**: só as informadas por venda; não há tabela de taxas por bandeira/parcela.
6. **Limite/tolerância de diferença** no fechamento: qualquer diferença exige justificativa e vira *aguardando
   conferência*; não há tolerância configurada.
7. **Recebimento de conta sem caixa aberto no terminal** fica só na conta (não entra em nenhum caixa).

## 12. Testes

Não há E2E versionado no projeto (sem Playwright nem jsdom como dependência). Fluxos de navegador (abertura, vendas
por forma, fiado, administrativas, estorno, fechamento, offline/reconexão, teclado, mobile) foram verificados com
Playwright **fora do projeto**, em banco descartável; o que é testável sem DOM está em testes unitários e de integração.

`npm test` (unitários, sem banco): cálculo, validação, relatórios, permissões, caixa local, sincronização/fila,
PIN. `npm run test:integracao` (PostgreSQL descartável, `TEST_DATABASE_URL` terminando em `_test`):
`services/caixa/__tests__/caixa.integracao.test.ts` e os demais. Exemplo local com Docker:

```bash
docker run -d --name caixa-pg-test -e POSTGRES_PASSWORD=teste -e POSTGRES_DB=caixa_test -p 54329:5432 postgres:16
export TEST_DATABASE_URL=postgresql://postgres:teste@localhost:54329/caixa_test
DATABASE_URL=$TEST_DATABASE_URL npx prisma migrate deploy
npm run test:integracao
```

## 13. Interface: mensagens, teclado e acessibilidade

**Mensagens do PIN** (`validarPinParaOperacao` e `IdentificacaoPinModal`) — cada situação tem texto próprio e nenhuma
revela dado sensível (o PIN digitado nunca é avaliado nem comentado quando o servidor é obrigatório):

| Situação | Mensagem |
|---|---|
| PIN incorreto / bloqueado por tentativas (resposta do servidor) | "PIN incorreto." / "Muitas tentativas…" |
| Cargo sem permissão | "Seu cargo não tem permissão para esta operação." |
| Operação administrativa **offline** | "Esta operação exige conexão com o servidor para validar o PIN de proprietário ou gerente…" (qualquer PIN) |
| Servidor sem resposta, lento (> 4 s) ou erro | "Falha de comunicação com o servidor: o PIN não foi confirmado e nada foi registrado…" |
| Sessão expirada | "Sessão expirada: entre novamente no sistema (online)…" |
| Autorização do servidor não confirmada (rede caiu na chamada) | "Falha de comunicação: o servidor não confirmou a autorização e a operação NÃO foi registrada…" |
| Abrir/vender/fechar **offline** com PIN não reconhecido | "PIN não reconhecido neste aparelho sem conexão… se for de proprietário ou gerente, a validação exige conexão com o servidor." |

Operação administrativa **nunca** usa o PIN local como reserva. A operação só é registrada depois que o servidor
confirma a autorização; o sucesso só é anunciado depois disso.

**Teclado e foco** (`components/ui/Modal.tsx`, usado por todos os modais): ao abrir, o foco entra no diálogo; `Tab`/`Shift+Tab`
ficam presas nele; ao fechar, o foco volta a quem abriu. **Esc**, o fundo e o botão *Fechar* fecham o modal — e, no modal
de PIN, **cancelam** (nunca confirmam nem autorizam nada). Enquanto o PIN está sendo validado no servidor o modal fica
**bloqueado** (`bloqueado`: Esc/fundo/Fechar não fecham), para que o resultado — sucesso ou erro — nunca seja escondido.
No fluxo de movimento/estorno o PIN abre sobre o formulário: Esc no PIN volta ao formulário; Esc de novo o fecha.

**Nomes acessíveis**: os botões da lista de movimentos têm rótulo único ("Cancelar venda de R$ 10,00 em Dinheiro",
"Estornar Sangria de R$ 20,00"); o botão *Fechar* do modal fica `aria-disabled` quando bloqueado.
