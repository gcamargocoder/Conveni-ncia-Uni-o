# Auditoria de Sincronização — Arquitetura de Confiabilidade

Este documento complementa o `OFFLINE_FIRST_ARCHITECTURE.md`, focando
especificamente no que a Fase 6.5 adicionou: confiabilidade, auditoria
avançada e validação de produção. Não repete o que já está descrito lá
(fluxo geral de sincronização, escolha do IndexedDB, etc.).

## 1. Por que esta fase existiu

As Fases 1-4 entregaram um sistema Offline First **funcional**: catálogo,
venda e fila de sincronização todos local-first, com retry automático.
Mas "funcional" e "confiável o suficiente para operação comercial
contínua" são coisas diferentes. Esta fase fechou essa distância, sem
mudar nenhuma regra de negócio ou peça de arquitetura já existente.

## 2. Detecção de conflitos — o que realmente mudou

Antes da Fase 6.5, o sistema já era **idempotente**: reenviar uma venda
com o mesmo UUID nunca duplicava (migration `0014`). Mas o código não
tinha como saber, depois do fato, que aquilo tinha acontecido — um
"conflito resolvido" e um "sucesso normal" pareciam exatamente iguais.

A migration `0016` mudou o retorno da função `registrar_venda_completa`
de `uuid` para `jsonb { id, ja_existia }`. Isso propaga por toda a
cadeia:

Um conflito resolvido **conta como sucesso** (a venda está sincronizada,
não há erro real) — mas fica marcado separadamente para quem for auditar
depois querer saber "quantas vezes isso aconteceu".

## 3. Retry — nova escada

| Tentativa | Espera antes de tentar de novo |
|---|---|
| 1ª falha | 2 segundos |
| 2ª falha | 5 segundos |
| 3ª falha | 10 segundos |
| 4ª falha | 30 segundos |
| 5ª falha | 1 minuto |
| 6ª falha em diante | 5 minutos (teto — nunca para de tentar) |

Calculada sempre a partir de `tentativas` + `ultima_tentativa_em`
(dados persistidos no IndexedDB) — nunca de um `setTimeout` em memória.
Isso é o que garante retomada automática correta mesmo se o navegador
fechar no meio de uma sequência de tentativas.

## 4. Verificação de integridade

`services/offline/integridade.service.ts` roda **antes** de cada
processamento da fila (`processarFilaSincronizacao`). Verifica:

- payload que não é JSON válido;
- payload de venda sem os campos obrigatórios (`funcionario_id`,
  `forma_pagamento`, `itens` não vazio);
- `criado_em` que não é uma data válida.

Quando encontra um problema, marca o item como `erro` com uma mensagem
clara — **sem apagar nada**. Isso evita que o worker gaste uma chamada de
rede tentando enviar um payload que nunca vai funcionar, e deixa o item
disponível para inspeção manual (visível na tela `/sincronizacao`).

## 5. Logs técnicos categorizados

Tabela local `logs_tecnicos` (IndexedDB), com categorias fixas: `SYNC`,
`QUEUE`, `OFFLINE`, `ONLINE`, `CACHE`, `DATABASE`, `PIN`, `PDV`,
`ESTOQUE`, `ERRO`, `RECOVERY`. Cada log tem nível (`info`/`aviso`/`erro`),
mensagem e detalhes opcionais.

**Decisão de escopo importante**: os logs foram conectados nos pontos que
já existiam e faziam sentido — início/fim do processamento da fila,
problemas de integridade, sucesso/erro por item. **Não foram** inseridos
em toda função do sistema (PIN, PDV, estoque em cada operação individual)
— isso exigiria reescrever módulos inteiros já prontos e testados só para
adicionar logging, o que a própria Fase 6.5 pediu para evitar ("não
refatore por preferência"). As categorias `PIN`, `PDV`, `ESTOQUE`,
`CACHE`, `DATABASE`, `RECOVERY` existem na estrutura, prontas para uso
quando esses módulos passarem por uma fase própria de revisão.

Há uma função de limpeza (`limparLogsAntigos`) para essa tabela não
crescer para sempre — mesmo cuidado que já existia com a fila de
sincronização sincronizada.

## 6. Tempo online/offline

`hooks/useTempoConectividade.ts` acumula segundos online e offline
**durante a sessão atual do navegador** — zera ao recarregar a página.

**Por que não é permanente**: um histórico entre sessões (ex: "esta
semana o sistema ficou 3h offline") exigiria uma tabela própria, um
processo de agregação diária, e uma decisão de por quanto tempo manter
esse histórico — uma funcionalidade nova por si só, não um detalhe de
confiabilidade. Documentado aqui como decisão consciente, não
esquecimento.

## 7. Dashboard de Sincronização

Tela em `/sincronizacao` (menu lateral, grupo "Análise"). Mostra, tudo em
tempo real via `useLiveQuery` (reexecuta sozinho quando o IndexedDB
muda, sem polling manual):

- status atual (online/offline);
- tempo online/offline desta sessão;
- pendentes, sincronizados, com erro, conflitos resolvidos (contadores);
- última sincronização (catálogo e vendas, separadamente);
- fila atual (tabela: tipo, status, tentativas, criado em, erro);
- últimos 20 eventos de auditoria.

## 8. O que esta fase deliberadamente não fez

- Não implementou PIN local-first (fora de escopo, fase própria).
- Não implementou sincronização de movimentação de estoque manual (a
  fila só processa vendas até aqui — igual às fases anteriores).
- Não criou um histórico de conectividade entre sessões (seção 6).
- Não instrumentou logging em todo o sistema, só nos pontos da fila de
  sincronização (seção 5).
- Não implementou assinatura criptográfica das operações enviadas ao
  servidor — validação estrutural (campos presentes, tipos corretos)
  continua sendo a camada de segurança na sincronização, como já
  documentado desde a Fase 4.

Essas exclusões foram deliberadas, para não violar a regra da própria
Fase 6.5 de não alterar arquitetura nem criar funcionalidades de negócio
novas — só elevar a confiabilidade do que já existia.