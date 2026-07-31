# Roadmap — Convenience SaaS

Classificação baseada na simulação operacional completa (ver
`PRODUCT_RULES.md`). "MVP" aqui significa: **obrigatório antes da primeira
loja real usar o sistema no caixa**, não o MVP original do documento de
arquitetura — a simulação revelou que o MVP original, embora tecnicamente
completo, tem lacunas operacionais que impediriam o uso real no dia a dia.

## MVP — já implementado

- Cadastro de produtos, categorias, fornecedores, funcionários
- Autenticação por PIN (com proteção contra força bruta)
- PDV com carrinho, busca de produto, múltiplas formas de pagamento
- Baixa automática de estoque
- Entrada manual de estoque
- Dashboard (vendas do dia, faturamento, estoque baixo, mais vendidos)
- Relatórios de vendas (por período) e estoque
- Impressão térmica de cupom, com reimpressão
- Histórico unificado de operações
- Segurança: RLS, service_role, PIN protegido, permissões por cargo

## MVP — faltando, recomendado ANTES do lançamento real

Estas foram descobertas pela simulação, não estavam na lista original —
mas sem elas, uma conveniência real não consegue operar o dia inteiro:

1. **Cancelamento de venda.** A permissão já existe no código, órfã. Sem
   isso, um erro de caixa não tem correção formal.
2. **Abertura e fechamento de caixa** (sessão com valor inicial, conferência
   final por forma de pagamento). Sem isso, não existe "bater o caixa" —
   a operação mais básica de qualquer loja física.
3. **Preservar o carrinho localmente diante de falha de conexão** — não é
   o Offline First completo (isso seguirá para a v2.0), mas o mínimo para
   não perder itens já escaneados se a rede cair no meio de uma venda.
   Sem isso, o princípio "a venda nunca pode ser impedida" é violado na
   prática todo dia em que a internet do posto oscilar.
   **Status:** catálogo local-first e gravação de venda local-first
   concluídos (transação atômica, carrinho persistente, fila local) —
   ver `OFFLINE_FIRST_ARCHITECTURE.md`. **Ainda falta**: PIN local-first
   (autenticação continua exigindo servidor — enquanto isso não existe,
   uma queda de conexão no momento exato de autenticar ainda impede a
   venda) e o envio real da fila à nuvem (fase de sincronização).

## Versão 1.1

- Desconto autorizado (percentual/valor, com motivo e limite por cargo)
- Devolução de produto (parcial, posterior à venda)
- Modo de contagem de inventário (conferência em massa, sistema calcula
  os ajustes sozinho em vez de lançamento manual produto a produto)
- Auditoria de tentativas de operação negadas por falta de permissão
- Indicador de status de conexão na tela

## Versão 1.2

- Motivo estruturado de perda (vencimento / avaria / furto) com relatório
  gerencial de perdas por causa
- Vínculo de entrada de mercadoria com fornecedor e número de nota fiscal
- Numeração sequencial de cupom por dia/terminal
- Exportação de relatórios (PDF/Excel)
- Reimpressão de cupom direto de uma tela "vendas recentes deste terminal"
  (hoje só pelo relatório completo)

## Versão 2.0

- Offline First completo (IndexedDB, fila de sincronização, resolução de
  conflitos) — a arquitetura já foi preparada desde a Etapa 1 para isso
- Controle de validade/lote de produtos, com alerta preventivo antes do
  vencimento (hoje a perda por vencimento é sempre reativa)
- Multi-loja / painel consolidado (se o negócio crescer para mais de um
  posto usando o mesmo sistema)
- Cabeçalhos de segurança HTTP (CSP/HSTS) e auditoria formal de
  dependências como parte do processo de deploy

## Não classificado — decisão do dono do produto

- Paginação real (cursor/offset) nas listagens, hoje só com limite
  defensivo — necessária quando o catálogo de algum cliente passar de
  ~1000 produtos ativos, mas não é uma funcionalidade voltada ao usuário
  final, então não se encaixa perfeitamente nas versões acima. Sugerido
  tratar como item técnico contínuo, não uma versão fechada.

  ## Atualização — Fase 6.5 (confiabilidade e auditoria avançada)

Não adiciona itens novos ao roadmap — reforça a confiabilidade do que já
estava classificado como "MVP — faltando" no item 3 (preservar o
carrinho/venda diante de falha de conexão). Com a Fase 6.5:

- Conflitos de sincronização (idempotência) agora são detectados e
  auditados, não só resolvidos silenciosamente.
- A fila de sincronização é verificada quanto à integridade antes de
  cada processamento, evitando tentativas infinitas com dados corrompidos.
- Existe agora uma tela dedicada (`/sincronizacao`) para acompanhar tudo
  isso — antes só existia o indicador discreto no canto da tela.

**Continua pendente, sem mudança nesta fase**: PIN local-first (autenticação
ainda depende do servidor).
