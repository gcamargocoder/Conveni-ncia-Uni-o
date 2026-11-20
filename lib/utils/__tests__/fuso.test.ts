import { describe, expect, it } from "vitest";
import {
  diaLocal,
  fimExclusivoDoDiaLocal,
  formatarData,
  formatarDataHora,
  formatarDataHoraComSegundos,
  formatarHora,
  inicioDoDiaLocal,
  instanteLocal,
  instanteNaoFuturo,
  janelaLocal,
  somarDias,
} from "../fuso";

// A venda do defeito: 18/11/2026 21:44:11 em Brasília = 19/11/2026 00:44:11 UTC.
const VENDA_21H44 = new Date("2026-11-19T00:44:11.000Z");

describe("fuso da loja — o defeito 21h44 (dia 18) virando 00h44 (dia 19)", () => {
  it("o servidor em UTC não muda o instante: a venda continua sendo do dia 18, 21h44", () => {
    expect(process.env.TZ ?? "").not.toBe("America/Sao_Paulo"); // roda como o Railway (UTC)
    expect(formatarData(VENDA_21H44)).toBe("18/11/2026");
    expect(formatarHora(VENDA_21H44)).toBe("21:44");
    expect(formatarDataHoraComSegundos(VENDA_21H44)).toBe("18/11/2026 21:44:11");
  });

  it("relatório, histórico e cupom formatam do mesmo jeito (mesma função, mesma string ISO do banco)", () => {
    const iso = VENDA_21H44.toISOString(); // o que a API/serialização entrega aos componentes
    const noRelatorio = formatarDataHora(iso);
    const noCupom = `${formatarData(iso)} ${formatarHora(iso)}`;
    expect(noRelatorio).toBe(noCupom);
    expect(noRelatorio).toBe("18/11/2026 21:44");
  });

  it("agrupa por dia local: 21h44 do dia 18 é dia 18, não 19", () => {
    expect(diaLocal(VENDA_21H44)).toBe("2026-11-18");
  });

  it("perto da meia-noite: 23:59:59 é do dia 18; 00:00:00 é do dia 19; 00:10 é do dia 19", () => {
    expect(diaLocal(instanteLocal("2026-11-18", "23:59:59"))).toBe("2026-11-18");
    expect(diaLocal(instanteLocal("2026-11-19", "00:00:00"))).toBe("2026-11-19");
    const aposMeiaNoite = new Date("2026-11-19T03:10:00.000Z"); // 00:10 em Brasília
    expect(diaLocal(aposMeiaNoite)).toBe("2026-11-19");
    expect(formatarDataHora(aposMeiaNoite)).toBe("19/11/2026 00:10");
  });

  it("venda offline sincronizada depois mantém o horário em que ocorreu", () => {
    const ocorreu = new Date("2026-11-19T00:44:11.000Z"); // 21:44 do dia 18, no aparelho
    const sincronizou = new Date("2026-11-19T11:02:00.000Z"); // 08:02 do dia 19
    expect(diaLocal(ocorreu)).toBe("2026-11-18");
    expect(diaLocal(sincronizou)).toBe("2026-11-19");
  });
});

describe("limites de dia e janelas (filtros)", () => {
  it("o dia 18 começa às 03:00 UTC e termina (exclusivo) às 03:00 UTC do dia 19", () => {
    expect(inicioDoDiaLocal("2026-11-18").toISOString()).toBe("2026-11-18T03:00:00.000Z");
    expect(fimExclusivoDoDiaLocal("2026-11-18").toISOString()).toBe("2026-11-19T03:00:00.000Z");
  });

  it("filtro de um dia específico inclui 21h44 do dia 18 e exclui 00h00 do dia 19", () => {
    const { inicio, fim } = janelaLocal({ dataInicial: "2026-11-18" });
    expect(VENDA_21H44 >= inicio && VENDA_21H44 < fim).toBe(true);
    const meiaNoite19 = instanteLocal("2026-11-19", "00:00:00");
    expect(meiaNoite19 < fim).toBe(false);
  });

  it("filtro 18/11 08:00 → 18/11 18:00 retorna só vendas dentro do intervalo", () => {
    const j = janelaLocal({ dataInicial: "2026-11-18", dataFinal: "2026-11-18", horaInicial: "08:00", horaFinal: "18:00" });
    const dentro = (d: Date) => d >= j.inicio && d < j.fim;
    expect(dentro(instanteLocal("2026-11-18", "07:59:59"))).toBe(false);
    expect(dentro(instanteLocal("2026-11-18", "08:00:00"))).toBe(true);
    expect(dentro(instanteLocal("2026-11-18", "12:30:00"))).toBe(true);
    expect(dentro(instanteLocal("2026-11-18", "18:00:30"))).toBe(true); // 18:00 inclui o minuto todo
    expect(dentro(instanteLocal("2026-11-18", "18:01:00"))).toBe(false);
    expect(dentro(VENDA_21H44)).toBe(false); // 21h44 está fora desse turno
  });

  it("intervalo entre dias: 18/11 22:00 → 19/11 06:00 (turno da noite) pega 21h44? não; 23h sim", () => {
    const j = janelaLocal({ dataInicial: "2026-11-18", dataFinal: "2026-11-19", horaInicial: "22:00", horaFinal: "06:00" });
    expect(VENDA_21H44 >= j.inicio && VENDA_21H44 < j.fim).toBe(false);
    const as23 = instanteLocal("2026-11-18", "23:00:00");
    expect(as23 >= j.inicio && as23 < j.fim).toBe(true);
  });

  it("somarDias atravessa fim de mês e ano sem depender do fuso", () => {
    expect(somarDias("2026-11-30", 1)).toBe("2026-12-01");
    expect(somarDias("2026-12-31", 1)).toBe("2027-01-01");
    expect(somarDias("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("rejeita dia e hora inválidos", () => {
    expect(() => instanteLocal("2026-02-31")).toThrow();
    expect(() => instanteLocal("2026-11-18", "25:00")).toThrow();
  });
});

describe("instanteNaoFuturo — venda offline sincronizada depois", () => {
  const agora = new Date("2026-11-19T11:02:00.000Z");
  it("preserva o instante em que a venda ocorreu no aparelho", () => {
    expect(instanteNaoFuturo("2026-11-19T00:44:11.000Z", agora).toISOString()).toBe("2026-11-19T00:44:11.000Z");
  });
  it("sem valor, inválido ou muito no futuro, usa agora", () => {
    expect(instanteNaoFuturo(null, agora)).toBe(agora);
    expect(instanteNaoFuturo("lixo", agora)).toBe(agora);
    expect(instanteNaoFuturo("2026-11-19T12:00:00.000Z", agora)).toBe(agora);
  });
  it("aceita relógio até 5 min adiantado", () => {
    expect(instanteNaoFuturo("2026-11-19T11:06:00.000Z", agora).toISOString()).toBe("2026-11-19T11:06:00.000Z");
  });
});
