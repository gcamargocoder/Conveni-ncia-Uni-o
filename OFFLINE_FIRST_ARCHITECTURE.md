# Offline First — Arquitetura (v2 — Terminal Principal / Terminal Emergencial)

Documento de arquitetura. **Nenhum código foi escrito ainda.** Substitui a
v1 — a v1 assumia múltiplos terminais ativos simultaneamente; o cenário
real é diferente e mais simples, descrito abaixo.

## 0. Status de implementação

- ✅ **Fase 1 — Infraestrutura (concluída):** banco local (Dexie), fila de
  sincronização (estrutura local, sem envio à nuvem), espelhos locais de
  leitura, detector de conectividade, indicador visual permanente,
  configuração/papel de dispositivo. Nenhum módulo existente (PDV,
  estoque, PIN) foi alterado nesta fase.
- ✅ **Fase 2 — Catálogo local-first (concluída):** sincronização
  incremental de produtos/categorias/estoque (servidor → dispositivo),
  disparada ao iniciar o app e a cada reconexão. O PDV passou a
  pesquisar produtos **exclusivamente** no banco local — a busca antiga
  direto no Supabase foi removida. Vendas continuam sem gravação local
  (fase seguinte).
- ✅ **Fase 3 — PDV local-first / venda (concluída):** toda venda é
  gravada localmente numa transação atômica (venda + itens + baixa de
  estoque + item na fila + limpeza do carrinho). Carrinho persistente
  (sobrevive a F5/queda de energia). Cupom pós-venda montado com dados
  locais. **Nada é enviado à nuvem ainda** — só a fila local acumula.
  Lacuna conhecida: PIN ainda depende do servidor para autenticar.
- ✅ **Fase 4 — Sincronização automática (concluída):** worker em
  segundo plano processa a fila sozinho (sem o operador clicar em
  nada), com retry e backoff exponencial (5/10/20/40s) derivado de
  dados persistidos, nunca de temporizador em memória — retomada
  automática garantida mesmo após fechar o navegador. Idempotência
  corrigida na raiz (migration `0014`: a função de banco agora aceita
  o id gerado no dispositivo, em vez de sempre criar um novo).
- ⏳ Fase 5 — PIN local-first
- ⏳ Fase 6 — Estoque local-first (movimentação manual: entrada/perda/ajuste)
- ⏳ Fase 7 — Cadastro/autorização de dispositivo (Terminal Emergencial)
- ⏳ Fase 8 — Auditoria de contingência (ativação/encerramento do Terminal Emergencial)

## 1. Mudança de cenário (o que mudou da v1 para a v2)

**Cenário real:** um único computador é o terminal oficial de vendas. Um
único celular autorizado existe só para contingência (falta de energia,
computador indisponível) — não opera em paralelo ao computador no dia a
dia normal.

Isso muda o objetivo do projeto: **não é mais "sincronizar múltiplos
terminais ativos"; é "garantir continuidade quando o terminal principal
falha".** Essa mudança **simplifica** a arquitetura de forma real, não
cosmética:

- O cenário de "dois terminais vendendo o mesmo produto ao mesmo tempo",
  que na v1 era tratado como caso constante, agora é **raro** — só
  aconteceria numa janela curta de transição entre desativar um terminal
  e ativar o outro. Continua tratado com segurança (event log aditivo),
  mas deixa de ser o centro do desenho.
- Não existe mais "N dispositivos sincronizando entre si" — existe
  "1 dispositivo ativo por vez, sincronizando com a nuvem". Isso elimina
  a necessidade de qualquer coordenação direta entre dispositivos: eles
  nunca falam um com o outro, só com o Supabase. A "sincronização quando
  o computador voltar" é, na prática, **o computador simplesmente
  puxando do Supabase o que o celular já enviou** — não uma sincronização
  especial entre os dois aparelhos.

## 2. Conceito: Terminal Principal e Terminal Emergencial

Dois papéis, explícitos no sistema (não apenas na cabeça do dono):

| | Terminal Principal | Terminal Emergencial |
|---|---|---|
| Equipamento | Computador da loja | Celular autorizado (único) |
| Uso normal | Todo dia, o tempo todo | Nunca, em operação normal |
| Quando assume vendas | Sempre, exceto contingência | Só quando o Principal está indisponível |
| Precisa de cadastro prévio | Não (é o padrão) | **Sim — autorização explícita** |

### Cadastro de dispositivo autorizado

Novo dado necessário: **só um dispositivo específico pode agir como
Terminal Emergencial** — não "qualquer celular com o app aberto". Isso
exige um registro de autorização:

```
dispositivos_autorizados
  id (uuid)
  tipo            ('principal' | 'emergencial')
  identificador    (gerado uma vez, salvo no localStorage do aparelho — não muda)
  nome             ("Celular do gerente", por exemplo)
  ativo            (boolean — desativar remotamente se o aparelho for trocado/perdido)
  criado_em
```

Ao abrir o sistema pela primeira vez num aparelho, ele **não tem** papel
nenhum até um proprietário/gerente autorizá-lo explicitamente como
Emergencial (via PIN, na própria tela — uma ação administrativa simples,
não um cadastro complexo). O Principal pode ser autorizado da mesma forma,
ou simplesmente assumido como padrão no primeiro uso do computador da loja.

## 3. Fluxo de contingência (o núcleo desta versão)

```
[Operação normal: Terminal Principal (PC) vendendo]
        │
        ▼
[PC fica indisponível: sem energia, sem internet, travou, etc.]
        │
        ▼
[Gerente/operador abre o app no celular autorizado]
        │
        ▼
[Celular verifica: sou um dispositivo com tipo = 'emergencial' e ativo = true?]
        │
   não ─┤──> bloqueia o uso como terminal de venda (mas não impede
        │     consulta/leitura, se aplicável) — evita que qualquer
        │     aparelho não autorizado vire um terminal de vendas "de fato"
        │
   sim ─┘
        ▼
[Evento de auditoria: "Terminal Emergencial ativado" — quem, quando, motivo]
        │
        ▼
[Celular passa a vender normalmente — mesmo fluxo de PDV, mesma regra de
 negócio, gravando local (IndexedDB) igual ao PC faria]
        │
        ▼
   (celular tem internet? via dados móveis, provavelmente sim mesmo com
    o PC/energia da loja fora do ar — mas o desenho não depende disso:
    se tiver, sincroniza direto; se não tiver também, fica na fila local
    até ter, exatamente como o PC faria)
        │
        ▼
[PC volta a funcionar]
        │
        ▼
[PC, ao reconectar, puxa do Supabase tudo que já sincronizou —
 incluindo o que o celular vendeu enquanto esteve ativo. Não existe
 sincronização direta celular→PC: os dois só falam com a nuvem.]
        │
        ▼
[Evento de auditoria: "Terminal Emergencial encerrado" — quando o
 gerente confirma que o PC voltou e a operação normal foi retomada]
```

**Ponto chave de simplicidade:** o PC e o celular **nunca precisam se
comunicar entre si.** Cada um só fala com o Supabase, quando tem conexão.
"Sincronizar quando o computador voltar" não é uma funcionalidade nova —
é a consequência natural de o PC, ao voltar a ter conexão, simplesmente
consultar o mesmo banco de dados na nuvem, onde as vendas do celular já
estão (ou chegarão assim que o celular também sincronizar).

## 4. Banco local — mantido da v1

IndexedDB via Dexie.js continua a escolha certa, pelos mesmos motivos já
documentados (Promises em vez de API baseada em eventos, maduro, sem
binário WASM pesado). **Ambos** os terminais (PC e celular) têm sua
própria cópia local — o PC porque pode perder internet mesmo com energia
e hardware funcionando; o celular porque, em contingência, pode não ter
sinal de dados o tempo todo.

Tabelas locais: iguais à v1 (`produtos_local`, `categorias_local`,
`funcionarios_local`, `estoque_local`, `vendas_pendentes`,
`itens_venda_pendentes`, `movimentacoes_pendentes`,
`fila_sincronizacao`, `configuracoes_local`), **mais** uma nova:
`papel_dispositivo` (armazena localmente se este aparelho é Principal ou
Emergencial, e se está ativo — evita depender só do servidor para essa
checagem quando, ironicamente, é exatamente na falta de conexão que essa
checagem mais importa).

## 5. Estratégia de conflitos — simplificada

Como só existe um terminal *ativo* por vez na prática, a maioria dos
cenários de conflito da v1 deixa de ser uma preocupação central. Mantidos
por segurança (nunca custam nada a mais, e cobrem a janela curta de
transição), mas não são mais o foco do desenho:

| Cenário | Resolução |
|---|---|
| Venda registrada pelo celular enquanto o PC ainda está "meio" online (janela de transição) | Sem problema — vendas são sempre aditivas (event log), nunca se sobrescrevem. O estoque final soma tudo, de onde quer que tenha vindo. |
| Preço desatualizado no celular (ficou muito tempo sem sincronizar "para baixo") | Preço no momento da venda vence — igual à v1. Mitigado na prática porque o celular só assume vendas por períodos curtos de contingência, não dias. |
| Celular autorizado é perdido/roubado | `dispositivos_autorizados.ativo = false` remotamente (via cadastro, com PIN de gerente) — invalida o papel de Emergencial na próxima vez que esse aparelho tentar sincronizar ou verificar seu papel. |
| Alguém tenta usar um celular **não autorizado** como terminal de vendas | Bloqueado na checagem de `papel_dispositivo` (seção 3) — nunca chega a gerar uma venda "fantasma" fora do controle. |

Removida da v2: toda a complexidade de "servidor sempre vence para
cadastro entre N terminais simultâneos" como preocupação constante — ela
continua tecnicamente verdadeira (existe só um servidor autoritativo),
mas não precisa de nenhum mecanismo especial de coordenação entre
dispositivos, porque eles nunca operam de verdade ao mesmo tempo.

## 6. Indicador visual — ajustado

Além dos estados já definidos na v1 (🟢 Online / 🟡 Sincronizando / 🔴
Offline + contador de pendências + última sincronização), adiciona-se:

- **Rótulo do papel do terminal**, sempre visível: "Terminal Principal"
  ou "⚠ Terminal Emergencial ativo" — para que ninguém esqueça que está
  operando em modo de contingência.
- No PC, ao reconectar depois de um período fora do ar: aviso "Vendas
  registradas no Terminal Emergencial durante sua ausência: N" (lido
  diretamente do Supabase, não requer nenhuma lógica nova além de uma
  consulta).

## 7. Auditoria — específica desta versão

Além dos eventos já previstos na v1 (início/fim de sincronização, erro,
conflito, reenvio, manual, dispositivo responsável), esta versão adiciona
dois eventos de auditoria explícitos e obrigatórios:

- **"Terminal Emergencial ativado"** — quem autorizou, quando, motivo
  (texto livre: "falta de energia", "PC travou", etc.)
- **"Terminal Emergencial encerrado"** — quem confirmou o encerramento,
  quando, quantas vendas foram feitas durante a contingência

Isso dá ao proprietário um relato completo e auditável de cada episódio
de contingência, sem precisar cruzar informações manualmente.

## 8. Riscos — atualizados para este cenário

- **Risco do PIN offline continua idêntico à v1** (hash replicado no
  dispositivo) — não muda com a simplificação do modelo de terminais.
  Ver v1, seção 8, para os detalhes — permanece válido.
- **Risco reduzido**: o cenário de "catálogo desatualizado por dias" da
  v1 fica menos provável — o celular só assume vendas por períodos curtos
  (contingência), não fica ativo por tempo suficiente para acumular muita
  defasagem de preço/produto.
- **Risco novo, pequeno**: se o celular autorizado for perdido/roubado
  *durante* uma contingência ativa (raro, mas possível), ele ainda tem
  o papel de Emergencial válido localmente até a próxima verificação —
  mitigado por exigir PIN em toda venda (o aparelho sozinho não vende
  nada sem autenticação de operador).
- **Simplicidade como benefício de segurança**: menos partes móveis
  (nunca há coordenação direta entre dispositivos) significa menos
  superfícies de bug — alinhado ao pedido explícito de priorizar
  simplicidade e facilidade de manutenção.

## 9. Impacto na arquitetura existente — mantido da v1

Sem mudanças em relação à v1: PDV, formulário de estoque e PIN passam a
gravar primeiro em IndexedDB local em ambos os terminais; Server Actions
existentes são preservadas e chamadas pelo worker de sincronização, não
mais diretamente pela tela. Módulos administrativos continuam
online-only. Único acréscimo: a tabela `dispositivos_autorizados` e a
checagem de papel do terminal antes de permitir vendas.

## 11. Nota técnica descoberta durante a Fase 3

O worker de sincronização (fase futura) **não pode reenviar o PIN** —
ele já foi digitado uma única vez, no momento da venda, e não fica
guardado (nem deveria). Isso significa que o worker não pode chamar
`finalizarVendaAction` (que exige PIN) para sincronizar uma venda da
fila. Ele precisará chamar diretamente `registrarVenda()`
(`services/vendas.service.ts`) — a função que já grava sem pedir PIN,
usada hoje só internamente por `finalizarVendaAction`. O `funcionario_id`
já foi capturado no momento da venda local (autenticado naquela hora) e
viaja dentro do payload da fila — não precisa ser revalidado no envio,
só a operação em si precisa ser gravada.

Confirmado na prática na Fase 4: o worker chama `registrarVenda()`
diretamente via uma nova Server Action sem PIN (`sincronizarVendaAction`),
exatamente como previsto acima.

## 12. Nota técnica descoberta durante a Fase 4

A previsão da nota acima estava certa, mas revelou um problema mais
grave ao ser implementada: a função de banco `registrar_venda_completa`
**nunca tinha aceitado um `id` como parâmetro** — o UUID sempre era
gerado no servidor (`default gen_random_uuid()`), não no dispositivo.
Isso significava que a promessa de idempotência ("reenviar o mesmo UUID
nunca duplica"), documentada desde a Fase 3, **não se sustentava na
prática** — o UUID local e o UUID final no servidor eram sempre
diferentes. Corrigido na migration `0014`: a função agora recebe `p_id`
e verifica primeiro se a venda já existe antes de inserir — se existir,
não faz nada e devolve o mesmo id, sem duplicar.

---

**Próximo passo, se aprovado**: implementação em etapas — (1) banco local
e espelhamento de leitura, (2) cadastro/autorização de dispositivo +
checagem de papel, (3) fila de sincronização e worker, (4) conversão do
PIN para local-first, (5) conversão do PDV, (6) conversão do formulário
de estoque, (7) indicador visual com papel do terminal, (8) auditoria de
ativação/encerramento de contingência, (9) testes de regressão completos,
(10) atualização de README/ROADMAP/PRODUCT_RULES.

## 13. Fase 6.5 — Confiabilidade, auditoria avançada e validação

Não alterou nenhuma decisão de arquitetura das seções anteriores — só
elevou a confiabilidade da implementação já existente (Fases 1-4):

- **Detecção de conflito real**: `registrar_venda_completa` (migration
  `0016`) agora retorna `{ id, ja_existia }` em vez de só `id`. O worker
  usa isso para distinguir "sincronizei uma venda nova" de "essa venda
  já existia, ignorei" — antes disso, os dois casos pareciam idênticos
  para quem fosse auditar depois.
- **Retry recalibrado**: 2s/5s/10s/30s/1min/5min (era 5s/10s/20s/40s na
  Fase 4). Mesma filosofia (baseado em dados persistidos, nunca em
  temporizador de memória) — só os números mudaram.
- **Verificação de integridade** roda antes de cada processamento da
  fila, isolando itens corrompidos sem gastar chamadas de rede neles.
- **Logs técnicos categorizados** e um **Dashboard de Sincronização**
  (`/sincronizacao`) deram visibilidade ao que antes só existia nos
  bastidores.

Detalhes completos: `AUDITORIA_SINCRONIZACAO.md`.

## 14. Status de implementação — atualizado

- ✅ Fase 1 — Infraestrutura
- ✅ Fase 2 — Catálogo local-first
- ✅ Fase 3 — PDV local-first (venda)
- ✅ Fase 4 — Sincronização automática
- ✅ Fase 6.5 — Confiabilidade, auditoria avançada e validação
- ⏳ PIN local-first (ainda não implementado — lacuna conhecida)
- ⏳ Cadastro/autorização de dispositivo (Terminal Emergencial)
- ⏳ Estoque local-first (movimentação manual: entrada/perda/ajuste)