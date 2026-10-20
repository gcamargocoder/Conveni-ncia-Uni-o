import { describe, it, expect } from "vitest";
import {
  CHAVE_MARCADOR,
  MarcadorSessao,
  apagarMarcador,
  decidirAcesso,
  gravarMarcador,
  lerMarcador,
} from "../sessao-offline";

const HORA = 60 * 60 * 1000;
const AGORA = new Date("2026-03-10T12:00:00Z").getTime();

const marcador = (sobrescrever: Partial<MarcadorSessao> = {}): MarcadorSessao => ({
  usuarioId: "u1",
  nome: "Maria",
  ultimaValidacaoEm: AGORA - HORA,
  expiraAbsolutaEm: AGORA + 5 * 24 * HORA,
  ...sobrescrever,
});

describe("decidirAcesso — uso offline do PDV", () => {
  it("servidor confirmou a sessão: liberado", () => {
    expect(decidirAcesso(null, "autenticado", AGORA)).toBe("liberado");
  });

  it("servidor disse que a sessão acabou: encerra na hora, mesmo dentro do prazo offline", () => {
    expect(decidirAcesso(marcador(), "nao_autenticado", AGORA)).toBe("sessao_encerrada");
  });

  it("sem internet, dentro do prazo: PDV continua liberado", () => {
    expect(decidirAcesso(marcador(), "indisponivel", AGORA)).toBe("liberado");
    expect(decidirAcesso(marcador({ ultimaValidacaoEm: AGORA - 71 * HORA }), "indisponivel", AGORA)).toBe("liberado");
  });

  it("sem internet, além de 72 h desde a última validação: bloqueia", () => {
    expect(decidirAcesso(marcador({ ultimaValidacaoEm: AGORA - 73 * HORA }), "indisponivel", AGORA)).toBe(
      "bloqueado_offline"
    );
  });

  it("sem internet, depois do teto absoluto da sessão: bloqueia mesmo recém-validado", () => {
    expect(decidirAcesso(marcador({ expiraAbsolutaEm: AGORA - 1 }), "indisponivel", AGORA)).toBe("bloqueado_offline");
  });

  it("sem marcador (logout / dados apagados): sem acesso offline", () => {
    expect(decidirAcesso(null, "indisponivel", AGORA)).toBe("bloqueado_offline");
  });
});

describe("marcador no armazenamento", () => {
  function armazenamentoFalso() {
    const dados = new Map<string, string>();
    return {
      getItem: (k: string) => dados.get(k) ?? null,
      setItem: (k: string, v: string) => void dados.set(k, v),
      removeItem: (k: string) => void dados.delete(k),
      dados,
    };
  }

  it("grava, lê e apaga; não guarda senha, token nem hash", () => {
    const arm = armazenamentoFalso();
    gravarMarcador(arm, marcador());
    expect(lerMarcador(arm)).toEqual(marcador());
    expect(Object.keys(JSON.parse(arm.dados.get(CHAVE_MARCADOR)!)).sort()).toEqual(
      ["expiraAbsolutaEm", "nome", "ultimaValidacaoEm", "usuarioId"].sort()
    );
    apagarMarcador(arm);
    expect(lerMarcador(arm)).toBeNull();
  });

  it("marcador adulterado ou corrompido é tratado como ausente", () => {
    const arm = armazenamentoFalso();
    arm.setItem(CHAVE_MARCADOR, "{não é json");
    expect(lerMarcador(arm)).toBeNull();
    arm.setItem(CHAVE_MARCADOR, JSON.stringify({ usuarioId: 1, ultimaValidacaoEm: "ontem" }));
    expect(lerMarcador(arm)).toBeNull();
  });

  it("armazenamento indisponível: falha segura (sem marcador)", () => {
    const quebrado = {
      getItem: () => {
        throw new Error("bloqueado");
      },
      setItem: () => {
        throw new Error("bloqueado");
      },
      removeItem: () => {
        throw new Error("bloqueado");
      },
    };
    expect(lerMarcador(quebrado)).toBeNull();
    expect(() => gravarMarcador(quebrado, marcador())).not.toThrow();
    expect(() => apagarMarcador(quebrado)).not.toThrow();
  });
});
