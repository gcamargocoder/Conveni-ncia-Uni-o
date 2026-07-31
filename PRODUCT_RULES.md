# Regras de Negócio — Convenience SaaS

Documento vivo. Gerado a partir de uma simulação operacional completa de uma
conveniência de posto (abertura → fechamento). Cada regra indica se está
**implementada**, **parcialmente implementada** ou **não implementada**.

## Princípio fundamental
> O sistema nunca pode impedir uma venda. Nenhuma validação, checagem de
> estoque ou regra de negócio pode bloquear o fechamento de uma venda no PDV.

⚠️ **Violação conhecida hoje:** sem conexão com a internet, a venda é
perdida (carrinho não é preservado localmente). Ver seção "Conectividade".

## 1. Caixa e Turno

- ❌ **Não implementado.** Abertura de caixa (fundo inicial contado e
  registrado) antes da primeira venda do turno.
- ❌ **Não implementado.** Fechamento de caixa (conferência de dinheiro
  físico vs. total esperado por forma de pagamento).
- ❌ **Não implementado.** Sessão de caixa formal vinculando abertura →
  vendas do período → fechamento.
- ✅ **Implementado.** Cada venda exige PIN individual no momento da
  finalização — a atribuição de autoria nunca depende de um "login" de
  turno, então múltiplos operadores no mesmo terminal são atribuídos
  corretamente mesmo sem sessão de caixa formal.
- ⚠️ **Parcial.** `useOperadorTurno` identifica quem está no terminal para
  fins de UI, mas isso não é uma sessão de caixa contábil.

## 2. Vendas (PDV)

- ✅ Carrinho em memória, sem fricção entre itens.
- ✅ PIN obrigatório e permissão (`pdv.vender`) checada na finalização.
- ✅ Estoque **nunca** bloqueia uma venda (princípio nº1 respeitado no código).
- ✅ Gravação atômica de venda + itens (função de banco), evitando estado
  parcial se algo falhar no meio.
- ❌ **Não implementado.** Cancelamento de uma venda **já concluída**. A
  coluna `cancelada` e a permissão `pdv.cancelar_venda` já existem no
  código, mas nenhuma função as utiliza — são artefatos "fantasma".
  **Não confundir** com o botão "Cancelar venda" adicionado na Fase 3 do
  Offline First — esse cancela o **carrinho em andamento**, antes de
  finalizar, e já existe.
- ❌ **Não implementado.** Desconto autorizado (percentual ou valor, com
  motivo e autorização de cargo superior).
- ❌ **Não implementado.** Devolução de produto (parcial, posterior à
  venda, distinta de cancelamento).
- ❌ **Não implementado.** Numeração sequencial de cupom por
  dia/terminal (hoje só existe o UUID interno).

## 3. Estoque

- ✅ Toda movimentação (entrada, venda, perda, ajuste, inventário, consumo
  interno) é registrada com rastreabilidade completa — nunca há alteração
  direta de quantidade.
- ✅ Estoque atual sempre calculado a partir do histórico (view), nunca
  uma coluna que possa dessincronizar.
- ✅ Venda gera movimentação de estoque automaticamente (trigger).
- ⚠️ **Parcial.** Conferência de estoque (inventário): existe o tipo de
  movimentação, mas não existe um "modo de contagem" — o operador precisa
  calcular a diferença manualmente e escolher o tipo certo, o que é
  propenso a erro. O fluxo real de inventário (contar tudo, sistema
  calcula e resolve sozinho) não existe.
- ❌ **Não implementado.** Motivo estruturado de perda (vencimento, avaria,
  furto) — hoje é texto livre, sem relatório gerencial confiável por causa.
- ❌ **Não implementado.** Vínculo de entrada de mercadoria com fornecedor
  e número de nota fiscal.
- ❌ **Não implementado.** Controle de validade/lote — perda por
  vencimento é sempre reativa, nunca alertada com antecedência.

## 4. Funcionários e Permissões

- ✅ PIN de 4 dígitos, hash bcrypt, nunca texto puro.
- ✅ Bloqueio por força bruta (5 tentativas, 15 min).
- ✅ Permissão por cargo checada em toda operação sensível existente
  (venda, movimentação de estoque, cadastro de funcionário).
- ✅ Cadastro de funcionário exige autorização de quem já tem permissão
  (`funcionarios.gerenciar`).
- ❌ **Não implementado.** Registro de tentativas de operação negadas por
  falta de permissão — hoje o erro aparece na hora para quem tentou, mas
  não fica auditável depois.

## 5. Relatórios e Impressão

- ✅ Relatório de vendas por período, com resumo por forma de pagamento
  (venda cancelada nunca conta no faturamento — mas hoje nenhuma venda
  pode ser cancelada de fato, então essa proteção ainda não é exercida
  na prática).
- ✅ Relatório de estoque completo.
- ✅ Cupom formatado para impressora térmica (via impressão do navegador),
  com reimpressão a qualquer momento pelo relatório.
- ❌ **Não implementado.** Exportação de relatórios (PDF/Excel).
- ❌ **Não implementado.** Relatório consolidado de perdas.

## 6. Conectividade e Resiliência

- ⚠️ **Parcial.** Infraestrutura offline (banco local, fila de
  sincronização, indicador de conexão) implementada — ver
  `OFFLINE_FIRST_ARCHITECTURE.md`. **Catálogo é local-first** (produtos/
  categorias/estoque). **A venda é local-first e agora sincroniza
  automaticamente** com o Supabase em segundo plano (worker com retry
  e backoff exponencial, sem exigir nenhuma ação do operador).
  **Lacuna que ainda viola o princípio nº1 na prática**: a validação do
  PIN continua dependendo do servidor — se a internet cair no momento
  de autenticar, a venda não é concluída. Resolve-se na fase de PIN
  local-first.
- ❌ **Não implementado.** Indicador de status de conexão na tela — hoje
  o operador só descobre que está offline quando a venda falha.
- ✅ Gravação atômica no banco garante que, quando a venda é registrada,
  nunca fica em estado parcial (mitiga só a queda de energia no meio de
  uma gravação bem-sucedida, não a perda de conexão antes dela).

## 7. Histórico e Auditoria

- ✅ Toda venda e movimentação registra operador, data/hora e dispositivo
  (user-agent).
- ✅ Feed cronológico unificado de operações (`/historico`).
- ❌ **Não implementado.** Auditoria de tentativas negadas (ver seção 4).
- ❌ **Não implementado.** Log de cancelamentos/devoluções (dependem das
  próprias funcionalidades ainda não existirem).

  ## 8. Confiabilidade e Auditoria da Sincronização (Fase 6.5)

- ✅ Conflitos de sincronização (idempotência) são detectados e
  auditados separadamente de sucessos comuns — não apenas resolvidos
  silenciosamente como antes.
- ✅ Fila de sincronização passa por verificação de integridade antes
  de cada processamento (payload corrompido, incompleto, timestamp
  inválido) — corrigido automaticamente (marcado como erro), nunca
  apagado.
- ✅ Logs técnicos categorizados nos pontos-chave da fila de
  sincronização.
- ✅ Tela dedicada de monitoramento (`/sincronizacao`) — status,
  pendentes, sincronizados, com erro, conflitos, última sincronização,
  fila atual, últimos eventos.
- ⚠️ **Correção a uma nota anterior deste documento**: o indicador de
  status de conexão **já existe** na tela (canto superior direito,
  desde a Fase 1) — a observação antiga de que "o operador só descobre
  que está offline quando a venda falha" ficou desatualizada e não
  reflete mais o estado real do sistema.
- ❌ Continuam não implementados: PIN local-first, autorização de
  Terminal Emergencial, sincronização de movimentação de estoque
  manual, histórico de conectividade entre sessões (só durante a
  sessão atual).
