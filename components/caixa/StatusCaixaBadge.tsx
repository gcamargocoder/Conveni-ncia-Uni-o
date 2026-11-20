import { Badge } from "@/components/ui/Badge";
import { ROTULO_STATUS, type StatusCaixaExibicao } from "@/lib/caixa/tipos";

const VARIANTE: Record<StatusCaixaExibicao, "success" | "warning" | "neutral" | "danger" | "brand"> = {
  aberto: "success",
  fechamento_pendente_sincronizacao: "warning",
  aguardando_conferencia: "warning",
  fechado: "neutral",
  com_divergencia: "danger",
};

export function StatusCaixaBadge({ status }: { status: StatusCaixaExibicao }) {
  return <Badge variante={VARIANTE[status]}>{ROTULO_STATUS[status]}</Badge>;
}
