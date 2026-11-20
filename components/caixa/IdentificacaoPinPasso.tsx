"use client";

import { PinInput } from "@/components/auth/PinInput";

/**
 * PIN inline (sem modal) para fluxos administrativos já dentro de um modal. A validação do PIN e do cargo
 * acontece na Server Action que recebe `onPin` — aqui só se coleta o PIN; erros são mostrados pelo PinInput.
 */
export function IdentificacaoPinPasso({ descricao, onPin }: { descricao: string; onPin: (pin: string) => Promise<void> }) {
  return (
    <div>
      <p className="mb-3 text-sm text-slate-600">{descricao}</p>
      <PinInput modo="confirmacao" onPinCompleto={onPin} />
    </div>
  );
}
