import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getOfflineDB } from "../db";
import { gerarHashPin } from "@/lib/auth/pin";
import { substituirCredenciaisPinLocal } from "../credenciais-pin-local.service";

const validarPinAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/actions", () => ({ validarPinAction }));

import {
  validarPinParaOperacao,
  validarPinParaVenda,
  MSG_EXIGE_CONEXAO,
  MSG_FALHA_COMUNICACAO,
  MSG_SESSAO_EXPIRADA,
} from "../pin-venda.service";

const FRENTISTA = { id: "f-1", nome: "Ana", cargo: "frentista" as const };
const GERENTE = { id: "g-1", nome: "Gil", cargo: "gerente" as const };

beforeEach(async () => {
  const db = getOfflineDB();
  await Promise.all([db.funcionarios_local.clear(), db.credenciais_pin_local.clear(), db.configuracoes_local.clear()]);
  await db.funcionarios_local.put({ id: FRENTISTA.id, nome: FRENTISTA.nome, cargo: "frentista", ativo: true, updated_at: "" });
  await substituirCredenciaisPinLocal([{ funcionario_id: FRENTISTA.id, pin_hash: await gerarHashPin("1111") }]);
  validarPinAction.mockReset();
  vi.stubGlobal("navigator", { onLine: true });
});
afterEach(() => vi.unstubAllGlobals());

describe("identificação por PIN nas operações do caixa (mesmo mecanismo do PDV)", () => {
  it("online: o servidor identifica o funcionário e o cargo decide a permissão", async () => {
    validarPinAction.mockResolvedValue({ sucesso: true, funcionario: GERENTE });
    expect(await validarPinParaOperacao("9999", "caixa.movimentar")).toEqual({ sucesso: true, funcionario: GERENTE });
    expect(validarPinAction).toHaveBeenCalledWith("9999");
  });

  it("online: frentista com PIN correto NÃO faz sangria/suprimento/estorno/reabertura", async () => {
    validarPinAction.mockResolvedValue({ sucesso: true, funcionario: FRENTISTA });
    for (const p of ["caixa.movimentar", "caixa.reabrir", "pdv.cancelar_venda"] as const) {
      const r = await validarPinParaOperacao("1111", p);
      expect(r.sucesso).toBe(false);
      expect(r.erro).toMatch(/permissão/);
    }
    expect((await validarPinParaOperacao("1111", "pdv.vender")).sucesso).toBe(true);
  });

  it("PIN incorreto ou bloqueio do servidor é resposta DEFINITIVA (não cai no PIN offline)", async () => {
    validarPinAction.mockResolvedValue({ sucesso: false, erro: "PIN incorreto.", motivo: "pin_incorreto" });
    const r = await validarPinParaOperacao("1111", "pdv.vender"); // 1111 existe no aparelho, mas o servidor disse não
    expect(r).toEqual({ sucesso: false, erro: "PIN incorreto." });
  });

  it("offline: frentista abre/vende/fecha com o PIN local (cargo que só vende)", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    const r = await validarPinParaOperacao("1111", "pdv.vender");
    expect(r).toMatchObject({ sucesso: true, funcionario: { id: FRENTISTA.id } });
    expect(validarPinAction).not.toHaveBeenCalled();
  });

  it("offline: operação administrativa diz que EXIGE CONEXÃO — com qualquer PIN, sem avaliar nem revelar nada do PIN", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    for (const pin of ["1111", "9999", "0000"]) {
      for (const p of ["caixa.movimentar", "caixa.reabrir", "pdv.cancelar_venda"] as const) {
        expect(await validarPinParaOperacao(pin, p)).toEqual({ sucesso: false, erro: MSG_EXIGE_CONEXAO });
      }
    }
    expect(validarPinAction).not.toHaveBeenCalled();
  });

  it("offline, abrir/vender/fechar: PIN desconhecido diz 'não reconhecido sem conexão' (não afirma que está errado)", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    const r = await validarPinParaOperacao("9999", "pdv.vender");
    expect(r.sucesso).toBe(false);
    expect(r.erro).toMatch(/não reconhecido neste aparelho sem conexão/);
    expect(r.erro).not.toMatch(/permiss/);
  });

  it("online, operação administrativa: servidor com falha/lento NÃO cai no PIN local — 'falha de comunicação'", async () => {
    validarPinAction.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await validarPinParaOperacao("1111", "caixa.movimentar")).toEqual({ sucesso: false, erro: MSG_FALHA_COMUNICACAO });
    vi.useFakeTimers();
    validarPinAction.mockReturnValue(new Promise(() => {}));
    const pendente = validarPinParaOperacao("4321", "caixa.movimentar");
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pendente).toEqual({ sucesso: false, erro: MSG_FALHA_COMUNICACAO });
    vi.useRealTimers();
  });

  it("online, operação administrativa: sessão expirada tem mensagem própria e não usa o PIN local", async () => {
    validarPinAction.mockResolvedValue({ sucesso: false, erro: "Sessão expirada.", motivo: "sem_sessao" });
    expect(await validarPinParaOperacao("1111", "caixa.movimentar")).toEqual({ sucesso: false, erro: MSG_SESSAO_EXPIRADA });
  });

  it("as quatro situações têm mensagens DIFERENTES: PIN incorreto, sem permissão, exige conexão, falha de comunicação", async () => {
    validarPinAction.mockResolvedValue({ sucesso: false, erro: "PIN incorreto.", motivo: "pin_incorreto" });
    const incorreto = (await validarPinParaOperacao("0000", "caixa.movimentar")).erro;
    validarPinAction.mockResolvedValue({ sucesso: true, funcionario: FRENTISTA });
    const semPermissao = (await validarPinParaOperacao("1111", "caixa.movimentar")).erro;
    vi.stubGlobal("navigator", { onLine: false });
    const exigeConexao = (await validarPinParaOperacao("1111", "caixa.movimentar")).erro;
    vi.stubGlobal("navigator", { onLine: true });
    validarPinAction.mockRejectedValue(new Error("x"));
    const falha = (await validarPinParaOperacao("1111", "caixa.movimentar")).erro;
    expect(new Set([incorreto, semPermissao, exigeConexao, falha]).size).toBe(4);
  });

  it("validarPinParaVenda continua igual (pdv.vender)", async () => {
    validarPinAction.mockResolvedValue({ sucesso: true, funcionario: FRENTISTA });
    expect((await validarPinParaVenda("1111")).sucesso).toBe(true);
  });
});
