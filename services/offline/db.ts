import Dexie, { Table } from "dexie";

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
  pin_hash: string;
  ativo: boolean;
  updated_at: string;
}

export interface EstoqueLocal {
  produto_id: string;
  quantidade_atual: number;
  estoque_minimo: number;
  updated_at: string;
}

export type TipoOperacaoFila = "venda" | "movimentacao_estoque";
export type StatusFila = "pendente" | "sincronizando" | "sincronizado" | "erro";

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

export type StatusVendaLocal = "pendente_sincronizacao" | "sincronizada";

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
  | "sync_item_erro";

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