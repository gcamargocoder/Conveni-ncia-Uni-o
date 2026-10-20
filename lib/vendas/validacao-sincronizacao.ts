import { possuiPermissao } from "@/lib/auth/permissoes";
import type { Cargo } from "@/types/funcionario";
import type { FormaPagamento } from "@/types/venda";

/**
 * Regras do servidor para uma venda que chega da fila offline (ou do PDV online).
 * Lógica pura (sem banco): o serviço busca os dados de referência e chama aqui.
 *
 * Princípios:
 *  - Nada que vem do navegador é prova de nada: preço, quantidade, total e
 *    funcionário são conferidos contra o banco.
 *  - O sistema nunca descarta uma venda em silêncio (PRODUCT_RULES.md): quando algo
 *    não confere, a venda fica RETIDA para revisão de um administrador, com os motivos.
 *  - "bloqueante" = o payload não tem como virar uma venda válida (malformado, produto
 *    ou funcionário inexistente). "divergencia" = pode ser legítimo (preço mudou depois
 *    que o aparelho sincronizou, funcionário desativado depois da venda...) e só um
 *    administrador pode aprovar.
 */

export type GravidadeMotivo = "bloqueante" | "divergencia";

export interface MotivoRevisao {
  codigo: string;
  mensagem: string;
  gravidade: GravidadeMotivo;
  /** Posição do item no payload, quando o motivo é de um item. */
  item?: number;
}

export interface ItemRecebido {
  produto_id: string;
  quantidade: number;
  preco_unitario: number;
}

export interface VendaRecebida {
  funcionario_id: string;
  forma_pagamento: FormaPagamento;
  total?: number;
  dispositivo?: string;
  terminal?: string;
  itens: ItemRecebido[];
  cliente_id?: string | null;
}

export const FORMAS_PAGAMENTO: readonly FormaPagamento[] = ["dinheiro", "debito", "credito", "pix", "fiado"];
export const MAX_ITENS_POR_VENDA = 500;
/** Limites das colunas: quantidade Decimal(10,3), preço/total Decimal(10,2). */
export const MAX_QUANTIDADE = 9_999_999;
export const MAX_VALOR_CENTAVOS = 99_999_999_99;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function uuidValido(valor: unknown): valor is string {
  return typeof valor === "string" && UUID.test(valor);
}

/** Converte para centavos inteiros; null se não for número finito com no máximo 2 casas. */
export function paraCentavos(valor: unknown): number | null {
  if (typeof valor !== "number" || !Number.isFinite(valor)) return null;
  const c = Math.round(valor * 100);
  return Math.abs(valor * 100 - c) < 1e-6 ? c : null;
}

/** Converte para milésimos inteiros; null se não for número finito com no máximo 3 casas. */
export function paraMilesimos(valor: unknown): number | null {
  if (typeof valor !== "number" || !Number.isFinite(valor)) return null;
  const m = Math.round(valor * 1000);
  return Math.abs(valor * 1000 - m) < 1e-6 ? m : null;
}

function bloqueante(codigo: string, mensagem: string, item?: number): MotivoRevisao {
  return { codigo, mensagem, gravidade: "bloqueante", item };
}

function divergencia(codigo: string, mensagem: string, item?: number): MotivoRevisao {
  return { codigo, mensagem, gravidade: "divergencia", item };
}

/** Valida apenas a forma do payload (sem consultar o banco). */
export function validarEstruturaVenda(id: unknown, payload: unknown): MotivoRevisao[] {
  const motivos: MotivoRevisao[] = [];

  if (!uuidValido(id)) motivos.push(bloqueante("id_invalido", "Identificador da venda inválido."));
  if (typeof payload !== "object" || payload === null) {
    motivos.push(bloqueante("payload_invalido", "Venda sem conteúdo válido."));
    return motivos;
  }
  const p = payload as Record<string, unknown>;

  if (!uuidValido(p.funcionario_id)) motivos.push(bloqueante("funcionario_invalido", "Funcionário da venda inválido."));
  if (typeof p.forma_pagamento !== "string" || !FORMAS_PAGAMENTO.includes(p.forma_pagamento as FormaPagamento)) {
    motivos.push(bloqueante("pagamento_invalido", "Forma de pagamento inválida."));
  }
  if (p.cliente_id != null && !uuidValido(p.cliente_id)) {
    motivos.push(bloqueante("cliente_invalido", "Cliente da venda inválido."));
  }
  if (p.forma_pagamento === "fiado" && !uuidValido(p.cliente_id)) {
    motivos.push(bloqueante("fiado_sem_cliente", "Venda fiado exige um cliente cadastrado."));
  }

  if (!Array.isArray(p.itens) || p.itens.length === 0) {
    motivos.push(bloqueante("sem_itens", "Venda sem itens."));
    return motivos;
  }
  if (p.itens.length > MAX_ITENS_POR_VENDA) {
    motivos.push(bloqueante("itens_demais", `Venda com mais de ${MAX_ITENS_POR_VENDA} itens.`));
    return motivos;
  }

  let totalCentavos = 0;
  p.itens.forEach((bruto, i) => {
    const item = (bruto ?? {}) as Record<string, unknown>;
    if (!uuidValido(item.produto_id)) {
      motivos.push(bloqueante("produto_invalido", "Produto do item inválido.", i));
    }

    const milesimos = paraMilesimos(item.quantidade);
    if (milesimos === null || milesimos <= 0 || (item.quantidade as number) > MAX_QUANTIDADE) {
      motivos.push(
        bloqueante("quantidade_invalida", "Quantidade inválida (deve ser maior que zero, com até 3 casas decimais).", i)
      );
    }

    const centavos = paraCentavos(item.preco_unitario);
    if (centavos === null || centavos < 0 || centavos > MAX_VALOR_CENTAVOS) {
      motivos.push(bloqueante("preco_invalido", "Preço unitário inválido.", i));
    } else if (milesimos !== null && milesimos > 0) {
      totalCentavos += Math.round((centavos * milesimos) / 1000);
    }
  });

  if (totalCentavos > MAX_VALOR_CENTAVOS) motivos.push(bloqueante("total_excede_limite", "Total da venda acima do limite."));

  return motivos;
}

export interface ReferenciaProduto {
  preco_venda: number;
  ativo: boolean;
  deleted: boolean;
}

export interface ReferenciaVenda {
  funcionario: { ativo: boolean; deleted: boolean; cargo: Cargo } | null;
  /** undefined quando a venda não informa cliente. */
  cliente?: { ativo: boolean; deleted: boolean } | null;
  produtos: Map<string, ReferenciaProduto>;
}

/** Soma em centavos, como o servidor cobraria (assume estrutura já validada). */
export function totalEmCentavos(itens: ItemRecebido[]): number {
  return itens.reduce(
    (soma, i) => soma + Math.round(((paraCentavos(i.preco_unitario) ?? 0) * (paraMilesimos(i.quantidade) ?? 0)) / 1000),
    0
  );
}

/** Confere uma venda de estrutura válida contra os dados confiáveis do banco. */
export function avaliarVendaContraReferencia(venda: VendaRecebida, ref: ReferenciaVenda): MotivoRevisao[] {
  const motivos: MotivoRevisao[] = [];

  if (!ref.funcionario) {
    motivos.push(bloqueante("funcionario_inexistente", "O funcionário informado não existe."));
  } else {
    if (!ref.funcionario.ativo || ref.funcionario.deleted) {
      motivos.push(divergencia("funcionario_inativo", "O funcionário informado está inativo ou foi removido."));
    }
    if (!possuiPermissao(ref.funcionario.cargo, "pdv.vender")) {
      motivos.push(divergencia("funcionario_sem_permissao", "O cargo do funcionário não tem permissão para vender."));
    }
  }

  if (venda.cliente_id != null) {
    if (!ref.cliente) {
      motivos.push(bloqueante("cliente_inexistente", "O cliente informado não existe."));
    } else if (!ref.cliente.ativo || ref.cliente.deleted) {
      motivos.push(divergencia("cliente_inativo", "O cliente informado está inativo ou foi removido."));
    }
  }

  venda.itens.forEach((item, i) => {
    const produto = ref.produtos.get(item.produto_id);
    if (!produto) {
      motivos.push(bloqueante("produto_inexistente", "Produto inexistente no servidor.", i));
      return;
    }
    if (!produto.ativo || produto.deleted) {
      motivos.push(divergencia("produto_inativo", "Produto inativo ou removido no servidor.", i));
    }
    const informado = paraCentavos(item.preco_unitario);
    const oficial = paraCentavos(produto.preco_venda);
    if (informado !== oficial) {
      const fmt = (c: number | null) => (c === null ? "?" : (c / 100).toFixed(2).replace(".", ","));
      motivos.push(
        divergencia(
          "preco_divergente",
          `Preço informado R$ ${fmt(informado)} difere do preço cadastrado R$ ${fmt(oficial)}.`,
          i
        )
      );
    }
  });

  if (venda.total !== undefined && paraCentavos(venda.total) !== totalEmCentavos(venda.itens)) {
    motivos.push(divergencia("total_incoerente", "O total informado não confere com a soma dos itens."));
  }

  return motivos;
}

export function possuiMotivoBloqueante(motivos: MotivoRevisao[]): boolean {
  return motivos.some((m) => m.gravidade === "bloqueante");
}
