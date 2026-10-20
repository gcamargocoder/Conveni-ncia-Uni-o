# Integridade do PDV offline

Fase de segurança sobre a sincronização de vendas e o PIN offline (proposta da seção 7 de
`PRE_PUBLICACAO_RAILWAY.md`). A autenticação por e-mail/senha (`AUTENTICACAO.md`) não foi alterada.

## Princípio

O navegador não é confiável: tudo o que chega da fila offline (ou do PDV online) é **conferido contra o
banco**. Mas o princípio do produto continua valendo (`PRODUCT_RULES.md`): **uma venda nunca é descartada em
silêncio**. Quando algo não confere, a venda fica **retida** no servidor com os motivos, visível ao operador e
ao administrador, até uma pessoa decidir.

## Fluxo de uma venda sincronizada

`sincronizarVendaAction` → `processarVendaRecebida` (`services/vendas-sincronizadas.service.ts`):

1. Exige sessão válida (`verificarAcesso`). Sem sessão a venda **continua pendente** na fila.
2. **Estrutura** (`lib/vendas/validacao-sincronizacao.ts`): ids UUID; quantidade finita, > 0, ≤ 3 casas e ≤ 9.999.999;
   preço finito, ≥ 0, ≤ 2 casas; forma de pagamento conhecida; fiado exige cliente; até 500 itens.
3. **Referência no banco**: funcionário existe? está ativo e não removido? o cargo tem `pdv.vender`? cliente existe
   e está ativo? cada produto existe, está ativo e o **preço informado é igual a `produtos.preco_venda`**? o total
   informado bate com a soma dos itens (em centavos, sem erro de ponto flutuante)?
4. Tudo confere → grava venda + itens + (fiado) conta a receber **numa única transação**; a baixa de estoque nasce
   da trigger na mesma transação. Grava também `vendas.usuario_id` = **login** que enviou (distinto de
   `funcionario_id` = quem foi selecionado no PDV).
5. Algo não confere → **não grava venda nem baixa estoque**; cria uma linha em `vendas_revisao` (payload, motivos,
   quem enviou) e responde "retida". O aparelho marca a venda **Em revisão** e a tira do reenvio automático, sem
   apagar nada.

### Dois tipos de motivo
| Tipo | Exemplos | Quem resolve |
|---|---|---|
| **bloqueante** | quantidade ≤ 0/NaN, preço inválido, id inválido, produto ou funcionário inexistente, fiado sem cliente | ninguém aprova: a venda é inaproveitável; o administrador só pode rejeitar (mantém o registro) |
| **divergência** | preço diferente do cadastro, funcionário inativo/removido/sem permissão, produto ou cliente inativo, total incoerente | **administrador** aprova (grava com os valores informados) ou rejeita, em **Vendas em revisão** (`/vendas-revisao`) |

Exceções legítimas **não são adivinhadas pelo sistema**: hoje não existe desconto nem preço diferenciado
implementado (`PRODUCT_RULES.md` §2). A única exceção real é o **preço que mudou enquanto o aparelho estava
offline**; ela cai em "divergência" e é autorizada explicitamente por um administrador.

### Aprovação: revalidação e atomicidade
Aprovar **não confia no que foi guardado na retenção**. Dentro da transação (com `SELECT … FOR UPDATE` na linha de revisão) o servidor:
1. confere a estrutura de novo (quantidade, preço, ids);
2. recarrega funcionário, cliente e produtos **com os dados de agora** e reavalia todas as regras;
3. se surgiu motivo **bloqueante** (ex.: funcionário/produto/cliente deixou de existir), recusa e marca a revisão como não aprovável;
4. se os motivos **mudaram** desde que o administrador olhou (ex.: o preço cadastrado foi alterado de novo, o produto foi desativado), **não aprova**: atualiza os motivos exibidos e pede nova decisão — o administrador só aprova o que viu;
5. só então grava venda + itens + conta a receber (a baixa de estoque nasce da trigger na mesma transação) e marca a revisão como aprovada.
Uma falha em qualquer ponto desfaz tudo (testado com uma falha injetada depois da gravação da venda: sem venda, sem baixa de estoque, pendência intacta).

### Indicador para administradores
O item **Vendas em revisão** do menu mostra a contagem de pendentes (`IndicadorRevisao`). Os dados vêm da Server Action `contarVendasRevisaoAction`, que exige papel de administrador no servidor (operador e anônimo recebem `{ ok: false }`, sem contagem). Atualiza ao montar, a cada 60 s, ao voltar o foco/conexão, ao decidir uma venda e quando o worker deste aparelho retém uma venda. Em **outro** aparelho de administrador a atualização leva até 60 s.

### Estoque e concorrência
- O estoque é a soma do histórico de movimentações (view); cada venda só **insere** linhas. Não há "ler-e-gravar o
  saldo", então vendas simultâneas não perdem baixa.
- Idempotência por `id` da venda (chave primária): envios repetidos ou simultâneos do mesmo `id` resultam em **uma**
  venda e **uma** baixa (a perdedora da corrida desfaz tudo, inclusive o movimento).
- Seguindo `PRODUCT_RULES.md`, o servidor **não bloqueia venda por estoque**: o saldo pode ficar negativo, o que já é
  alertado no dashboard.
- Aprovar uma venda retida é transacional (`SELECT … FOR UPDATE`): aprovações simultâneas gravam uma única vez.

## PIN

### O que mudou
- `pin_hash` **não faz mais parte do catálogo** sincronizado (`listarFuncionariosCatalogoDesde` usa `select`
  explícito). Nenhum funcionário tem o hash enviado pelo canal geral.
- O PIN offline passou a ter **canal próprio** (`buscarCredenciaisPinOfflineAction`) que entrega verificadores só de
  funcionários **ativos de cargos cuja única permissão é vender** (hoje `caixa` e `frentista`; derivado de
  `cargoPodeUsarPinOffline`). **Proprietário, gerente e estoquista nunca têm o PIN fora do servidor.**
- A lista é substituída por inteiro a cada sincronização e apagada no **logout**.
- Aparelhos já em uso: a migração do IndexedDB (v5→v6) apaga `pin_hash` de `funcionarios_local` e preserva só o PIN de
  quem apenas vende, para o PDV não parar sem internet.
- **Ordem de validação no PDV** (`validarPinParaVenda`): com conexão, **o servidor valida** (contador de tentativas no
  servidor; PIN errado/bloqueio são definitivos). Sem conexão, sem sessão, erro ou demora > 4 s, usa o PIN offline.
  Gerente/proprietário precisam de conexão para vender.
- O limitador de tentativas de PIN passou a usar `x-real-ip` (antes aceitava o primeiro valor de `x-forwarded-for`,
  que o cliente pode forjar para escapar do bloqueio).

### Fila offline: dois ajustes comprovados no teste em Chrome
- Um envio que ficava **"sincronizando"** (aba fechada ou conexão caída no meio) saía da lista de pendentes e **nunca era reenviado** (e não aparecia na contagem de pendentes). Agora: o envio tem limite de 30 s (vira falha comum com tentativa e *backoff*) e envios "sincronizando" há mais de 60 s são devolvidos a "pendente" (`recuperarEnviosAbandonados`). É seguro porque o servidor é idempotente pelo id da venda.

### Impacto operacional da regra de preço (sem tolerância automática)
Toda venda cujo preço difere do cadastro é retida — inclusive a legítima feita com o preço antigo por um aparelho que estava offline quando o preço mudou. Consequências: (1) essas vendas **não entram no faturamento nem baixam o estoque** até um administrador decidir; (2) após uma mudança de preço, espere vendas em revisão dos aparelhos offline; (3) um administrador precisa olhar a fila com regularidade (daí o indicador no menu). **Não existe tolerância automática por decisão de projeto.** Recomendação operacional: alterar preços fora do horário de pico e conferir a fila depois.

### Risco residual (sem alegar proteção absoluta)
1. **Os verificadores de PIN de caixa/frentista continuam no aparelho.** PIN de 4 dígitos tem 10.000 combinações; quem
   extrair o IndexedDB quebra esses hashes offline em segundos a minutos. Consequência: passar-se por um caixa **em
   vendas** — nunca por gerente/proprietário, nem para estoque, funcionários ou relatórios. Não existe verificador
   offline imune a isso com um PIN curto: qualquer coisa que valide offline pode ser atacada offline.
2. **O servidor não consegue provar qual PIN foi digitado numa venda offline.** Ele garante que o funcionário
   existe/está ativo/pode vender e **registra o login responsável** (`usuario_id`), mas `funcionario_id` numa venda
   offline continua sendo uma declaração do aparelho. A autoria forte é o login, não o PIN.
3. O contador de tentativas offline fica no IndexedDB e pode ser zerado por quem controla o aparelho.
4. Gerente e proprietário não vendem **sem conexão** (decisão de segurança; ver "Decisões").
5. Preço **menor ou maior** que o cadastro nunca é aceito sozinho, mas uma venda com os preços **corretos** e
   funcionário ativo é indistinguível de uma legítima: um operador autenticado ainda pode lançar vendas "fantasma" a
   preço de tabela (afeta caixa/estoque, é rastreável por `usuario_id`, `dispositivo` e horário).
6. Uma venda **retida** não baixa estoque nem entra no faturamento até ser aprovada; enquanto isso o estoque do
   servidor fica "alto" em relação ao físico.

### Alternativas, se o risco residual for inaceitável (decisão do dono)
| Opção | Efeito | Custo |
|---|---|---|
| A. (implementada) PIN offline só para quem apenas vende | limita o dano de um vazamento | gerente/dono sem venda offline |
| B. Sem PIN offline: o aparelho identifica o funcionário por seleção + login, PIN só online | zero hash no aparelho | atribuição offline mais fraca; muda o fluxo do caixa |
| C. PIN mais longo (6+ dígitos) ou senha curta para vendas offline | torna a quebra offline inviável | troca de hábito + novo cadastro de PINs |
| D. Credencial offline com limite (valor/quantidade de vendas por turno) | reduz o impacto | nova regra comercial |

## Migration
`prisma/migrations/20260103000000_integridade_vendas_pdv` (aditiva, **não aplicada em produção**):
- `ALTER TABLE vendas ADD COLUMN usuario_id UUID` (nullable, FK `ON DELETE SET NULL`, índice) — vendas existentes ficam `NULL`;
- `CREATE TABLE vendas_revisao` (+ FKs e CHECK de status).
Nenhuma linha existente é alterada ou apagada. Verificado em banco de teste com dados prévios (contagens, totais e
estoque idênticos antes/depois).

## Testes
- `lib/vendas/__tests__/validacao-sincronizacao.test.ts` (unidade)
- `services/offline/__tests__/integridade-pdv.test.ts` (fila offline, PIN offline, migração do IndexedDB)
- `lib/auth/__tests__/formularios-senha.test.ts` (formulários com senha usam POST)
- Roteiros em Chrome real (fora do repositório, no scratchpad da sessão): migração de IndexedDB legado, migração interrompida, venda offline com preço adulterado, revisão e indicador, logout e login
- `services/vendas/__tests__/vendas-integridade.integracao.test.ts` (PostgreSQL real, inclui revalidação na aprovação, rollback com falha injetada e contagem do indicador: preço/quantidade adulterados,
  funcionário forjado/inativo/sem permissão, sem sessão, operador sem papel admin, duplicata, simultaneidade, revisão,
  catálogo sem `pin_hash`)
