# Auditoria de Arquitetura — Convenience SaaS

Data desta revisão: pós-Etapa 11 (MVP completo + correções de segurança).
Escopo: revisão completa, sem novas funcionalidades. Refatorações aplicadas
estão marcadas ✅. Itens sem correção nesta rodada estão marcados ⏳, com
justificativa.

## 1. Arquitetura
✅ Camadas respeitadas em 100% dos módulos (tela → componente → lib → services → banco).
✅ Nenhuma tela consulta o Supabase diretamente.
⏳ Sem Offline First (decisão consciente e documentada desde a Etapa 1).

## 2. Organização
✅ Corrigido: `FornecedorForm` estava em `components/produtos/`, movido para `components/fornecedores/`.
✅ Server Action de estoque simplificada — mapeamento tipo→permissão movido para `lib/estoque/movimentacao.ts` (regra de negócio), não mais um ternário dentro da action.

## 3. Escalabilidade
✅ **Corrigido gargalo crítico**: PDV carregava o catálogo inteiro de produtos no navegador a cada acesso. Agora busca no servidor (`buscarProdutosParaVenda`), com debounce e limite de 8 resultados.
✅ Listagens sem paginação (produtos, funcionários, fornecedores, histórico, relatórios) agora têm `.limit()` defensivo — não impede crescimento, mas evita que uma tabela gigante trave uma resposta.
⏳ Paginação de verdade (cursor/offset) não foi implementada — é uma funcionalidade nova, fora do escopo desta auditoria. Recomendado antes de qualquer cliente passar de ~1000 produtos ativos.
✅ Índice `pg_trgm` adicionado para busca de produtos por nome continuar rápida em catálogos grandes (migration `0012`).

## 4. Performance
✅ Estoque abaixo do mínimo: antes trazia toda a tabela e filtrava em JS; agora filtra no banco via coluna calculada na view (migration `0013`).
✅ `autenticarPorPin` documentado como aceitável (escala por funcionários de um posto, dezenas — não por clientes do SaaS), não corrigido por não ser gargalo real no cenário atual.

## 5. Segurança
✅ RLS habilitado em todas as tabelas (migration `0010`) — antes a chave pública do navegador tinha acesso irrestrito ao banco.
✅ Servidor migrado de `anon key` para `service_role` (secreta).
✅ Proteção contra força bruta no PIN (migration `0011`, bloqueio de 15 min após 5 tentativas).
✅ Sanitização do termo de busca do PDV antes de montar filtro PostgREST (evita manipulação da query via caracteres de controle `,` `(` `)`).
⏳ Sem auditoria de dependências (`npm audit`) nem cabeçalhos HTTP de segurança (CSP/HSTS) — recomendado no momento do deploy real.

## 6. UX
✅ Layout de formas de pagamento no PDV corrigido para não apertar em telas pequenas (grid responsivo em vez de flex fixo).
⏳ Mobile-first por metodologia (breakpoints deliberados) não foi feito — funciona em celular por simplicidade de layout, não por design responsivo formal.

## 7. Estrutura do banco
✅ View `estoque_atual` ganhou coluna calculada `abaixo_do_minimo`, evitando lógica de comparação de colunas no cliente.
✅ Nenhuma tabela sem `created_at`; tabelas de negócio têm soft delete.
⏳ `movimentacoes_estoque` não tem índice composto `(produto_id, created_at)` — hoje são dois índices separados; para relatórios de produto específico por período, um índice composto seria mais eficiente. Não aplicado por ser otimização especulativa sem medição real de carga ainda.

## 8. Qualidade do código / Duplicação / Acoplamento
✅ **19 pontos de acesso ao Supabase duplicando tratamento de erro** → centralizados em `services/supabase/query-helpers.ts` (`unwrap`).
✅ Removidos 2 casts `as any` que escondiam tipagem fraca do cargo do funcionário — `ResultadoAutenticacao.funcionario.cargo` agora é `Cargo`, não `string`.
✅ Tipo `ProdutoParaVenda` extraído para `types/venda.ts`, eliminando a mesma forma de objeto duplicada em 3 arquivos (`ProdutoBusca`, `PDVClient`, página do PDV).
⏳ Padrão `try { ...; revalidatePath(...); return { sucesso: true } } catch (e) { return { sucesso: false, erroGeral: ... } }` ainda se repete em ~6 Server Actions (produtos, estoque, vendas, categorias, fornecedores, funcionários). Não unifiquei porque cada uma devolve campos extras diferentes (`vendaId`, `categoria`, `erros` tipados por domínio) — generalizar exigiria mudar a assinatura pública consumida por vários componentes, risco maior que o benefício nesta rodada. Recomendado como próximo passo, com testes de regressão antes.

## 9. Boas práticas
✅ `.gitignore` criado (faltava — `.env.local` podia ir parar num repositório).
✅ `README.md` atualizado para refletir o estado real (estava descrevendo uma arquitetura de chaves já superada).

## 10. Responsividade
✅ Dashboard: grid fixo de 2 colunas → responsivo (`grid-cols-1 sm:grid-cols-2`).
✅ PDV: formas de pagamento em grid responsivo em vez de `flex` fixo de 4 itens.
⏳ Não foi uma reescrita mobile-first completa (breakpoints em todo componente) — ver débito técnico já registrado no README.

## 11. Bugs corrigidos nesta auditoria
- **Crítico (não implementado, pego antes de ir para produção)**: tentativa inicial de filtrar estoque abaixo do mínimo com `.filter("quantidade_atual", "lt", "estoque_minimo")` não funcionaria — PostgREST não compara duas colunas assim. Resolvido corretamente com coluna calculada na view.
- Cargo do funcionário autenticado tipado como `string` genérico, exigindo `as any` em 2 lugares — corrigido na origem.

## 12. Gargalos identificados (alguns corrigidos, outros documentados)
- PDV carregando catálogo inteiro → corrigido.
- Estoque baixo filtrado em JS → corrigido.
- `autenticarPorPin` com loop de bcrypt.compare → aceito conscientemente (não é gargalo no cenário real de uso).
- Ausência de paginação real nas listagens → documentado como próximo passo, não implementado (seria funcionalidade nova).
