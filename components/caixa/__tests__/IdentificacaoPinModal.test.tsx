import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({
  validarPinParaOperacao: vi.fn(),
  autorizarOperacaoCaixaAction: vi.fn(),
  pinProps: null as null | { onPinCompleto: (p: string) => Promise<void> },
  modalProps: null as null | { bloqueado?: boolean },
}));
// O teclado de PIN e o Modal são trocados por sondas só para capturar as props que o componente lhes passa.
vi.mock("@/components/auth/PinInput", () => ({
  PinInput: (props: { onPinCompleto: (p: string) => Promise<void> }) => {
    mocks.pinProps = props;
    return null;
  },
}));
vi.mock("@/components/ui/Modal", () => ({
  Modal: (props: { bloqueado?: boolean; children: unknown }) => {
    mocks.modalProps = props;
    return props.children as never;
  },
}));
vi.mock("@/services/offline/pin-venda.service", () => ({ validarPinParaOperacao: mocks.validarPinParaOperacao }));
vi.mock("@/lib/caixa/actions", () => ({ autorizarOperacaoCaixaAction: mocks.autorizarOperacaoCaixaAction }));

import { IdentificacaoPinModal } from "../IdentificacaoPinModal";

const GERENTE = { id: "11111111-1111-4111-8111-111111111111", nome: "Gerente" };
const ESCOPO = { kind: "movimento" as const, operacao_id: "22222222-2222-4222-8222-222222222222", caixa_id: "33333333-3333-4333-8333-333333333333", tipo: "sangria" as const, valor_centavos: 500 };

// Renderiza o componente e pega as props do PinInput, como a pessoa digitando o PIN.
function pinInput(onConfirmar: (r: { id: string; nome: string }) => Promise<void>) {
  renderToStaticMarkup(
    <IdentificacaoPinModal aberto titulo="t" descricao="d" permissao="caixa.movimentar" escopo={ESCOPO} onFechar={() => {}} onConfirmar={onConfirmar} />
  );
  return mocks.pinProps!;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.validarPinParaOperacao.mockResolvedValue({ sucesso: true, funcionario: GERENTE });
});

describe("IdentificacaoPinModal — operação administrativa só avança com a autorização confirmada pelo servidor", () => {
  it("rede caiu entre o PIN local e o servidor: erro claro, NADA é registrado", async () => {
    mocks.autorizarOperacaoCaixaAction.mockRejectedValue(new TypeError("Failed to fetch"));
    const onConfirmar = vi.fn(async () => {});
    await expect(pinInput(onConfirmar).onPinCompleto("4321")).rejects.toThrow(/Falha de comunicação.*NÃO foi registrada/);
    expect(onConfirmar).not.toHaveBeenCalled();
  });

  it("servidor recusa (PIN/permissão/escopo): propaga a mensagem e não registra", async () => {
    mocks.autorizarOperacaoCaixaAction.mockResolvedValue({ sucesso: false, erroAutorizacao: "PIN incorreto." });
    const onConfirmar = vi.fn(async () => {});
    await expect(pinInput(onConfirmar).onPinCompleto("0000")).rejects.toThrow("PIN incorreto.");
    expect(onConfirmar).not.toHaveBeenCalled();
  });

  it("servidor autorizou OUTRO funcionário que o PIN local: recusa", async () => {
    mocks.autorizarOperacaoCaixaAction.mockResolvedValue({ sucesso: true, funcionario: { id: "99999999-9999-4999-8999-999999999999", nome: "Outro" } });
    const onConfirmar = vi.fn(async () => {});
    await expect(pinInput(onConfirmar).onPinCompleto("4321")).rejects.toThrow();
    expect(onConfirmar).not.toHaveBeenCalled();
  });

  it("autorizado pelo servidor: só então executa, com o mesmo funcionário", async () => {
    mocks.autorizarOperacaoCaixaAction.mockResolvedValue({ sucesso: true, funcionario: GERENTE });
    const onConfirmar = vi.fn(async () => {});
    await pinInput(onConfirmar).onPinCompleto("4321");
    expect(mocks.autorizarOperacaoCaixaAction).toHaveBeenCalledWith(ESCOPO, "4321");
    expect(onConfirmar).toHaveBeenCalledWith(GERENTE);
  });
});
