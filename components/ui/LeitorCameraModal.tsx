"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import type { IScannerControls } from "@zxing/browser";
import { Modal } from "@/components/ui/Modal";
import { Alert } from "@/components/ui/Alert";

interface LeitorCameraModalProps {
  aberto: boolean;
  onFechar: () => void;
  onCodigoLido: (codigo: string) => void;
}

export function LeitorCameraModal({ aberto, onFechar, onCodigoLido }: LeitorCameraModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const jaLeuRef = useRef(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto || !videoRef.current) {
      controlsRef.current?.stop();
      controlsRef.current = null;
      return;
    }

    setErro(null);
    jaLeuRef.current = false;
    const leitor = new BrowserMultiFormatReader();

    leitor
      .decodeFromConstraints({ video: { facingMode: "environment" } }, videoRef.current, (resultado) => {
        if (resultado && !jaLeuRef.current) {
          jaLeuRef.current = true;
          onCodigoLido(resultado.getText());
        }
      })
      .then((controls) => {
        controlsRef.current = controls;
      })
      .catch(() => {
        setErro("Não foi possível acessar a câmera. Verifique se o navegador tem permissão de câmera para este site.");
      });

    return () => {
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  return (
    <Modal aberto={aberto} titulo="Escanear código de barras" onFechar={onFechar}>
      <div className="flex flex-col gap-3">
        {erro ? (
          <Alert variante="danger">{erro}</Alert>
        ) : (
          <>
            <div className="relative rounded-lg overflow-hidden bg-slate-900 aspect-video">
              <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
            </div>
            <p className="text-sm text-slate-500 text-center">Aponte a câmera para o código de barras.</p>
          </>
        )}
      </div>
    </Modal>
  );
}