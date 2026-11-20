"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Printer, Search } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/ToastProvider";
import { IdentificacaoPinPasso } from "@/components/caixa/IdentificacaoPinPasso";
import { ResumoCaixaView } from "@/components/caixa/ResumoCaixaView";
import { StatusCaixaBadge } from "@/components/caixa/StatusCaixaBadge";
import {
  conferirCaixaAction,
  detalheCaixaAction,
  listarConflitosCaixaAction,
  reabrirCaixaAction,
  relatorioCaixaAction,
  tratarConflitoCaixaAction,
} from "@/lib/caixa/actions";
import { calcularDiferencas, formatarCentavos } from "@/lib/caixa/calculo";
import {
  csvCaixas,
  csvMovimentos,
  despesasDoCaixa,
  divergencias,
  porOperador,
  porTerminal,
  sangriasESuprimentos,
  type MovimentoRel,
  vendasPorForma,
} from "@/lib/caixa/relatorios";
import { FORMAS_CAIXA, ROTULO_FORMA, ROTULO_TIPO, statusExibicao } from "@/lib/caixa/tipos";
import type { CaixaListado, DadosRelatorioCaixa, DetalheCaixa } from "@/services/caixa-consulta.service";
import { ehDiaValido, fimExclusivoDoDiaLocal, formatarDataHora, hojeLocal, inicioDoDiaLocal, somarDias } from "@/lib/utils/fuso";

type Aba = "caixas" | "operador" | "terminal" | "formas" | "sangrias" | "despesas" | "divergencias" | "conflitos";
const ABAS: { id: Aba; rotulo: string }[] = [
  { id: "caixas", rotulo: "Caixas" },
  { id: "operador", rotulo: "Por operador" },
  { id: "terminal", rotulo: "Por terminal" },
  { id: "formas", rotulo: "Formas de pagamento" },
  { id: "sangrias", rotulo: "Sangrias e suprimentos" },
  { id: "despesas", rotulo: "Despesas" },
  { id: "divergencias", rotulo: "Divergências" },
  { id: "conflitos", rotulo: "Conflitos de sincronização" },
];

const dataHora = (iso: string | null) => (iso ? formatarDataHora(iso) : "—");
const statusDe = (c: Pick<CaixaListado, "status" | "diferenca_total_centavos" | "conferencia_status">) =>
  statusExibicao({
    status: c.status,
    fechamentoConfirmadoNoServidor: true,
    diferenca_total_centavos: c.diferenca_total_centavos,
    conferencia_status: c.conferencia_status,
  });

function baixar(nome: string, conteudo: string) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

// Dias do calendário da loja (não UTC, não o fuso do aparelho).
const hoje = () => hojeLocal();
const diasAtras = (n: number) => somarDias(hojeLocal(), -n);

export function HistoricoCaixas() {
  const [inicio, setInicio] = useState(diasAtras(7));
  const [fim, setFim] = useState(hoje());
  const [status, setStatus] = useState<"" | "aberto" | "fechado">("");
  const [terminal, setTerminal] = useState("");
  const [funcionario, setFuncionario] = useState("");
  const [dados, setDados] = useState<DadosRelatorioCaixa | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [aba, setAba] = useState<Aba>("caixas");
  const [detalhe, setDetalhe] = useState<string | null>(null);

  const buscar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      setDados(
        await relatorioCaixaAction({
          inicio: ehDiaValido(inicio) ? inicioDoDiaLocal(inicio).toISOString() : null,
          fim: ehDiaValido(fim) ? new Date(fimExclusivoDoDiaLocal(fim).getTime() - 1).toISOString() : null,
          status: status || null,
          terminal_id: terminal || null,
          funcionario_id: funcionario || null,
        })
      );
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [inicio, fim, status, terminal, funcionario]);

  useEffect(() => {
    void buscar();
    // primeira carga; as demais são pelo botão "Filtrar"
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const terminais = useMemo(() => [...new Set((dados?.caixas ?? []).map((c) => c.terminal_id))], [dados]);
  const operadores = useMemo(() => {
    const m = new Map<string, string>();
    (dados?.movimentos ?? []).forEach((x) => m.set(x.funcionario_id, x.funcionario_nome));
    return [...m.entries()];
  }, [dados]);

  const caixas = dados?.caixas ?? [];
  const movs = dados?.movimentos ?? [];

  return (
    <div className="flex flex-col gap-4">
      <Card className="no-print">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
          <Input rotulo="De" type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} />
          <Input rotulo="Até" type="date" value={fim} onChange={(e) => setFim(e.target.value)} />
          <Select rotulo="Situação" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="">Todas</option>
            <option value="aberto">Abertos</option>
            <option value="fechado">Fechados</option>
          </Select>
          <Select rotulo="Terminal" value={terminal} onChange={(e) => setTerminal(e.target.value)}>
            <option value="">Todos</option>
            {terminais.map((t) => (
              <option key={t} value={t}>
                {t.slice(0, 8)}…
              </option>
            ))}
          </Select>
          <Select rotulo="Operador" value={funcionario} onChange={(e) => setFuncionario(e.target.value)}>
            <option value="">Todos</option>
            {operadores.map(([id, nome]) => (
              <option key={id} value={id}>
                {nome}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          <Button tamanho="sm" onClick={buscar} carregando={carregando}>
            <Search className="w-4 h-4" />
            Filtrar
          </Button>
          <Button variante="secondary" tamanho="sm" onClick={() => window.print()}>
            <Printer className="w-4 h-4" />
            Imprimir
          </Button>
          <Button variante="secondary" tamanho="sm" disabled={!dados} onClick={() => baixar(`caixas-${hoje()}.csv`, csvCaixas(caixas))}>
            <Download className="w-4 h-4" />
            Exportar caixas (CSV)
          </Button>
          <Button variante="secondary" tamanho="sm" disabled={!dados} onClick={() => baixar(`movimentos-caixa-${hoje()}.csv`, csvMovimentos(movs))}>
            <Download className="w-4 h-4" />
            Exportar movimentos (CSV)
          </Button>
        </div>
      </Card>

      {erro && <Alert variante="danger">{erro}</Alert>}
      {dados?.truncado && (
        <Alert variante="warning">Há mais registros do que o limite de exibição: reduza o período para ver tudo.</Alert>
      )}

      <div className="flex flex-wrap gap-1 no-print">
        {ABAS.map((a) => (
          <button
            key={a.id}
            onClick={() => setAba(a.id)}
            className={`px-3 h-9 rounded-full text-sm font-medium border ${
              aba === a.id ? "bg-brand-700 text-white border-brand-700" : "bg-white text-slate-600 border-slate-200 hover:border-brand-600"
            }`}
          >
            {a.rotulo}
          </button>
        ))}
      </div>

      <Card semPadding className="overflow-x-auto">
        {aba === "caixas" && (
          <Tabela
            cab={["Aberto em", "Terminal", "Aberto por", "Fechado por", "Situação", "Vendas", "Dinheiro esperado", "Diferença", ""]}
            linhas={caixas.map((c) => [
              dataHora(c.aberto_em),
              c.terminal_id.slice(0, 8) + "…",
              c.aberto_por,
              c.fechado_por ?? "—",
              <StatusCaixaBadge key="s" status={statusDe(c)} />,
              formatarCentavos(c.resumo.total_vendas_centavos),
              formatarCentavos(c.resumo.dinheiro.saldo_esperado_centavos),
              c.diferenca_total_centavos == null ? "—" : formatarCentavos(c.diferenca_total_centavos),
              <Button key="d" variante="ghost" tamanho="sm" onClick={() => setDetalhe(c.id)}>
                Detalhes
              </Button>,
            ])}
          />
        )}
        {aba === "operador" && (
          <Tabela
            cab={["Operador", "Operações", "Vendas", ...FORMAS_CAIXA.map((f) => ROTULO_FORMA[f]), "Sangrias", "Suprimentos", "Despesas", "Estornos"]}
            linhas={porOperador(movs).map((o) => [
              o.funcionario_nome,
              o.quantidade_operacoes,
              formatarCentavos(o.vendas_centavos),
              ...FORMAS_CAIXA.map((f) => formatarCentavos(o.por_forma[f])),
              formatarCentavos(o.sangrias_centavos),
              formatarCentavos(o.suprimentos_centavos),
              formatarCentavos(o.despesas_centavos),
              formatarCentavos(o.estornos_centavos),
            ])}
          />
        )}
        {aba === "terminal" && (
          <Tabela
            cab={["Terminal", "Caixas", "Abertos", "Fechados", "Vendas", "Recebido", "Diferença", "Com divergência"]}
            linhas={porTerminal(caixas).map((t) => [
              `${t.terminal_id.slice(0, 8)}… ${t.terminal_papel ?? ""}`,
              t.caixas,
              t.abertos,
              t.fechados,
              formatarCentavos(t.vendas_centavos),
              formatarCentavos(t.recebido_centavos),
              formatarCentavos(t.diferenca_total_centavos),
              t.com_divergencia,
            ])}
          />
        )}
        {aba === "formas" && (
          <Tabela
            cab={["Forma de pagamento", "Vendas no período (líquido de estornos)"]}
            linhas={FORMAS_CAIXA.map((f) => [ROTULO_FORMA[f], formatarCentavos(vendasPorForma(movs)[f])])}
          />
        )}
        {aba === "sangrias" && <TabelaMovimentos movs={sangriasESuprimentos(movs)} />}
        {aba === "despesas" && <TabelaMovimentos movs={despesasDoCaixa(movs)} />}
        {aba === "divergencias" && (
          <Tabela
            cab={["Fechado em", "Terminal", "Fechado por", "Diferença dinheiro", "Diferença total", "Justificativa", "Conferência", ""]}
            linhas={divergencias(caixas).map((c) => [
              dataHora(c.fechado_em),
              c.terminal_id.slice(0, 8) + "…",
              c.fechado_por ?? "—",
              c.diferenca_dinheiro_centavos == null ? "—" : formatarCentavos(c.diferenca_dinheiro_centavos),
              formatarCentavos(c.diferenca_total_centavos ?? 0),
              c.justificativa_divergencia ?? "—",
              <StatusCaixaBadge key="s" status={statusDe(c)} />,
              <Button key="d" variante="ghost" tamanho="sm" onClick={() => setDetalhe(c.id)}>
                Conferir
              </Button>,
            ])}
          />
        )}
        {aba === "conflitos" && <Conflitos />}
      </Card>

      {detalhe && <DetalheModal id={detalhe} onFechar={() => setDetalhe(null)} onAlterou={buscar} />}
    </div>
  );
}

function Tabela({ cab, linhas }: { cab: string[]; linhas: React.ReactNode[][] }) {
  if (linhas.length === 0) return <p className="p-5 text-sm text-slate-500">Nenhum registro no período.</p>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
          {cab.map((c, i) => (
            <th key={i} className="px-4 py-2 font-medium whitespace-nowrap">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {linhas.map((l, i) => (
          <tr key={i} className="border-b border-slate-50">
            {l.map((v, j) => (
              <td key={j} className="px-4 py-2 whitespace-nowrap">
                {v}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TabelaMovimentos({ movs }: { movs: MovimentoRel[] }) {
  return (
    <Tabela
      cab={["Data/hora", "Tipo", "Valor", "Funcionário", "Terminal", "Origem", "Motivo"]}
      linhas={movs.map((m) => [
        dataHora(m.ocorrido_em),
        ROTULO_TIPO[m.tipo],
        `${m.sentido === "saida" ? "-" : ""}${formatarCentavos(m.valor_centavos)}`,
        m.funcionario_nome,
        m.dispositivo.slice(0, 8) + "…",
        m.origem,
        m.justificativa ?? m.descricao ?? "—",
      ])}
    />
  );
}

// ---------------------------------------------------------------------------
// Conflitos de sincronização
// ---------------------------------------------------------------------------

type ConflitoLinha = Awaited<ReturnType<typeof listarConflitosCaixaAction>>[number];

function Conflitos() {
  const [lista, setLista] = useState<ConflitoLinha[] | null>(null);
  const [obs, setObs] = useState<Record<string, string>>({});
  const { mostrar } = useToast();
  const carregar = useCallback(async () => setLista(await listarConflitosCaixaAction("pendente")), []);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (!lista) return <p className="p-5 text-sm text-slate-500">Carregando...</p>;
  if (lista.length === 0) return <p className="p-5 text-sm text-slate-500">Nenhum conflito pendente.</p>;
  return (
    <div className="divide-y divide-slate-100">
      {lista.map((c) => (
        <div key={c.id} className="p-4 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variante="warning">{c.tipo}</Badge>
            <span className="text-sm text-slate-700">{c.motivo}</span>
            <span className="text-xs text-slate-400">{dataHora(c.created_at)}</span>
          </div>
          <p className="text-xs text-slate-500">A operação foi preservada integralmente (nada foi apagado nem aplicado). Registre como foi tratada.</p>
          <div className="flex gap-2">
            <Input
              placeholder="Como foi tratado"
              value={obs[c.id] ?? ""}
              onChange={(e) => setObs({ ...obs, [c.id]: e.target.value })}
              className="flex-1"
            />
            <Button
              variante="secondary"
              onClick={async () => {
                const r = await tratarConflitoCaixaAction(c.id, obs[c.id] ?? "");
                mostrar(r.sucesso ? "success" : "danger", r.sucesso ? "Conflito marcado como tratado." : (r.erro ?? "Erro."));
                if (r.sucesso) void carregar();
              }}
            >
              Marcar como tratado
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detalhe, conferência e reabertura
// ---------------------------------------------------------------------------

function DetalheModal({ id, onFechar, onAlterou }: { id: string; onFechar: () => void; onAlterou: () => void }) {
  const [d, setD] = useState<DetalheCaixa | null>(null);
  const [modo, setModo] = useState<null | "conferir" | "reabrir">(null);
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const { mostrar } = useToast();

  const carregar = useCallback(async () => setD(await detalheCaixaAction(id)), [id]);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function executar(pin: string) {
    const r = modo === "reabrir" ? await reabrirCaixaAction(id, texto, pin) : await conferirCaixaAction(id, texto, pin);
    if (!r.sucesso) throw new Error(r.erro ?? "Operação recusada.");
    mostrar("success", modo === "reabrir" ? "Caixa reaberto (registrado na auditoria)." : "Conferência registrada.");
    setModo(null);
    setTexto("");
    await carregar();
    onAlterou();
  }

  const c = d?.caixa;
  const resumoOficial = c?.resumo;
  const diferencas =
    c && resumoOficial && d?.conferencia ? calcularDiferencas(resumoOficial, d.conferencia as Parameters<typeof calcularDiferencas>[1]).por_forma : undefined;

  return (
    <Modal aberto titulo="Detalhe do caixa" onFechar={onFechar}>
      {!d || !c ? (
        <p>Carregando...</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusCaixaBadge status={statusDe(c)} />
            <span className="text-xs text-slate-500">
              Aberto {dataHora(c.aberto_em)} por {c.aberto_por} ({c.origem_abertura}) · Terminal {c.terminal_id.slice(0, 8)}…
            </span>
          </div>
          {c.fechado_em && (
            <p className="text-sm">
              Fechado {dataHora(c.fechado_em)} por {c.fechado_por} ({c.origem_fechamento}). {c.reaberturas > 0 && `Reaberto ${c.reaberturas}x.`}
            </p>
          )}
          {c.justificativa_divergencia && <Alert variante="warning">Justificativa: {c.justificativa_divergencia}</Alert>}
          {c.conferencia_obs && <Alert variante="info">Conferência do administrador: {c.conferencia_obs}</Alert>}
          {resumoOficial && <ResumoCaixaView resumo={resumoOficial} diferencas={diferencas} />}

          <div>
            <h4 className="text-sm font-semibold text-slate-800 mb-1">Movimentações</h4>
            <div className="max-h-56 overflow-y-auto">
              <TabelaMovimentos movs={d.movimentos} />
            </div>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-slate-800 mb-1">Auditoria</h4>
            <ul className="text-xs text-slate-600 space-y-1">
              {d.auditoria.map((a) => (
                <li key={a.id}>
                  {dataHora(a.created_at)} — <strong>{a.acao}</strong> · funcionário (PIN): {a.funcionario_nome ?? "—"} · administrativo: {a.usuario_nome ?? "—"} ·{" "}
                  {a.origem ?? "—"}
                </li>
              ))}
            </ul>
          </div>

          {modo === null ? (
            <div className="flex flex-wrap gap-2 no-print">
              {c.status === "fechado" && c.conferencia_status === "pendente" && (
                <Button variante="secondary" onClick={() => setModo("conferir")}>
                  Registrar conferência
                </Button>
              )}
              {c.status === "fechado" && (
                <Button variante="danger" onClick={() => setModo("reabrir")}>
                  Reabrir caixa (excepcional)
                </Button>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3 rounded-xl bg-slate-50 p-3">
              <Input
                rotulo={modo === "reabrir" ? "Justificativa da reabertura (obrigatória)" : "Observação da conferência (obrigatória)"}
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                maxLength={300}
              />
              {erro && <Alert variante="danger">{erro}</Alert>}
              {texto.trim().length >= (modo === "reabrir" ? 10 : 3) ? (
                <IdentificacaoPinPasso
                  descricao={modo === "reabrir" ? "PIN do proprietário ou do gerente para reabrir:" : "PIN do proprietário ou do gerente para registrar a conferência:"}
                  onPin={executar}
                />
              ) : (
                <p className="text-xs text-slate-500">Preencha o texto para liberar o PIN.</p>
              )}
              <Button
                variante="ghost"
                tamanho="sm"
                onClick={() => {
                  setModo(null);
                  setErro(null);
                }}
              >
                Cancelar
              </Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
