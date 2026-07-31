import { PinInput } from "@/components/auth/PinInput";

export default function PinPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-8 bg-white px-4">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-slate-900">Identifique-se</h1>
        <p className="text-slate-500 mt-1">Digite seu PIN de 4 dígitos</p>
      </div>
      <PinInput />
    </main>
  );
}
