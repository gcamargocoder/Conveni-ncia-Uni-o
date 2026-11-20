"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { Banknote, Smartphone, CreditCard, Landmark, HandCoins, ShoppingCart, User, X, Search, Split, Lock } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { StatusCaixaBadge } from "@/components/caixa/StatusCaixaBadge";
import { CamposCartao, CARTAO_VAZIO, PagamentoDividido, cartaoParaDados, pagamentosDasLinhas, type CartaoForm, type LinhaPagamento } from "@/components/pdv/PagamentoDividido";
import { useCaixaLocal } from "@/hooks/useCaixaLocal";
import { formatarCentavos } from "@/lib/caixa/calculo";
import { totalEmCentavos } from "@/lib/vendas/validacao-sincronizacao";
import { validarPagamentosVenda, type PagamentoVenda } from "@/lib/caixa/validacao";
import { statusDoCaixaLocal } from "@/services/offline/caixa-local.service";
import { ProdutoBusca } from "@/components/pdv/ProdutoBusca";
import { CarrinhoView } from "@/components/pdv/CarrinhoView";
import { PinInput } from "@/components/auth/PinInput";
import { ReciboTermico } from "@/components/pdv/ReciboTermico";
import { EstoqueInsuficienteModal, PendenciaEstoque } from "@/components/pdv/EstoqueInsuficienteModal";
import { SelecionarClienteModal } from "@/components/pdv/SelecionarClienteModal";
import { COR_ICONE_PAGAMENTO } from "@/components/ui/cores-modulo";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/ToastProvider";
import { ItemCarrinho, adicionarItem, removerItem, alterarQuantidade, calcularTotal } from "@/lib/vendas/carrinho";
import { registrarVendaLocal } from "@/services/offline/vendas-local.service";
import { processarFilaSincronizacao } from "@/services/offline/worker-sincronizacao.service";
import { salvarCarrinhoLocal, carregarCarrinhoLocal, limparCarrinhoLocal } from "@/services/offline/carrinho-local.service";
import { obterEstoqueLocalPorProduto } from "@/services/offline/estoque-local.service";
import { registrarEventoAuditoriaLocal } from "@/services/offline/auditoria-local.service";
import { validarPinParaVenda } from "@/services/offline/pin-venda.service";
import type { ClienteLocal } from "@/services/offline/db";
import { FormaPagamento, ProdutoParaVenda } from "@/types/venda";
import { VendaCompleta } from "@/services/vendas.service";

const FORMAS: { valor: FormaPagamento; rotulo: string; icone: typeof Banknote; cor: string }[] = [
  { valor: "dinheiro", rotulo: "Dinheiro", icone: Banknote, cor: COR_ICONE_PAGAMENTO.dinheiro },
  { valor: "pix", rotulo: "PIX", icone: Smartphone, cor: COR_ICONE_PAGAMENTO.pix },
  { valor: "debito", rotulo: "Débito", icone: CreditCard, cor: COR_ICONE_PAGAMENTO.debito },
  { valor: "credito", rotulo: "Crédito", icone: Landmark, cor: COR_ICONE_PAGAMENTO.credito },
  { valor: "fiado", rotulo: "Fiado", icone: HandCoins, cor: COR_ICONE_PAGAMENTO.fiado },
];

interface PendenciaEstoqueComProduto extends PendenciaEstoque {
  produtoParaAdicionar?: ProdutoParaVenda;
}

export function PDVClient() {
  const [carrinho, setCarrinho] = useState<ItemCarrinho[]>([]);
  const [formaPagamento, setFormaPagamento] = useState<FormaPagamento>("dinheiro");
  const [clienteSelecionado, setClienteSelecionado] = useState<ClienteLocal | null>(null);
  const [selecionandoCliente, setSelecionandoCliente] = useState(false);
  const [valorRecebido, setValorRecebido] = useState("");
  const [pedindoPin, setPedindoPin] = useState(false);
  const [pedindoCancelamento, setPedindoCancelamento] = useState(false);
  const [pendenciaEstoque, setPendenciaEstoque] = useState<PendenciaEstoqueComProduto | null>(null);
  const [ultimaVendaLocal, setUltimaVendaLocal] = useState<VendaCompleta | null>(null);
  const [dividir, setDividir] = useState(false);
  const [linhas, setLinhas] = useState<LinhaPagamento[]>([]);
  const [cartaoUnico, setCartaoUnico] = useState<CartaoForm>(CARTAO_VAZIO);
  const carregouCarrinhoInicial = useRef(false);
  const { mostrar } = useToast();
  const estadoCaixa = useCaixaLocal();
  const caixaAberto = estadoCaixa.caixa;
  const caixaBloqueado = !caixaAberto || Boolean(caixaAberto.conflito);

  const total = calcularTotal(carrinho);
  const totalCentavos = totalEmCentavos(carrinho);
  // Pagamento da venda: uma forma com o total, ou o pagamento dividido (cada forma individualmente).
  const pagamentosVenda: PagamentoVenda[] | null = dividir
    ? pagamentosDasLinhas(linhas)
    : [{ forma: formaPagamento, valor_centavos: totalCentavos, cartao: cartaoParaDados(formaPagamento, cartaoUnico) }];
  const errosPagamento = pagamentosVenda ? validarPagamentosVenda(pagamentosVenda, totalCentavos) : ["Informe o valor de cada forma de pagamento."];
  const pagamentoInvalido = carrinho.length > 0 && errosPagamento.length > 0;
  const temFiado = pagamentosVenda?.some((p) => p.forma === "fiado") ?? false;
  const fiadoSemCliente = temFiado && !clienteSelecionado;
  const valorRecebidoNumero = Number(valorRecebido.replace(",", ".")) || 0;
  const troco = valorRecebidoNumero - total;

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

  function alternarDivisao() {
    if (!dividir) {
      setLinhas([
        { forma: formaPagamento, valor: "", cartao: CARTAO_VAZIO },
        { forma: "dinheiro", valor: "", cartao: CARTAO_VAZIO },
      ]);
    }
    setDividir(!dividir);
  }

  function aoTrocarFormaPagamento(forma: FormaPagamento) {
    setFormaPagamento(forma);
    if (forma === "fiado" && !clienteSelecionado) {
      setSelecionandoCliente(true);
    }
    if (forma !== "dinheiro") {
      setValorRecebido("");
    }
  }

  function aoSelecionarCliente(cliente: ClienteLocal) {
    setClienteSelecionado(cliente);
    setSelecionandoCliente(false);
  }

  async function finalizarComPin(pin: string) {
    if (fiadoSemCliente) {
      throw new Error("Selecione um cliente cadastrado antes de finalizar uma venda fiado.");
    }

    const auth = await validarPinParaVenda(pin);
    if (!auth.sucesso || !auth.funcionario) {
      throw new Error(auth.erro ?? "PIN inválido.");
    }

    if (!pagamentosVenda || errosPagamento.length > 0) throw new Error(errosPagamento[0] ?? "Pagamento inválido.");
    const resultado = await registrarVendaLocal({
      itens: carrinho,
      formaPagamento: pagamentosVenda.length > 1 ? pagamentosVenda[0].forma : formaPagamento,
      pagamentos: pagamentosVenda,
      funcionarioId: auth.funcionario.id,
      funcionarioNome: auth.funcionario.nome,
      clienteId: clienteSelecionado?.id ?? null,
    });

    if (!resultado.sucesso || !resultado.vendaId) {
      throw new Error(resultado.erro ?? "Erro ao salvar a venda localmente.");
    }

    setUltimaVendaLocal({
      id: resultado.vendaId,
      created_at: new Date().toISOString(),
      total,
      forma_pagamento: pagamentosVenda.length > 1 ? "misto" : pagamentosVenda[0].forma,
      pagamentos: pagamentosVenda.length > 1 ? pagamentosVenda.map((p) => ({ forma: p.forma, valor: p.valor_centavos / 100 })) : undefined,
      cancelada: false,
      funcionario_nome: auth.funcionario.nome,
      cliente_nome: clienteSelecionado?.nome ?? null,
      cliente_telefone: clienteSelecionado?.telefone ?? null,
      valor_recebido: formaPagamento === "dinheiro" && valorRecebido ? valorRecebidoNumero : null,
      troco: formaPagamento === "dinheiro" && valorRecebido ? troco : null,
      itens: carrinho.map((i) => ({
        produto_nome: i.nome,
        quantidade: i.quantidade,
        preco_unitario: i.preco_unitario,
      })),
    });
    setCarrinho([]);
    setClienteSelecionado(null);
    setFormaPagamento("dinheiro");
    setValorRecebido("");
    setDividir(false);
    setLinhas([]);
    setCartaoUnico(CARTAO_VAZIO);
    mostrar("success", "Venda salva localmente.");

    processarFilaSincronizacao();
  }

  async function confirmarCancelamento() {
    await limparCarrinhoLocal();
    setCarrinho([]);
    setClienteSelecionado(null);
    setFormaPagamento("dinheiro");
    setValorRecebido("");
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

      {estadoCaixa.carregando ? null : caixaBloqueado ? (
        <Alert variante="warning" titulo={caixaAberto ? "Caixa em conflito" : "Caixa fechado"} className="mb-4">
          {caixaAberto
            ? "Há um conflito de sincronização neste caixa. Novas vendas ficam bloqueadas até a resolução pelo administrador."
            : "Abra o caixa deste terminal para registrar vendas."}{" "}
          <Link href="/caixa" className="underline font-semibold">
            Ir para o Caixa
          </Link>
        </Alert>
      ) : (
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600">
          <StatusCaixaBadge status={statusDoCaixaLocal(caixaAberto)} />
          <span>Dinheiro esperado: {formatarCentavos(estadoCaixa.resumo?.dinheiro.saldo_esperado_centavos ?? 0)}</span>
          {!caixaAberto.abertura_sincronizada && <span className="text-warning-700">abertura aguardando sincronização</span>}
          {estadoCaixa.pendencias.aguardando > 0 && <span className="text-warning-700">{estadoCaixa.pendencias.aguardando} operação(ões) a enviar</span>}
          <Link href="/caixa" className="ml-auto inline-flex items-center gap-1 text-brand-700 font-semibold">
            <Lock className="w-3.5 h-3.5" /> Caixa
          </Link>
        </div>
      )}

      <Card className="mb-4">
        <p className="text-xs font-medium text-slate-500 mb-2">
          Cliente na nota {formaPagamento === "fiado" ? "(obrigatório para fiado)" : "(opcional)"}
        </p>

        {clienteSelecionado ? (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2">
            <div className="flex items-center gap-2 min-w-0">
              <User className="w-4 h-4 text-fuchsia-500 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">{clienteSelecionado.nome}</p>
                {clienteSelecionado.telefone && <p className="text-xs text-slate-500">{clienteSelecionado.telefone}</p>}
              </div>
            </div>
            <button
              onClick={() => setClienteSelecionado(null)}
              aria-label="Remover cliente selecionado"
              className="text-slate-400 hover:text-slate-600 shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <Button variante="secondary" tamanho="sm" onClick={() => setSelecionandoCliente(true)}>
            <Search className="w-3.5 h-3.5 text-brand-600" />
            Buscar ou cadastrar cliente
          </Button>
        )}
      </Card>

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
              <ShoppingCart className="w-4 h-4 text-teal-500" />
              <h2 className="text-sm font-semibold text-slate-700">Resumo da venda</h2>
            </div>

            <div className="flex items-baseline justify-between border-y border-slate-100 py-4">
              <span className="text-slate-500 text-sm">Total</span>
              <span className="text-3xl font-bold text-slate-900 tabular-nums">R$ {total.toFixed(2)}</span>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-slate-500">Forma de pagamento</p>
                <button className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700" onClick={alternarDivisao}>
                  <Split className="w-3.5 h-3.5" />
                  {dividir ? "Pagamento único" : "Dividir pagamento"}
                </button>
              </div>
              {dividir ? (
                <PagamentoDividido linhas={linhas} onChange={setLinhas} totalCentavos={totalCentavos} />
              ) : (
              <div className="grid grid-cols-2 gap-2">
                {FORMAS.map((f) => {
                  const Icone = f.icone;
                  const ativo = formaPagamento === f.valor;
                  return (
                    <button
                      key={f.valor}
                      onClick={() => aoTrocarFormaPagamento(f.valor)}
                      className={`group w-full flex flex-col items-center justify-center gap-1.5 h-16 rounded-xl border text-sm font-medium transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg hover:ring-2 hover:ring-brand-200 ${
                        ativo
                          ? "bg-brand-700 text-white border-brand-700"
                          : "bg-white text-slate-600 border-slate-200 hover:border-brand-600"
                      }`}
                    >
                      <Icone className={`w-4 h-4 transition-transform duration-300 group-hover:scale-110 ${ativo ? "text-white" : f.cor}`} />
                      {f.rotulo}
                    </button>
                  );
                })}
              </div>
              )}
              {!dividir && <div className="mt-2"><CamposCartao forma={formaPagamento} valor={cartaoUnico} onChange={setCartaoUnico} /></div>}
            </div>

            {!dividir && formaPagamento === "dinheiro" && (
              <div className="flex flex-col gap-1.5">
                <Input
                  rotulo="Valor recebido em dinheiro (opcional)"
                  type="number"
                  step="0.01"
                  placeholder="0,00"
                  value={valorRecebido}
                  onChange={(e) => setValorRecebido(e.target.value)}
                />
                {valorRecebido && (
                  <div
                    className={`flex justify-between items-baseline px-1 ${
                      troco < 0 ? "text-danger-600" : "text-slate-900"
                    }`}
                  >
                    <span className="text-sm font-medium">{troco < 0 ? "Falta:" : "Troco:"}</span>
                    <span className="text-xl font-bold tabular-nums">R$ {Math.abs(troco).toFixed(2)}</span>
                  </div>
                )}
              </div>
            )}

            <Button
              tamanho="lg"
              larguraTotal
              disabled={carrinho.length === 0 || fiadoSemCliente || caixaBloqueado || pagamentoInvalido}
              onClick={() => setPedindoPin(true)}
            >
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

      <SelecionarClienteModal
        aberto={selecionandoCliente}
        onFechar={() => setSelecionandoCliente(false)}
        onSelecionar={aoSelecionarCliente}
      />
    </main>
  );
}