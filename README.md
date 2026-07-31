# Convenience SaaS — Gestão de Conveniências de Postos

## Princípio nº 1
O sistema nunca pode impedir uma venda.

## Camadas (fluxo de dados)

```
Tela (app/)  →  Componente (components/)  →  Regra de negócio (lib/)  →  Serviço (services/)  →  Supabase
```

A tela **nunca** fala direto com o Supabase. Sempre passa por `lib/` (regra de
negócio) e `services/` (acesso a dados, sempre via `services/supabase/query-helpers.ts`
para tratamento de erro consistente). Isso é o que vai permitir ligar o
Offline First no futuro trocando apenas a camada `services/`, sem tocar em
telas.

## Pastas

| Pasta | Responsabilidade |
|---|---|
| `app/` | Telas (PDV, Dashboard, Produtos, Estoque...) |
| `components/` | Peças de UI reutilizáveis, organizadas por módulo (auth, pdv, produtos, estoque, fornecedores, funcionarios, ui) |
| `lib/` | Regras de negócio puras + Server Actions |
| `services/` | Único ponto de acesso ao banco (usa `service_role`, nunca a chave pública) |
| `types/` | Formato dos dados (Produto, Venda, Funcionário...) |
| `hooks/` | Lógica reaproveitável de React |
| `supabase/migrations/` | Scripts SQL do banco, em ordem numerada |

## Segurança (ver AUDITORIA.md para detalhes)

- **RLS habilitado em todas as tabelas, sem policy pública** (migration `0010`) — o navegador nunca acessa o banco diretamente, só via `service_role` no servidor.
- **PIN protegido contra força bruta**: bloqueio de 15 min após 5 tentativas falhas por origem (migration `0011`).
- `.env.local` nunca vai para o Git (`.gitignore`).

## Convenções adotadas desde o início

- Todo registro usa **UUID** como `id` (nunca incremental).
- Todo registro tem `created_at`, `updated_at`, `deleted_at` — soft delete, nunca apaga histórico de verdade.
- Nenhuma movimentação de estoque altera quantidade diretamente — tudo passa por `MovimentacaoEstoque`.
- Operadores se identificam por **PIN de 4 dígitos**, nunca login/logout tradicional.
- Toda operação relevante registra **operador, data/hora e dispositivo** (user-agent capturado automaticamente).
- Toda consulta ao Supabase usa `unwrap()` (`services/supabase/query-helpers.ts`) para tratamento de erro consistente.
- Listagens têm limite defensivo (`.limit()`) para não trazer catálogos inteiros de uma vez.
- A busca de produtos do PDV acontece **no servidor** (`buscarProdutosParaVenda`), não filtrando um catálogo inteiro carregado no navegador.

## Offline First (planejado, não implementado nesta fase)

A camada `services/` é o único lugar que vai mudar quando a fase Offline
First começar (IndexedDB local + fila de sincronização + resolução de
conflitos). Telas e regras de negócio não serão afetadas.

## Offline First — infraestrutura (Fase 1 de N)

Esta etapa criou **só a infraestrutura**, sem alterar o comportamento de
nenhuma tela existente:

- `services/offline/db.ts` — schema do banco local (IndexedDB via Dexie)
- `services/offline/fila-sincronizacao.service.ts` — fila (outbox), local apenas — **nada é enviado à nuvem ainda**
- `services/offline/{produtos,categorias,funcionarios,estoque}-local.service.ts` — espelhos locais, mesmo padrão dos serviços existentes
- `services/offline/configuracao-local.service.ts` e `dispositivo.service.ts` — configuração e papel do terminal (Principal/Emergencial, ver `OFFLINE_FIRST_ARCHITECTURE.md`)
- `hooks/useConectividade.ts` e `hooks/usePendenciasSincronizacao.ts` — detecção de status e contagem reativa de pendências
- `components/offline/IndicadorConexao.tsx` — indicador permanente, incluído em `app/layout.tsx`

O PDV, o formulário de estoque e o PIN **continuam exatamente como
estavam** — ainda não gravam no banco local, ainda não enfileiram nada.
Isso é proposital: cada próxima etapa vai plugar um módulo de cada vez.

**Corrigidos nesta etapa, por serem pré-requisitos:**
- `app/layout.tsx` não existia — o Next.js exige um layout raiz para
  funcionar; sem ele, o app não buildava.
- Tailwind nunca tinha sido configurado (`tailwind.config`,
  `postcss.config`, `globals.css` ausentes) — nenhuma classe usada em
  nenhuma tela desde a Etapa 1 seria aplicada visualmente. Corrigido.



1. Crie um projeto em supabase.com
2. Rode as migrations em `supabase/migrations/`, em ordem numérica
3. Copie `.env.example` para `.env.local` e preencha `NEXT_PUBLIC_SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` (painel do Supabase → Settings → API)
4. `npm install && npm run dev`
5. `npm run test` roda a suíte de testes automatizados

## Offline First — Fase 2: catálogo local-first

O PDV **nunca mais consulta o Supabase diretamente para pesquisar
produtos** — mesmo com internet disponível. Toda busca (`ProdutoBusca`)
usa `services/offline/produtos-local.service.ts`, que só lê o IndexedDB.
A internet serve exclusivamente para manter esse espelho local
atualizado, via `services/offline/sincronizacao-catalogo.service.ts`.

- **Sincronização incremental**: usa `updated_at` (produtos/categorias)
  e `movimentacoes_estoque.created_at` (estoque, que não tem `updated_at`
  próprio) como carimbo — só busca o que mudou desde a última vez.
- **Disparo automático**: `components/offline/SincronizacaoInicial.tsx`,
  incluído no layout raiz, sincroniza ao carregar o app e a cada
  reconexão.
- **Produto desativado/removido**: sincroniza como qualquer atualização
  (mesmo `updated_at`), gravado localmente com `ativo=false` — nunca
  removido fisicamente do IndexedDB. Some das buscas porque toda leitura
  local já filtra por `ativo`.
- **Indicador** (`IndicadorConexao`) agora mostra também o horário da
  última sincronização do catálogo e quantos itens foram trazidos.
- **Decisão de escopo**: "pesquisar por código" foi tratado como
  equivalente a código de barras — não existe hoje um campo de SKU
  interno separado no cadastro de produto. Filtro por categoria existe
  na função de busca local, mas a tela do PDV não ganhou um seletor de
  categoria nesta etapa (fora do escopo: "não alterar o comportamento
  do PDV além da fonte de dados").
- **Removido**: a busca de produtos direto no Supabase
  (`buscarProdutosParaVenda`) e a Server Action que a chamava —
  ficariam contradizendo a regra desta fase se continuassem existindo.

## Offline First — Fase 3: PDV local-first (venda)

Toda venda agora é gravada **inteiramente no banco local** — nenhuma
chamada ao Supabase acontece ao finalizar uma venda. Uma única transação
Dexie cobre venda, itens, baixa de estoque local, item na fila de
sincronização e limpeza do carrinho: se qualquer parte falhar, tudo é
desfeito (nunca fica um estado parcial).

- **Carrinho persistente**: salvo no IndexedDB a cada alteração
  (`services/offline/carrinho-local.service.ts`), recuperado
  automaticamente ao abrir a tela — sobrevive a F5, fechamento
  inesperado ou queda de energia. Só esvazia ao concluir a venda ou por
  cancelamento explícito (novo botão "Cancelar venda" no PDV).
- **Fila de sincronização**: cada venda gera um item `pendente` com o
  mesmo UUID da venda — ainda **nada é enviado à nuvem** (isso é a
  próxima fase).
- **Cupom pós-venda**: passou a ser montado com os dados locais, não
  mais buscado no servidor — a venda ainda não existe lá. A reimpressão
  pelo relatório continua funcionando normalmente para vendas já
  sincronizadas.
- **Auditoria local**: início, conclusão (com duração medida) e erro de
  cada venda, além da criação do item na fila.

**Lacuna conhecida e documentada, não escondida**: a validação do PIN
ainda depende do servidor (`validarPinAction`). Se a internet cair
exatamente no momento de autenticar o operador, a venda não completa —
mesmo com a gravação em si já sendo 100% local a partir daí. Isso só se
resolve com uma fase futura de "PIN local-first", ainda não implementada.



## Offline First — Fase 4: sincronização automática com o Supabase

O operador nunca clica em "sincronizar" — o `WorkerSincronizacao`
(incluído no layout raiz) roda em segundo plano: imediatamente ao ficar
online, a cada 15s enquanto a conexão durar, e logo após cada venda ser
salva localmente (disparo extra, sem bloquear a tela).

- **Correção crítica que precisou ser feita antes**: a função de banco
  `registrar_venda_completa` nunca aceitava um `id` — sempre gerava um
  UUID novo no servidor. Isso quebrava a idempotência que a Fase 3 já
  prometia. Corrigido na migration `0014`: agora recebe `p_id` e, se a
  venda com esse id já existir, não faz nada (idempotente de verdade).
- **Retry com backoff exponencial** (5s/10s/20s/40s, teto em 40s) —
  calculado sempre a partir de dados persistidos (`tentativas` +
  `ultima_tentativa_em`), nunca de um temporizador em memória. É isso
  que garante a retomada automática mesmo se o navegador fechar no meio.
- **Nunca desiste de vez**: item com erro continua sendo tentado
  indefinidamente a cada 40s — "nunca perder dados" pesou mais do que
  "parar de tentar depois de N vezes".
- **Nova Server Action sem PIN** (`sincronizarVendaAction`) — o worker
  não tem (nem deveria ter) o PIN digitado uma única vez no momento da
  venda; usa `registrarVenda()` diretamente, como antecipado na nota
  técnica da Fase 3.
- **Segurança**: validação estrutural do payload antes de enviar
  (campos obrigatórios, itens não vazios). Não implementamos assinatura
  criptográfica da operação — não foi especificado com detalhe
  suficiente para fazer isso com segurança; documentado como decisão de
  escopo, não esquecimento.
- **Indicador** agora mostra também a última sincronização da fila de
  vendas, além da do catálogo (Fase 2).

## Débitos técnicos conhecidos (ver AUDITORIA.md)

- Mobile-first não foi aplicado por metodologia (breakpoints), só por layout simples de coluna única.
- Offline First: catálogo, venda e sincronização de vendas já são local-first (Fases 1-4). PIN local-first e movimentação manual de estoque local-first continuam pendentes.
- Camada de serviços sem testes automatizados (só integração manual via `tsc`/uso real) — só `lib/` (regra de negócio pura) e `services/offline/` (testados com fake-indexeddb) têm cobertura de testes.
## Offline First — Fase 6.5: confiabilidade, auditoria avançada e validação

Esta fase não mudou nenhuma regra de negócio nem a arquitetura — o
objetivo foi elevar a confiabilidade do que já existia (Fases 1-4) para
um nível de produção comercial.

- **Detecção de conflito de verdade**: a função de banco
  `registrar_venda_completa` agora informa se a venda já existia
  (migration `0016`) — antes disso, o sistema era idempotente na
  prática, mas não conseguia **auditar** quando isso acontecia. Agora
  todo conflito resolvido pela idempotência é registrado separadamente
  de um sucesso comum.
- **Nova escada de retry**: 2s / 5s / 10s / 30s / 1min / 5min (antes era
  5s/10s/20s/40s) — substitui os números da Fase 4. Nunca desiste de
  vez: depois do teto, continua tentando a cada 5min.
- **Verificação de integridade da fila** (`services/offline/integridade.service.ts`):
  antes de processar, detecta payload corrompido, incompleto ou com
  timestamp inválido — marca como erro automaticamente, sem gastar uma
  chamada de rede tentando enviar algo que nunca vai funcionar.
- **Logs técnicos categorizados** (`services/offline/logs.service.ts`):
  categorias SYNC, QUEUE, OFFLINE, ONLINE, CACHE, DATABASE, PIN, PDV,
  ESTOQUE, ERRO, RECOVERY — conectados nos pontos-chave da fila de
  sincronização (não em todo o sistema, o que exigiria reescrever
  módulos já prontos só para inserir log).
- **Tempo online/offline**: rastreado **por sessão do navegador**
  (`hooks/useTempoConectividade.ts`) — zera ao recarregar a página. Um
  histórico permanente entre sessões seria uma funcionalidade maior,
  fora do que foi detalhado; decisão de escopo documentada.
- **Dashboard de Sincronização** (`/sincronizacao`, novo item no menu):
  status atual, tempo online/offline da sessão, pendentes, sincronizados,
  com erro, conflitos resolvidos, última sincronização, fila atual e
  últimos eventos — tudo em tempo real via `useLiveQuery`.
- Documento completo da arquitetura de confiabilidade:
  `AUDITORIA_SINCRONIZACAO.md`.

Testes desta fase: `services/offline/__tests__/integridade.test.ts`,
`logs.test.ts`, `auditoria-conflitos.test.ts`, além dos ajustes em
`backoff.test.ts` e `worker-sincronizacao.test.ts` para a nova escada.
