"use client";

import { useState, useEffect, useRef } from "react";
import { Banknote, Smartphone, CreditCard, Landmark, ShoppingCart } from "lucide-react";
import { ProdutoBusca } from "@/components/pdv/ProdutoBusca";
import { CarrinhoView } from "@/components/pdv/CarrinhoView";
import { PinInput } from "@/components/auth/PinInput";
import { ReciboTermico } from "@/components/pdv/ReciboTermico";
import { EstoqueInsuficienteModal, PendenciaEstoque } from "@/components/pdv/EstoqueInsuficienteModal";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/ToastProvider";
import { ItemCarrinho, adicionarItem, removerItem, alterarQuantidade, calcularTotal } from "@/lib/vendas/carrinho";
import { registrarVendaLocal } from "@/services/offline/vendas-local.service";
import { processarFilaSincronizacao } from "@/services/offline/worker-sincronizacao.service";
import { salvarCarrinhoLocal, carregarCarrinhoLocal, limparCarrinhoLocal } from "@/services/offline/carrinho-local.service";
import { obterEstoqueLocalPorProduto } from "@/services/offline/estoque-local.service";
import { registrarEventoAuditoriaLocal } from "@/services/offline/auditoria-local.service";
import { validarPinLocalmente } from "@/services/offline/pin-local.service";
import { FormaPagamento, ProdutoParaVenda } from "@/types/venda";
import { VendaCompleta } from "@/services/vendas.service";

const FORMAS: { valor: FormaPagamento; rotulo: string; icone: typeof Banknote }[] = [
  { valor: "dinheiro", rotulo: "Dinheiro", icone: Banknote },
  { valor: "pix", rotulo: "PIX", icone: Smartphone },
  { valor: "debito", rotulo: "Débito", icone: CreditCard },
  { valor: "credito", rotulo: "Crédito", icone: Landmark },
];

interface PendenciaEstoqueComProduto extends PendenciaEstoque {
  produtoParaAdicionar?: ProdutoParaVenda;
}

export function PDVClient() {
  const [carrinho, setCarrinho] = useState<ItemCarrinho[]>([]);
  const [formaPagamento, setFormaPagamento] = useState<FormaPagamento>("dinheiro");
  const [pedindoPin, setPedindoPin] = useState(false);
  const [pedindoCancelamento, setPedindoCancelamento] = useState(false);
  const [pendenciaEstoque, setPendenciaEstoque] = useState<PendenciaEstoqueComProduto | null>(null);
  const [ultimaVendaLocal, setUltimaVendaLocal] = useState<VendaCompleta | null>(null);
  const carregouCarrinhoInicial = useRef(false);
  const { mostrar } = useToast();

  const total = calcularTotal(carrinho);

  useEffect(() => {
    carregarCarrinhoLocal().then((itens) => {
      if (itens.length > 0) setCarrinho(itens);
      carregouCarrinhoInicial.current = true;
    });
  }, []);

  useEffect(() => {
    if (!carregouCarrinhoInicial.current) return;
    salvarCarrinhoLocal(carrinho);
  }, [carrinho]);

  async function finalizarComPin(pin: string) {
    const auth = await validarPinLocalmente(pin);
    if (!auth.sucesso || !auth.funcionario) {
      throw new Error(auth.erro ?? "PIN inválido.");
    }

    const resultado = await registrarVendaLocal({
      itens: carrinho,
      formaPagamento,
      funcionarioId: auth.funcionario.id,
      funcionarioNome: auth.funcionario.nome,
    });

    if (!resultado.sucesso || !resultado.vendaId) {
      throw new Error(resultado.erro ?? "Erro ao salvar a venda localmente.");
    }

    setUltimaVendaLocal({
      id: resultado.vendaId,
      created_at: new Date().toISOString(),
      total,
      forma_pagamento: formaPagamento,
      cancelada: false,
      itens: carrinho.map((i) => ({
        produto_nome: i.nome,
        quantidade: i.quantidade,
        preco_unitario: i.preco_unitario,
      })),
    });
    setCarrinho([]);
    mostrar("success", "Venda salva localmente.");

    processarFilaSincronizacao();
  }

  async function confirmarCancelamento() {
    await limparCarrinhoLocal();
    setCarrinho([]);
    setPedindoCancelamento(false);
    mostrar("info", "Venda cancelada.");
  }

  async function verificarEAplicarQuantidade(
    produtoId: string,
    nome: string,
    quantidadeDesejada: number,
    produtoParaAdicionar?: ProdutoParaVenda
  ) {
    if (quantidadeDesejada <= 0) {
      setCarrinho((c) => removerItem(c, produtoId));
      return;
    }

    const estoque = await obterEstoqueLocalPorProduto(produtoId);
    const disponivel = estoque?.quantidade_atual ?? 0;

    if (quantidadeDesejada > disponivel) {
      setPendenciaEstoque({
        produtoId,
        nome,
        quantidadeSolicitada: quantidadeDesejada,
        quantidadeDisponivel: disponivel,
        produtoParaAdicionar,
      });
      registrarEventoAuditoriaLocal("estoque_insuficiente_tentativa", {
        detalhes: `${nome}: solicitado ${quantidadeDesejada}, disponível ${disponivel}`,
      });
      return;
    }

    if (produtoParaAdicionar) {
      setCarrinho((c) => adicionarItem(c, produtoParaAdicionar, quantidadeDesejada));
    } else {
      setCarrinho((c) => alterarQuantidade(c, produtoId, quantidadeDesejada));
    }
  }

  async function aoSelecionarProduto(produto: ProdutoParaVenda) {
    const itemExistente = carrinho.find((i) => i.produto_id === produto.produto_id);
    const quantidadeDesejada = (itemExistente?.quantidade ?? 0) + 1;
    await verificarEAplicarQuantidade(
      produto.produto_id,
      produto.nome,
      quantidadeDesejada,
      itemExistente ? undefined : produto
    );
  }

  async function aoAlterarQuantidadeNoCarrinho(produtoId: string, quantidade: number) {
    const item = carrinho.find((i) => i.produto_id === produtoId);
    await verificarEAplicarQuantidade(produtoId, item?.nome ?? "", quantidade);
  }

  function aplicarAjusteDeEstoque() {
    if (!pendenciaEstoque) return;
    const { produtoId, quantidadeDisponivel, produtoParaAdicionar } = pendenciaEstoque;

    if (quantidadeDisponivel <= 0) {
      setCarrinho((c) => removerItem(c, produtoId));
    } else if (produtoParaAdicionar) {
      setCarrinho((c) => adicionarItem(c, produtoParaAdicionar, quantidadeDisponivel));
    } else {
      setCarrinho((c) => alterarQuantidade(c, produtoId, quantidadeDisponivel));
    }

    registrarEventoAuditoriaLocal("estoque_ajuste_automatico", {
      detalhes: `${pendenciaEstoque.nome}: ajustado de ${pendenciaEstoque.quantidadeSolicitada} para ${quantidadeDisponivel}`,
    });
    setPendenciaEstoque(null);
  }

  if (ultimaVendaLocal) {
    return (
      <main className="min-h-screen bg-slate-50 py-8">
        <ReciboTermico venda={ultimaVendaLocal} />
        <div className="text-center mt-6">
          <Button onClick={() => setUltimaVendaLocal(null)}>Nova venda</Button>
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-6xl mx-auto px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Venda</h1>
        <p className="text-slate-500 text-sm">Realizar venda</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 flex flex-col gap-4">
          <Card>
            <ProdutoBusca onSelecionar={aoSelecionarProduto} />
          </Card>

          <Card semPadding className="p-2">
            <CarrinhoView
              itens={carrinho}
              onAlterarQuantidade={aoAlterarQuantidadeNoCarrinho}
              onRemover={(id) => setCarrinho((c) => removerItem(c, id))}
            />
          </Card>
        </div>

        <div className="lg:sticky lg:top-4 lg:self-start">
          <Card className="flex flex-col gap-5">
            <div className="flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-brand-700" />
              <h2 className="text-sm font-semibold text-slate-700">Resumo da venda</h2>
            </div>

            <div className="flex items-baseline justify-between border-y border-slate-100 py-4">
              <span className="text-slate-500 text-sm">Total</span>
              <span className="text-3xl font-bold text-slate-900 tabular-nums">R$ {total.toFixed(2)}</span>
            </div>

            <div>
              <p className="text-xs font-medium text-slate-500 mb-2">Forma de pagamento</p>
              <div className="grid grid-cols-2 gap-2">
                {FORMAS.map((f) => {
                  const Icone = f.icone;
                  const ativo = formaPagamento === f.valor;
                  return (
                    <button
                      key={f.valor}
                      onClick={() => setFormaPagamento(f.valor)}
                      className={`w-full flex flex-col items-center justify-center gap-1.5 h-16 rounded-lg border text-sm font-medium transition-colors ${
                        ativo
                          ? "bg-brand-700 text-white border-brand-700"
                          : "bg-white text-slate-600 border-slate-200 hover:border-brand-600"
                      }`}
                    >
                      <Icone className="w-4 h-4" />
                      {f.rotulo}
                    </button>
                  );
                })}
              </div>
            </div>

            <Button tamanho="lg" larguraTotal disabled={carrinho.length === 0} onClick={() => setPedindoPin(true)}>
              Finalizar venda
            </Button>

            {carrinho.length > 0 && (
              <Button variante="ghost" tamanho="sm" onClick={() => setPedindoCancelamento(true)}>
                Cancelar venda
              </Button>
            )}
          </Card>
        </div>
      </div>

      <Modal aberto={pedindoPin} titulo="Confirmar venda" onFechar={() => setPedindoPin(false)}>
        <p className="mb-4">Digite o PIN do operador para concluir a venda:</p>
        <PinInput modo="confirmacao" onPinCompleto={finalizarComPin} onSucesso={() => setPedindoPin(false)} />
      </Modal>

      <Modal
        aberto={pedindoCancelamento}
        titulo="Cancelar venda"
        onFechar={() => setPedindoCancelamento(false)}
        rodape={
          <>
            <Button variante="secondary" tamanho="sm" onClick={() => setPedindoCancelamento(false)}>
              Voltar
            </Button>
            <Button variante="danger" tamanho="sm" onClick={confirmarCancelamento}>
              Cancelar venda
            </Button>
          </>
        }
      >
        Os itens do carrinho serão perdidos. Esta ação não pode ser desfeita.
      </Modal>

      <EstoqueInsuficienteModal
        pendencia={pendenciaEstoque}
        onAjustar={aplicarAjusteDeEstoque}
        onCancelar={() => setPendenciaEstoque(null)}
      />
    </main>
  );
}