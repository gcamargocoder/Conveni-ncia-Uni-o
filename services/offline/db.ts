import Dexie, { Table } from "dexie";
import { cargoPodeUsarPinOffline } from "@/lib/auth/permissoes";
import type { FormaCaixa, OrigemOperacao, ResumoCaixa, Sentido, TipoMovimento, ConferenciaInformada, DiferencaForma } from "@/lib/caixa/tipos";

export interface ProdutoLocal {
  id: string;
  nome: string;
  preco_venda: number;
  codigo_barras: string | null;
  categoria_id: string;
  ativo: boolean;
  updated_at: string;
}

export interface CategoriaLocal {
  id: string;
  nome: string;
  ativo: boolean;
  updated_at: string;
}

export interface FuncionarioLocal {
  id: string;
  nome: string;
  cargo: string;
  ativo: boolean;
  updated_at: string;
}

/**
 * Verificador do PIN para uso OFFLINE. Fica em tabela própria, separada do catálogo, e só
 * existe para cargos cuja ÚNICA permissão é vender (ver cargoPodeUsarPinOffline). PINs de
 * quem pode mais (gerente, proprietário...) nunca saem do servidor.
 */
export interface CredencialPinLocal {
  funcionario_id: string;
  pin_hash: string;
  atualizado_em: string;
}

export interface ClienteLocal {
  id: string;
  nome: string;
  telefone: string | null;
  ativo: boolean;
  updated_at: string;
}

export interface EstoqueLocal {
  produto_id: string;
  quantidade_atual: number;
  estoque_minimo: number;
  updated_at: string;
}

export type TipoOperacaoFila =
  | "venda"
  | "movimentacao_estoque"
  | "caixa_abertura"
  | "caixa_movimento"
  | "caixa_estorno"
  | "caixa_fechamento";

/**
 * Caixa no aparelho. O caixa pertence ao TERMINAL (este navegador). Tudo o que acontece nele é gravado
 * aqui primeiro (funciona offline) e enviado depois pela fila. `*_sincronizada/confirmado` indicam o que
 * o servidor já aceitou: um fechamento só é "confirmado" depois da resposta do servidor.
 */
export interface CaixaLocal {
  id: string;
  terminal_id: string;
  terminal_papel: string | null;
  status: "aberto" | "fechado";
  fundo_inicial_centavos: number;
  observacoes_abertura: string | null;
  aberto_em: string;
  aberto_por_funcionario_id: string;
  aberto_por_funcionario_nome: string;
  origem_abertura: "online" | "offline";
  abertura_sincronizada: boolean;
  fechado_em: string | null;
  fechado_por_funcionario_id: string | null;
  fechado_por_funcionario_nome: string | null;
  origem_fechamento: "online" | "offline" | null;
  conferencia: ConferenciaInformada | null;
  justificativa_divergencia: string | null;
  resumo_local: ResumoCaixa | null;
  diferencas_local: DiferencaForma[] | null;
  diferenca_total_centavos: number | null;
  fechamento_confirmado_servidor: boolean;
  resumo_servidor: unknown | null;
  /** Operação recusada pelo servidor e preservada para tratamento do administrador. */
  conflito: string | null;
}

export interface MovimentoCaixaLocal {
  id: string;
  caixa_id: string;
  /** Id da operação na fila (venda: id da venda; demais: o próprio id da operação). */
  operacao_id: string;
  tipo: TipoMovimento;
  sentido: Sentido;
  forma_pagamento: FormaCaixa;
  valor_centavos: number;
  funcionario_id: string;
  funcionario_nome: string;
  dispositivo: string;
  origem: "online" | "offline";
  origem_operacao: OrigemOperacao;
  venda_id: string | null;
  estorno_de_id: string | null;
  ordem: number | null;
  descricao: string | null;
  justificativa: string | null;
  cartao_bandeira: string | null;
  cartao_adquirente: string | null;
  cartao_parcelas: number | null;
  cartao_taxa_centavos: number | null;
  transacao_id: string | null;
  ocorrido_em: string;
  sincronizado: boolean;
}
/**
 * "em_revisao": o servidor reteve a venda para um administrador decidir; "rejeitada": foi
 * rejeitada (ou era inválida). Em ambos os casos a venda PERMANECE no aparelho, visível,
 * e sai do ciclo de reenvio automático.
 */
export type StatusFila = "pendente" | "sincronizando" | "sincronizado" | "erro" | "em_revisao" | "rejeitada";

export interface ItemFilaSincronizacao {
  id: string;
  tipo: TipoOperacaoFila;
  payload: string;
  status: StatusFila;
  tentativas: number;
  criado_em: string;
  ultima_tentativa_em: string | null;
  erro: string | null;
}

export interface ConfiguracaoLocal {
  chave: string;
  valor: string;
}

export type TipoDispositivo = "principal" | "emergencial";

export interface PapelDispositivo {
  chave: "papel_dispositivo";
  tipo: TipoDispositivo;
  ativo: boolean;
}

export type TipoEventoSincronizacao = "inicio" | "fim" | "erro";

export interface EventoSincronizacaoLocal {
  id: string;
  tipo: TipoEventoSincronizacao;
  registros_atualizados: number | null;
  duracao_ms: number | null;
  detalhes: string | null;
  timestamp: string;
}

export type StatusVendaLocal = "pendente_sincronizacao" | "sincronizada" | "em_revisao" | "rejeitada";

export interface VendaLocal {
  id: string;
  funcionario_id: string;
  funcionario_nome: string;
  forma_pagamento: string;
  total: number;
  terminal: TipoDispositivo;
  dispositivo: string;
  status: StatusVendaLocal;
  cancelada: boolean;
  criado_em: string;
}

export interface ItemVendaLocal {
  id: string;
  venda_id: string;
  produto_id: string;
  produto_nome: string;
  quantidade: number;
  preco_unitario: number;
}

export interface ItemCarrinhoLocal {
  produto_id: string;
  nome: string;
  preco_unitario: number;
  quantidade: number;
  atualizado_em: string;
}

export type TipoEventoAuditoriaLocal =
  | "venda_iniciada"
  | "venda_concluida"
  | "venda_erro"
  | "fila_item_criado"
  | "sync_fila_inicio"
  | "sync_fila_fim"
  | "sync_item_sucesso"
  | "sync_item_erro"
  | "estoque_insuficiente_tentativa"
  | "estoque_ajuste_automatico"
  | "venda_bloqueada_estoque"
  | "caixa_aberto"
  | "caixa_movimento"
  | "caixa_estorno"
  | "caixa_fechado"
  | "caixa_conflito";

export interface EventoAuditoriaLocal {
  id: string;
  tipo: TipoEventoAuditoriaLocal;
  venda_id: string | null;
  funcionario_id: string | null;
  dispositivo: string | null;
  duracao_ms: number | null;
  detalhes: string | null;
  timestamp: string;
}

export type CategoriaLog =
  | "SYNC"
  | "QUEUE"
  | "OFFLINE"
  | "ONLINE"
  | "CACHE"
  | "DATABASE"
  | "PIN"
  | "PDV"
  | "ESTOQUE"
  | "ERRO"
  | "RECOVERY";

export type NivelLog = "info" | "aviso" | "erro";

export interface LogTecnico {
  id: string;
  categoria: CategoriaLog;
  nivel: NivelLog;
  mensagem: string;
  detalhes: string | null;
  timestamp: string;
}

class ConvenienceOfflineDB extends Dexie {
  produtos_local!: Table<ProdutoLocal, string>;
  categorias_local!: Table<CategoriaLocal, string>;
  funcionarios_local!: Table<FuncionarioLocal, string>;
  credenciais_pin_local!: Table<CredencialPinLocal, string>;
  clientes_local!: Table<ClienteLocal, string>;
  estoque_local!: Table<EstoqueLocal, string>;
  fila_sincronizacao!: Table<ItemFilaSincronizacao, string>;
  configuracoes_local!: Table<ConfiguracaoLocal, string>;
  papel_dispositivo!: Table<PapelDispositivo, string>;
  eventos_sincronizacao!: Table<EventoSincronizacaoLocal, string>;
  vendas_locais!: Table<VendaLocal, string>;
  itens_venda_locais!: Table<ItemVendaLocal, string>;
  carrinho_local!: Table<ItemCarrinhoLocal, string>;
  auditoria_local!: Table<EventoAuditoriaLocal, string>;
  logs_tecnicos!: Table<LogTecnico, string>;
  caixas_locais!: Table<CaixaLocal, string>;
  movimentos_caixa_locais!: Table<MovimentoCaixaLocal, string>;

  constructor() {
    super("convenience-saas-offline");
    this.version(1).stores({
      produtos_local: "id, nome, codigo_barras, categoria_id, ativo",
      categorias_local: "id, nome, ativo",
      funcionarios_local: "id, nome, cargo, ativo",
      estoque_local: "produto_id",
      fila_sincronizacao: "id, tipo, status, criado_em",
      configuracoes_local: "chave",
      papel_dispositivo: "chave",
    });
    this.version(2).stores({
      produtos_local: "id, nome, codigo_barras, categoria_id, ativo",
      categorias_local: "id, nome, ativo",
      funcionarios_local: "id, nome, cargo, ativo",
      estoque_local: "produto_id",
      fila_sincronizacao: "id, tipo, status, criado_em",
      configuracoes_local: "chave",
      papel_dispositivo: "chave",
      eventos_sincronizacao: "id, tipo, timestamp",
    });
    this.version(3).stores({
      produtos_local: "id, nome, codigo_barras, categoria_id, ativo",
      categorias_local: "id, nome, ativo",
      funcionarios_local: "id, nome, cargo, ativo",
      estoque_local: "produto_id",
      fila_sincronizacao: "id, tipo, status, criado_em",
      configuracoes_local: "chave",
      papel_dispositivo: "chave",
      eventos_sincronizacao: "id, tipo, timestamp",
      vendas_locais: "id, status, criado_em",
      itens_venda_locais: "id, venda_id",
      carrinho_local: "produto_id",
      auditoria_local: "id, tipo, venda_id, timestamp",
    });
    this.version(4).stores({
      produtos_local: "id, nome, codigo_barras, categoria_id, ativo",
      categorias_local: "id, nome, ativo",
      funcionarios_local: "id, nome, cargo, ativo",
      estoque_local: "produto_id",
      fila_sincronizacao: "id, tipo, status, criado_em",
      configuracoes_local: "chave",
      papel_dispositivo: "chave",
      eventos_sincronizacao: "id, tipo, timestamp",
      vendas_locais: "id, status, criado_em",
      itens_venda_locais: "id, venda_id",
      carrinho_local: "produto_id",
      auditoria_local: "id, tipo, venda_id, timestamp",
      logs_tecnicos: "id, categoria, nivel, timestamp",
    });
    // v5 (Etapa 8.7): clientes sincronizados localmente — necessário
    // pra venda fiado funcionar offline (buscar/selecionar cliente
    // sem depender de rede, mesmo princípio já usado com funcionários).
    this.version(5).stores({
      produtos_local: "id, nome, codigo_barras, categoria_id, ativo",
      categorias_local: "id, nome, ativo",
      funcionarios_local: "id, nome, cargo, ativo",
      clientes_local: "id, nome, ativo",
      estoque_local: "produto_id",
      fila_sincronizacao: "id, tipo, status, criado_em",
      configuracoes_local: "chave",
      papel_dispositivo: "chave",
      eventos_sincronizacao: "id, tipo, timestamp",
      vendas_locais: "id, status, criado_em",
      itens_venda_locais: "id, venda_id",
      carrinho_local: "produto_id",
      auditoria_local: "id, tipo, venda_id, timestamp",
      logs_tecnicos: "id, categoria, nivel, timestamp",
    });
    // v6 (integridade do PDV): pin_hash deixa de fazer parte do catálogo. Aparelhos que já
    // o tinham gravado em funcionarios_local têm o campo REMOVIDO aqui; o verificador
    // offline passa a viver em credenciais_pin_local (só cargos que apenas vendem).
    this.version(6)
      .stores({
        produtos_local: "id, nome, codigo_barras, categoria_id, ativo",
        categorias_local: "id, nome, ativo",
        funcionarios_local: "id, nome, cargo, ativo",
        credenciais_pin_local: "funcionario_id",
        clientes_local: "id, nome, ativo",
        estoque_local: "produto_id",
        fila_sincronizacao: "id, tipo, status, criado_em",
        configuracoes_local: "chave",
        papel_dispositivo: "chave",
        eventos_sincronizacao: "id, tipo, timestamp",
        vendas_locais: "id, status, criado_em",
        itens_venda_locais: "id, venda_id",
        carrinho_local: "produto_id",
        auditoria_local: "id, tipo, venda_id, timestamp",
        logs_tecnicos: "id, categoria, nivel, timestamp",
      })
      .upgrade(async (tx) => {
        // Preserva o PIN offline de quem só vende (para não parar o PDV de aparelhos que
        // atualizarem sem internet) e apaga o hash de todos os demais.
        const agora = new Date().toISOString();
        const funcionarios = (await tx.table("funcionarios_local").toArray()) as Record<string, unknown>[];
        for (const f of funcionarios) {
          if (typeof f.pin_hash === "string" && cargoPodeUsarPinOffline(String(f.cargo))) {
            await tx.table("credenciais_pin_local").put({ funcionario_id: f.id, pin_hash: f.pin_hash, atualizado_em: agora });
          }
        }
        await tx
          .table("funcionarios_local")
          .toCollection()
          .modify((f: Record<string, unknown>) => {
            delete f.pin_hash;
          });
      });
    // v7 (controle de caixa): tabelas NOVAS. Nenhuma tabela existente é tocada nem recriada.
    this.version(7).stores({
      caixas_locais: "id, terminal_id, status, aberto_em",
      movimentos_caixa_locais: "id, caixa_id, operacao_id, venda_id, ocorrido_em",
    });
  }
}

let instancia: ConvenienceOfflineDB | null = null;

export function getOfflineDB(): ConvenienceOfflineDB {
  if (typeof indexedDB === "undefined") {
    throw new Error(
      "O banco local (IndexedDB) não está disponível neste ambiente. " +
        "Este código deve rodar só no navegador (Client Component)."
    );
  }
  if (!instancia) {
    instancia = new ConvenienceOfflineDB();
  }
  return instancia;
}