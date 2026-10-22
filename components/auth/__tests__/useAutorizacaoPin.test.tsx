import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { AutorizacaoPinProvider, useAutorizacaoPin, VALIDADE_AUTORIZACAO_MS } from "../useAutorizacaoPin";

type Resultado = { sucesso: boolean; erroAutorizacao?: string };
type Api = ReturnType<typeof useAutorizacaoPin>;

// Renderiza o gancho (com ou sem provedor) e devolve a API. Não há DOM: a lógica usa refs/contexto,
// então `autorizar` funciona depois do render. O PinInput é acionado pelas props do elemento do modal.
function montar(comProvedor: boolean): () => Api {
  let api!: Api;
  function Sonda() {
    api = useAutorizacaoPin();
    return null;
  }
  renderToStaticMarkup(comProvedor ? <AutorizacaoPinProvider><Sonda /></AutorizacaoPinProvider> : <Sonda />);
  return () => api;
}

function pinInputDe(modal: Api["modalPin"]) {
  const filhos = (modal as ReactElement<{ children: ReactElement<{ onPinCompleto: (p: string) => Promise<void>; onSucesso: () => void }>[] }>).props.children;
  return filhos[1].props;
}

// Simula a pessoa digitando o PIN no modal e o modal fechando em seguida.
async function digitarPin(api: Api, pin: string) {
  const { onPinCompleto, onSucesso } = pinInputDe(api.modalPin);
  await onPinCompleto(pin);
  onSucesso();
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useAutorizacaoPin dentro de um AutorizacaoPinProvider (mesma tela)", () => {
  it("pede o PIN na 1ª operação e reaproveita nas seguintes, sem novo pedido", async () => {
    const api = montar(true);
    const executar = vi.fn(async (): Promise<Resultado> => ({ sucesso: true }));

    const primeira = api().autorizar(executar);
    await digitarPin(api(), "1234");
    expect(await primeira).toEqual({ sucesso: true });
    expect(executar).toHaveBeenLastCalledWith("1234");

    // 2ª e 3ª operações: executam direto com o PIN guardado, sem passar pelo modal
    expect(await api().autorizar(executar)).toEqual({ sucesso: true });
    expect(await api().autorizar(executar)).toEqual({ sucesso: true });
    expect(executar).toHaveBeenCalledTimes(3);
    expect(executar).toHaveBeenLastCalledWith("1234");
  });

  it("recusa do servidor com o PIN guardado: esquece o PIN e volta a pedir", async () => {
    const api = montar(true);
    const ok = vi.fn(async (): Promise<Resultado> => ({ sucesso: true }));
    const p1 = api().autorizar(ok);
    await digitarPin(api(), "1234");
    await p1;

    const recusa = vi.fn(async (pin: string): Promise<Resultado> =>
      pin === "1234" ? { sucesso: false, erroAutorizacao: "Seu cargo não tem permissão para esta operação." } : { sucesso: true }
    );
    const p2 = api().autorizar(recusa); // tenta com "1234" guardado, é recusado, pede de novo
    await vi.waitFor(() => expect(recusa).toHaveBeenCalledTimes(1));
    await digitarPin(api(), "5678");
    expect(await p2).toEqual({ sucesso: true });
    expect(recusa).toHaveBeenLastCalledWith("5678");

    // e o novo PIN passa a ser o guardado
    await api().autorizar(ok);
    expect(ok).toHaveBeenLastCalledWith("5678");
  });

  it("PIN errado no modal não é guardado (o pedido continua aberto com o motivo)", async () => {
    const api = montar(true);
    const executar = vi.fn(async (): Promise<Resultado> => ({ sucesso: false, erroAutorizacao: "PIN incorreto." }));
    const p = api().autorizar(executar);
    await expect(pinInputDe(api().modalPin).onPinCompleto("0000")).rejects.toThrow("PIN incorreto.");

    const bom = vi.fn(async (): Promise<Resultado> => ({ sucesso: true }));
    pinInputDe(api().modalPin).onSucesso(); // cancelar
    expect(await p).toBeNull();
    // nada ficou guardado: a próxima operação pede o PIN de novo
    const seguinte = api().autorizar(bom);
    expect(bom).not.toHaveBeenCalled();
    pinInputDe(api().modalPin).onSucesso();
    expect(await seguinte).toBeNull();
  });

  it("depois de 10 minutos sem uso, o PIN guardado expira e volta a ser pedido", async () => {
    const api = montar(true);
    const executar = vi.fn(async (): Promise<Resultado> => ({ sucesso: true }));
    const p1 = api().autorizar(executar);
    await digitarPin(api(), "1234");
    await p1;

    vi.setSystemTime(Date.now() + VALIDADE_AUTORIZACAO_MS + 1000);
    const p2 = api().autorizar(executar);
    expect(executar).toHaveBeenCalledTimes(1); // não reaproveitou
    await digitarPin(api(), "1234");
    await p2;
    expect(executar).toHaveBeenCalledTimes(2);
  });

  it("o uso renova a validade (janela deslizante)", async () => {
    const api = montar(true);
    const executar = vi.fn(async (): Promise<Resultado> => ({ sucesso: true }));
    const p1 = api().autorizar(executar);
    await digitarPin(api(), "1234");
    await p1;

    vi.setSystemTime(Date.now() + VALIDADE_AUTORIZACAO_MS - 1000);
    await api().autorizar(executar); // dentro da validade: renova
    vi.setSystemTime(Date.now() + VALIDADE_AUTORIZACAO_MS - 1000);
    await api().autorizar(executar); // ainda válido graças à renovação
    expect(executar).toHaveBeenCalledTimes(3);
  });
});

describe("useAutorizacaoPin sem provedor (PDV, pagamentos e demais telas)", () => {
  it("continua pedindo o PIN a CADA operação", async () => {
    const api = montar(false);
    const executar = vi.fn(async (): Promise<Resultado> => ({ sucesso: true }));

    const p1 = api().autorizar(executar);
    await digitarPin(api(), "1234");
    await p1;

    const p2 = api().autorizar(executar);
    expect(executar).toHaveBeenCalledTimes(1); // não reaproveitou o PIN
    await digitarPin(api(), "1234");
    await p2;
    expect(executar).toHaveBeenCalledTimes(2);
  });
});

describe("telas de cadastro usam o provedor; PDV e pagamento não", () => {
  it("as páginas de produtos, categorias, fornecedores, clientes e estoque embrulham o conteúdo", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const raiz = path.resolve(__dirname, "../../..");
    for (const m of ["produtos", "categorias", "fornecedores", "clientes", "estoque"]) {
      expect(fs.readFileSync(path.join(raiz, `app/${m}/page.tsx`), "utf8")).toContain("<AutorizacaoPinProvider>");
    }
    for (const m of ["pdv", "contas-receber"]) {
      expect(fs.readFileSync(path.join(raiz, `app/${m}/page.tsx`), "utf8")).not.toContain("AutorizacaoPinProvider");
    }
  });
});
