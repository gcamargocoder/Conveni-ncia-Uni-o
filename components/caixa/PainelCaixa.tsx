"use client";

import { useMemo, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Banknote, Lock, Printer, ReceiptText, RefreshCw, Undo2, WalletCards } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/ToastProvider";
import { useConectividade } from "@/hooks/useConectividade";
import { useCaixaLocal } from "@/hooks/useCaixaLocal";
import { IdentificacaoPinModal } from "@/components/caixa/IdentificacaoPinModal";
import { ResumoCaixaView } from "@/components/caixa/ResumoCaixaView";
import { StatusCaixaBadge } from "@/components/caixa/StatusCaixaBadge";
import { calcularDiferencas, formatarCentavos, haDivergencia, reaisParaCentavos } from "@/lib/caixa/calculo";
import { ROTULO_FORMA, ROTULO_TIPO, SENTIDO_DO_TIPO, type ConferenciaInformada, type DiferencaForma, type ResumoCaixa, type TipoAvulso } from "@/lib/caixa/tipos";
import {
  abrirCaixaLocal,
  atualizarRecebimentosDoServidor,
  CaixaLocalError,
  estornarLocal,
  fecharCaixaLocal,
  registrarMovimentoAvulsoLocal,
  statusDoCaixaLocal,
  type Responsavel,
} from "@/services/offline/caixa-local.service";
import { gerarUuid } from "@/lib/utils/uuid";
import type { EscopoAutorizacao } from "@/services/caixa.service";
import { processarFilaSincronizacao } from "@/services/offline/worker-sincronizacao.service";
import type { CaixaLocal, MovimentoCaixaLocal } from "@/services/offline/db";
import { formatarDataHora } from "@/lib/utils/fuso";

const hora = (iso: string) => formatarDataHora(iso);

function sincronizarEmSegundoPlano() {
  void processarFilaSincronizacao().catch(() => undefined);
}

function mensagemDe(e: unknown): string {
  return e instanceof CaixaLocalError || e instanceof Error ? e.message : "Erro inesperado.";
}

type AcaoMovimento = { tipo: TipoAvulso | "outros"; titulo: string };
const ACOES: { tipo: TipoAvulso; titulo: string; icone: typeof Banknote }[] = [
  { tipo: "suprimento", titulo: "Suprimento", icone: ArrowDownToLine },
  { tipo: "sangria", titulo: "Sangria", icone: ArrowUpFromLine },
  { tipo: "despesa", titulo: "Despesa", icone: ReceiptText },
];
const OUTROS: TipoAvulso[] = ["outra_entrada", "outra_saida", "ajuste_entrada", "ajuste_saida"];

export function PainelCaixa() {
  const { carregando, caixa, movimentos, resumo, pendencias, ultimoFechado } = useCaixaLocal();
  const conexao = useConectividade();

  if (carregando) return <p className="text-sm text-slate-500">Carregando o caixa deste terminal...</p>;

  return (
    <div className="flex flex-col gap-6">
      {conexao === "offline" && (
        <Alert variante="warning" titulo="Sem conexão">
          O caixa continua funcionando. Tudo fica salvo neste aparelho e é enviado ao servidor quando a conexão voltar.
        </Alert>
      )}
      {caixa ? (
        <CaixaAberto caixa={caixa} movimentos={movimentos} resumo={resumo!} pendencias={pendencias} online={conexao === "online"} />
      ) : (
        <>
          <AberturaCaixa />
          {ultimoFechado && <UltimoFechamento caixa={ultimoFechado} />}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Abertura
// ---------------------------------------------------------------------------

function AberturaCaixa() {
  const [fundo, setFundo] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pedindoPin, setPedindoPin] = useState(false);
  const { mostrar } = useToast();

  const fundoCentavos = fundo.trim() === "" ? 0 : reaisParaCentavos(fundo);

  function continuar() {
    if (fundoCentavos === null) return setErro("Informe um valor válido para o fundo de troco (ex.: 100,00).");
    setErro(null);
    setPedindoPin(true);
  }

  async function abrir(responsavel: Responsavel) {
    try {
      await abrirCaixaLocal({ fundoInicialCentavos: fundoCentavos ?? 0, observacoes, responsavel });
    } catch (e) {
      throw new Error(mensagemDe(e));
    }
    mostrar("success", "Caixa aberto.");
    sincronizarEmSegundoPlano();
  }

  return (
    <Card className="max-w-xl">
      <div className="flex items-center gap-2 mb-1">
        <WalletCards className="w-5 h-5 text-teal-500" />
        <h2 className="font-semibold text-slate-900">Abrir caixa</h2>
      </div>
      <p className="text-sm text-slate-500 mb-4">
        Nenhum caixa aberto neste terminal. Informe o dinheiro físico disponível no início do expediente (fundo de troco). Esse valor
        não conta como venda.
      </p>
      <div className="flex flex-col gap-4">
        <Input rotulo="Fundo de troco (R$)" inputMode="decimal" placeholder="0,00" value={fundo} onChange={(e) => setFundo(e.target.value)} />
        <Input rotulo="Observações (opcional)" value={observacoes} onChange={(e) => setObservacoes(e.target.value)} maxLength={300} />
        {erro && <Alert variante="danger">{erro}</Alert>}
        <Button tamanho="lg" onClick={continuar}>
          Abrir caixa
        </Button>
      </div>
      <IdentificacaoPinModal
        aberto={pedindoPin}
        titulo="Confirmar abertura do caixa"
        descricao={`Digite o seu PIN para confirmar a abertura com fundo de ${formatarCentavos(fundoCentavos ?? 0)}:`}
        permissao="pdv.vender"
        onFechar={() => setPedindoPin(false)}
        onConfirmar={abrir}
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Caixa aberto
// ---------------------------------------------------------------------------

interface CaixaAbertoProps {
  caixa: CaixaLocal;
  movimentos: MovimentoCaixaLocal[];
  resumo: ResumoCaixa;
  pendencias: { aguardando: number; retidas: number };
  online: boolean;
}

function CaixaAberto({ caixa, movimentos, resumo, pendencias, online }: CaixaAbertoProps) {
  const [acao, setAcao] = useState<AcaoMovimento | null>(null);
  const [alvoEstorno, setAlvoEstorno] = useState<MovimentoCaixaLocal | null>(null);
  const [fechando, setFechando] = useState(false);

  const estornados = useMemo(() => new Set(movimentos.map((m) => m.estorno_de_id).filter(Boolean)), [movimentos]);

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-slate-900">Caixa deste terminal</h2>
              <StatusCaixaBadge status={statusDoCaixaLocal(caixa)} />
              {!caixa.abertura_sincronizada && <Badge variante="warning">Abertura aguardando sincronização</Badge>}
            </div>
            <p className="text-sm text-slate-500 mt-1">
              Aberto em {hora(caixa.aberto_em)} por {caixa.aberto_por_funcionario_nome} · fundo {formatarCentavos(caixa.fundo_inicial_centavos)} ·{" "}
              {caixa.origem_abertura === "offline" ? "aberto offline" : "aberto online"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 no-print">
            {ACOES.map((a) => (
              <Button key={a.tipo} variante="secondary" tamanho="sm" onClick={() => setAcao({ tipo: a.tipo, titulo: a.titulo })}>
                <a.icone className="w-4 h-4 text-brand-600" />
                {a.titulo}
              </Button>
            ))}
            <Button variante="ghost" tamanho="sm" onClick={() => setAcao({ tipo: "outros", titulo: "Outra movimentação / ajuste" })}>
              Outros
            </Button>
            <Button
              tamanho="sm"
              onClick={async () => {
                // O saldo esperado precisa incluir recebimentos de contas lançados pelo servidor: atualiza antes de conferir.
                await atualizarRecebimentosDoServidor(caixa);
                setFechando(true);
              }}
            >
              <Lock className="w-4 h-4" />
              Fechar caixa
            </Button>
          </div>
        </div>
        {caixa.conflito && (
          <Alert variante="danger" titulo="Conflito de sincronização" className="mt-4">
            {caixa.conflito}. As operações foram preservadas neste aparelho e no servidor para tratamento do administrador (menu Caixas). Novas
            vendas ficam bloqueadas até a resolução.
          </Alert>
        )}
        {(pendencias.aguardando > 0 || pendencias.retidas > 0) && (
          <p className="text-sm text-warning-700 mt-4 flex items-center gap-2">
            <RefreshCw className="w-4 h-4" />
            {pendencias.aguardando > 0 && `${pendencias.aguardando} operação(ões) aguardando envio ao servidor. `}
            {pendencias.retidas > 0 && `${pendencias.retidas} retida(s) para revisão do administrador.`}
          </p>
        )}
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Destaque rotulo="Dinheiro esperado na gaveta" valor={resumo.dinheiro.saldo_esperado_centavos} />
        <Destaque rotulo={`Vendas (${resumo.quantidade_vendas})`} valor={resumo.total_vendas_centavos} />
        <Destaque rotulo="Total recebido (sem fiado)" valor={resumo.total_recebido_centavos} />
      </div>

      <ResumoCaixaView resumo={resumo} />

      <Card semPadding>
        <div className="px-5 pt-4 pb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">Movimentações ({movimentos.length})</h3>
          <Button variante="ghost" tamanho="sm" className="no-print" onClick={() => window.print()}>
            <Printer className="w-4 h-4" />
            Imprimir
          </Button>
        </div>
        <TabelaMovimentos movimentos={movimentos} estornados={estornados} onEstornar={setAlvoEstorno} />
      </Card>

      {acao && <ModalMovimento acao={acao} caixaId={caixa.id} onFechar={() => setAcao(null)} />}
      {alvoEstorno && <ModalEstorno alvo={alvoEstorno} onFechar={() => setAlvoEstorno(null)} />}
      {fechando && <ModalFechamento caixa={caixa} resumo={resumo} pendencias={pendencias} online={online} onFechar={() => setFechando(false)} />}
    </>
  );
}

function Destaque({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <Card>
      <p className="text-xs font-medium text-slate-500">{rotulo}</p>
      <p className="text-2xl font-bold text-slate-900 tabular-nums mt-1">{formatarCentavos(valor)}</p>
    </Card>
  );
}

function TabelaMovimentos({
  movimentos,
  estornados,
  onEstornar,
}: {
  movimentos: MovimentoCaixaLocal[];
  estornados: Set<string | null>;
  onEstornar?: (m: MovimentoCaixaLocal) => void;
}) {
  if (movimentos.length === 0) return <p className="px-5 pb-5 text-sm text-slate-500">Nenhuma movimentação ainda.</p>;
  const ordenados = [...movimentos].sort((a, b) => b.ocorrido_em.localeCompare(a.ocorrido_em));
  const vendasComFiado = new Set(movimentos.filter((m) => m.tipo === "venda" && m.forma_pagamento === "fiado" && m.venda_id).map((m) => m.venda_id as string));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
            <th className="px-5 py-2 font-medium">Hora</th>
            <th className="px-2 py-2 font-medium">Tipo</th>
            <th className="px-2 py-2 font-medium">Forma</th>
            <th className="px-2 py-2 font-medium text-right">Valor</th>
            <th className="px-2 py-2 font-medium">Funcionário</th>
            <th className="px-2 py-2 font-medium">Origem</th>
            <th className="px-5 py-2 font-medium no-print" />
          </tr>
        </thead>
        <tbody>
          {ordenados.map((m) => {
            const jaEstornado = estornados.has(m.id);
            // Regra existente: venda com QUALQUER parte em fiado não é estornada pelo caixa (trata-se na conta a receber).
            const vendaComFiado = m.tipo === "venda" && m.ordem === 0 && vendasComFiado.has(m.venda_id ?? "");
            const podeEstornar =
              onEstornar && m.tipo !== "estorno" && m.forma_pagamento !== "fiado" && !jaEstornado && !vendaComFiado && (m.tipo !== "venda" || m.ordem === 0);
            const rotuloAcao =
              m.tipo === "venda"
                ? `Cancelar venda de ${formatarCentavos(m.valor_centavos)} em ${ROTULO_FORMA[m.forma_pagamento]}`
                : `Estornar ${ROTULO_TIPO[m.tipo]} de ${formatarCentavos(m.valor_centavos)}`;
            return (
              <tr key={m.id} className="border-b border-slate-50 align-top">
                <td className="px-5 py-2 whitespace-nowrap text-slate-600">{hora(m.ocorrido_em)}</td>
                <td className="px-2 py-2">
                  <span className={jaEstornado ? "line-through text-slate-400" : ""}>{ROTULO_TIPO[m.tipo]}</span>
                  {(m.justificativa || m.descricao) && <p className="text-xs text-slate-500">{m.justificativa ?? m.descricao}</p>}
                  {!m.sincronizado && <Badge variante="warning" className="mt-1">pendente de envio</Badge>}
                </td>
                <td className="px-2 py-2 whitespace-nowrap">{ROTULO_FORMA[m.forma_pagamento]}</td>
                <td className={`px-2 py-2 text-right tabular-nums whitespace-nowrap ${m.sentido === "saida" ? "text-danger-600" : "text-slate-900"}`}>
                  {m.sentido === "saida" ? "-" : ""}
                  {formatarCentavos(m.valor_centavos)}
                </td>
                <td className="px-2 py-2 whitespace-nowrap">{m.funcionario_nome}</td>
                <td className="px-2 py-2 whitespace-nowrap text-slate-500">{m.origem === "offline" ? "offline" : "online"}</td>
                <td className="px-5 py-2 text-right no-print">
                  {vendaComFiado && !jaEstornado && (
                    <span className="text-xs text-slate-500">Venda com fiado: tratar na conta a receber</span>
                  )}
                  {podeEstornar && (
                    <Button variante="ghost" tamanho="sm" onClick={() => onEstornar!(m)} aria-label={rotuloAcao}>
                      <Undo2 className="w-4 h-4" />
                      {m.tipo === "venda" ? "Cancelar venda" : "Estornar"}
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sangria / suprimento / despesa / ajustes
// ---------------------------------------------------------------------------

function ModalMovimento({ acao, caixaId, onFechar }: { acao: AcaoMovimento; caixaId: string; onFechar: () => void }) {
  const [tipoOutros, setTipoOutros] = useState<TipoAvulso>("outra_saida");
  const [valor, setValor] = useState("");
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pedindoPin, setPedindoPin] = useState(false);
  const [operacaoId] = useState(() => gerarUuid());
  const { mostrar } = useToast();
  const tipo: TipoAvulso = acao.tipo === "outros" ? tipoOutros : acao.tipo;
  const centavos = reaisParaCentavos(valor);

  function continuar() {
    if (centavos === null || centavos <= 0) return setErro("Informe um valor maior que zero.");
    if (motivo.trim().length < 3) return setErro("Informe o motivo da movimentação.");
    setErro(null);
    setPedindoPin(true);
  }

  async function registrar(responsavel: Responsavel) {
    try {
      await registrarMovimentoAvulsoLocal({ tipo, valorCentavos: centavos!, justificativa: motivo, responsavel, operacaoId });
    } catch (e) {
      throw new Error(mensagemDe(e));
    }
    mostrar("success", `${ROTULO_TIPO[tipo]} registrada.`);
    sincronizarEmSegundoPlano();
    onFechar();
  }

  return (
    <>
      <Modal aberto={!pedindoPin} titulo={acao.titulo} onFechar={onFechar}>
        <div className="flex flex-col gap-4">
          {acao.tipo === "outros" && (
            <Select rotulo="Tipo" value={tipoOutros} onChange={(e) => setTipoOutros(e.target.value as TipoAvulso)}>
              {OUTROS.map((t) => (
                <option key={t} value={t}>
                  {ROTULO_TIPO[t]}
                </option>
              ))}
            </Select>
          )}
          <p className="text-slate-500">
            {SENTIDO_DO_TIPO[tipo] === "entrada" ? "O dinheiro entra no caixa." : "O dinheiro sai do caixa."} Exige o PIN de proprietário ou gerente
            (com conexão ao servidor).
          </p>
          <Input rotulo="Valor (R$)" inputMode="decimal" placeholder="0,00" value={valor} onChange={(e) => setValor(e.target.value)} />
          <Input rotulo="Motivo (obrigatório)" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} />
          {erro && <Alert variante="danger">{erro}</Alert>}
          <Button onClick={continuar}>Continuar</Button>
        </div>
      </Modal>
      <IdentificacaoPinModal
        aberto={pedindoPin}
        titulo={`Autorizar ${acao.titulo.toLowerCase()}`}
        descricao={`PIN do proprietário ou do gerente para registrar ${formatarCentavos(centavos ?? 0)}:`}
        permissao="caixa.movimentar"
        escopo={{ kind: "movimento", operacao_id: operacaoId, caixa_id: caixaId, tipo, valor_centavos: centavos ?? 0 }}
        onFechar={() => setPedindoPin(false)}
        onConfirmar={registrar}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Estorno / cancelamento de venda
// ---------------------------------------------------------------------------

function ModalEstorno({ alvo, onFechar }: { alvo: MovimentoCaixaLocal; onFechar: () => void }) {
  const [operacaoId] = useState(() => gerarUuid());
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pedindoPin, setPedindoPin] = useState(false);
  const { mostrar } = useToast();
  const ehVenda = alvo.tipo === "venda" && alvo.venda_id;

  async function estornar(responsavel: Responsavel) {
    try {
      await estornarLocal({
        vendaId: ehVenda ? alvo.venda_id! : undefined,
        movimentoId: ehVenda ? undefined : alvo.id,
        justificativa: motivo,
        responsavel,
        operacaoId,
      });
    } catch (e) {
      throw new Error(mensagemDe(e));
    }
    mostrar("success", ehVenda ? "Venda cancelada e estornada no caixa." : "Movimentação estornada.");
    sincronizarEmSegundoPlano();
    onFechar();
  }

  return (
    <>
      <Modal aberto={!pedindoPin} titulo={ehVenda ? "Cancelar venda" : "Estornar movimentação"} onFechar={onFechar}>
        <div className="flex flex-col gap-4">
          <p>
            {ROTULO_TIPO[alvo.tipo]} de <strong>{formatarCentavos(alvo.valor_centavos)}</strong> ({ROTULO_FORMA[alvo.forma_pagamento]}). O lançamento original
            é preservado e um estorno é registrado.
          </p>
          <Input rotulo="Motivo (obrigatório)" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} />
          {erro && <Alert variante="danger">{erro}</Alert>}
          <Button
            variante="danger"
            onClick={() => (motivo.trim().length < 3 ? setErro("Informe o motivo.") : (setErro(null), setPedindoPin(true)))}
          >
            Continuar
          </Button>
        </div>
      </Modal>
      <IdentificacaoPinModal
        aberto={pedindoPin}
        titulo="Autorizar estorno"
        descricao="PIN do proprietário ou do gerente (com conexão ao servidor):"
        permissao={ehVenda ? "pdv.cancelar_venda" : "caixa.movimentar"}
        escopo={{
          kind: "estorno",
          operacao_id: operacaoId,
          caixa_id: alvo.caixa_id,
          venda_id: ehVenda ? alvo.venda_id : null,
          movimento_id: ehVenda ? null : alvo.id,
        }}
        onFechar={() => setPedindoPin(false)}
        onConfirmar={estornar}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Conferência e fechamento
// ---------------------------------------------------------------------------

function ModalFechamento({
  caixa,
  resumo,
  pendencias,
  online,
  onFechar,
}: {
  caixa: CaixaLocal;
  resumo: ResumoCaixa;
  pendencias: { aguardando: number; retidas: number };
  online: boolean;
  onFechar: () => void;
}) {
  const [campos, setCampos] = useState({ dinheiro: "", pix: "", credito: "", debito: "" });
  const [justificativa, setJustificativa] = useState("");
  const [confirmou, setConfirmou] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pedindoPin, setPedindoPin] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const { mostrar } = useToast();

  const conferencia: ConferenciaInformada = {
    dinheiro_centavos: campos.dinheiro.trim() === "" ? null : reaisParaCentavos(campos.dinheiro),
    pix_centavos: campos.pix.trim() === "" ? null : reaisParaCentavos(campos.pix),
    credito_centavos: campos.credito.trim() === "" ? null : reaisParaCentavos(campos.credito),
    debito_centavos: campos.debito.trim() === "" ? null : reaisParaCentavos(campos.debito),
  };
  const dif = calcularDiferencas(resumo, conferencia);
  const divergente = haDivergencia(dif);
  const bloqueadoPorPendencia = online && pendencias.aguardando > 0;

  function continuar() {
    const preenchidosInvalidos = Object.entries(campos).some(([k, v]) => v.trim() !== "" && conferencia[`${k}_centavos` as keyof ConferenciaInformada] === null);
    if (preenchidosInvalidos) return setErro("Há valores de conferência inválidos.");
    if (conferencia.dinheiro_centavos == null) return setErro("Informe o dinheiro contado.");
    // Pix e cartões com movimento precisam ser conferidos (o total informado da maquininha/extrato).
    for (const [forma, chave] of [["pix", "pix_centavos"], ["credito", "credito_centavos"], ["debito", "debito_centavos"]] as const) {
      if (resumo.por_forma[forma].saldo_centavos !== 0 && conferencia[chave] == null) {
        return setErro(`Informe o total conferido de ${ROTULO_FORMA[forma]}.`);
      }
    }
    if (divergente && justificativa.trim().length < 5) return setErro("Há diferença na conferência: informe a justificativa.");
    if (!confirmou) return setErro("Confirme explicitamente o fechamento.");
    setErro(null);
    setPedindoPin(true);
  }

  async function sincronizarAgora() {
    setSincronizando(true);
    try {
      await processarFilaSincronizacao();
    } finally {
      setSincronizando(false);
    }
  }

  async function fechar(responsavel: Responsavel) {
    try {
      await fecharCaixaLocal({ conferencia, justificativa, responsavel });
    } catch (e) {
      throw new Error(mensagemDe(e));
    }
    mostrar(online ? "success" : "warning", online ? "Caixa fechado. Enviando ao servidor..." : "Caixa fechado neste aparelho: pendente de sincronização.");
    sincronizarEmSegundoPlano();
    onFechar();
  }

  const campo = (chave: keyof typeof campos, rotulo: string, esperado: number, obrigatorio: boolean) => (
    <Input
      key={chave}
      rotulo={`${rotulo}${obrigatorio ? "" : " (opcional)"} — esperado ${formatarCentavos(esperado)}`}
      inputMode="decimal"
      placeholder="0,00"
      value={campos[chave]}
      onChange={(e) => setCampos({ ...campos, [chave]: e.target.value })}
    />
  );

  return (
    <>
      <Modal aberto={!pedindoPin} titulo="Conferência e fechamento do caixa" onFechar={onFechar}>
        <div className="flex flex-col gap-4">
          {bloqueadoPorPendencia && (
            <Alert variante="warning" titulo="Aguardando sincronização">
              Há {pendencias.aguardando} operação(ões) deste caixa ainda não enviadas ao servidor. Para fechar com segurança, aguarde o envio.
              <div className="mt-2">
                <Button variante="secondary" tamanho="sm" carregando={sincronizando} onClick={sincronizarAgora}>
                  Sincronizar agora
                </Button>
              </div>
            </Alert>
          )}
          {!online && (
            <Alert variante="warning" titulo="Sem conexão">
              O fechamento será gravado neste aparelho como <strong>pendente de sincronização</strong> e só será confirmado quando o servidor
              recebê-lo, depois de todas as vendas e movimentos pendentes.
            </Alert>
          )}
          {pendencias.retidas > 0 && (
            <Alert variante="info">
              {pendencias.retidas} operação(ões) estão retidas para revisão do administrador e NÃO entram neste fechamento.
            </Alert>
          )}
          {campo("dinheiro", "Dinheiro contado na gaveta", resumo.dinheiro.saldo_esperado_centavos, true)}
          {campo("pix", ROTULO_FORMA.pix, resumo.por_forma.pix.saldo_centavos, resumo.por_forma.pix.saldo_centavos !== 0)}
          {campo("credito", ROTULO_FORMA.credito, resumo.por_forma.credito.saldo_centavos, resumo.por_forma.credito.saldo_centavos !== 0)}
          {campo("debito", ROTULO_FORMA.debito, resumo.por_forma.debito.saldo_centavos, resumo.por_forma.debito.saldo_centavos !== 0)}
          <DiferencasView diferencas={dif.por_forma} />
          {divergente && (
            <Input rotulo="Justificativa da divergência (obrigatória)" value={justificativa} onChange={(e) => setJustificativa(e.target.value)} maxLength={300} />
          )}
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" className="mt-1" checked={confirmou} onChange={(e) => setConfirmou(e.target.checked)} />
            Confirmo a conferência e o fechamento do caixa. Depois de fechado, ele não aceita mais movimentações.
          </label>
          {erro && <Alert variante="danger">{erro}</Alert>}
          <Button disabled={bloqueadoPorPendencia} onClick={continuar}>
            Continuar para o PIN
          </Button>
          <p className="text-xs text-slate-400">Caixa aberto em {hora(caixa.aberto_em)}.</p>
        </div>
      </Modal>
      <IdentificacaoPinModal
        aberto={pedindoPin}
        titulo="Confirmar fechamento"
        descricao="Digite o seu PIN para fechar o caixa:"
        permissao="pdv.vender"
        onFechar={() => setPedindoPin(false)}
        onConfirmar={fechar}
      />
    </>
  );
}

function DiferencasView({ diferencas }: { diferencas: DiferencaForma[] }) {
  const informadas = diferencas.filter((d) => d.informado_centavos !== null);
  if (informadas.length === 0) return null;
  return (
    <div className="rounded-xl bg-slate-50 p-3 text-sm">
      {informadas.map((d) => (
        <div key={d.forma} className="flex justify-between py-0.5">
          <span>{ROTULO_FORMA[d.forma]}: diferença</span>
          <span className={`tabular-nums ${d.diferenca_centavos ? "text-danger-600 font-semibold" : "text-success-700"}`}>
            {formatarCentavos(d.diferenca_centavos ?? 0)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Último fechamento deste terminal
// ---------------------------------------------------------------------------

function UltimoFechamento({ caixa }: { caixa: CaixaLocal }) {
  const status = statusDoCaixaLocal(caixa);
  const servidor = caixa.resumo_servidor as { resumo?: ResumoCaixa; diferencas?: DiferencaForma[] } | null;
  const esperadoLocal = caixa.resumo_local?.dinheiro.saldo_esperado_centavos;
  const esperadoServidor = servidor?.resumo?.dinheiro.saldo_esperado_centavos;
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold text-slate-900">Último fechamento deste terminal</h2>
          <StatusCaixaBadge status={status} />
        </div>
        <p className="text-sm text-slate-500 mt-1">
          Fechado em {caixa.fechado_em ? hora(caixa.fechado_em) : "—"} por {caixa.fechado_por_funcionario_nome} ·{" "}
          {caixa.origem_fechamento === "offline" ? "fechado offline" : "fechado online"}
        </p>
        {!caixa.fechamento_confirmado_servidor && (
          <Alert variante="warning" className="mt-3" titulo="Fechamento pendente de sincronização">
            Este fechamento está salvo apenas neste aparelho. Ele só será confirmado quando o servidor receber e conferir todas as operações do caixa.
          </Alert>
        )}
        {caixa.conflito && (
          <Alert variante="danger" className="mt-3" titulo="Conflito de sincronização">
            {caixa.conflito}. Tudo foi preservado; procure um administrador.
          </Alert>
        )}
        {caixa.fechamento_confirmado_servidor && esperadoLocal !== undefined && esperadoServidor !== undefined && esperadoLocal !== esperadoServidor && (
          <Alert variante="warning" className="mt-3" titulo="O servidor calculou outro valor">
            Saldo esperado em dinheiro: {formatarCentavos(esperadoLocal)} neste aparelho, {formatarCentavos(esperadoServidor)} no servidor. Vale o do servidor.
          </Alert>
        )}
        {caixa.justificativa_divergencia && <p className="text-sm mt-3">Justificativa: {caixa.justificativa_divergencia}</p>}
      </Card>
      {(servidor?.resumo ?? caixa.resumo_local) && (
        <ResumoCaixaView resumo={(servidor?.resumo ?? caixa.resumo_local)!} diferencas={servidor?.diferencas ?? caixa.diferencas_local ?? undefined} />
      )}
    </div>
  );
}
