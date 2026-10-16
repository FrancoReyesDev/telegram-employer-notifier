import { describe, expect, it } from "vitest"
import { attendancesForDay, dayRangeUtc, dropRepeated, localDate, markKind, pairMarks, scheduledEnd, toOdooDatetime } from "."

// Hora de Buenos Aires (UTC-3) a marca en UTC, como las manda CrossChex
const markAt = (uuid: string, argentinaTime: string) => ({
  uuid,
  checktime: new Date(`2026-09-21T${argentinaTime}:00-03:00`).toISOString(),
})

const uuids = (marks: { uuid: string }[]) => marks.map((mark) => mark.uuid)

describe("localDate", () => {
  it("usa la fecha de Buenos Aires, no la de UTC", () => {
    expect(localDate("2026-09-21T14:01:29+00:00")).toBe("2026-09-21")
    expect(localDate("2026-09-22T02:30:00+00:00")).toBe("2026-09-21")
    expect(localDate("2026-09-22T03:00:00+00:00")).toBe("2026-09-22")
  })
})

describe("markKind", () => {
  it("posicion par es entrada, impar es salida", () => {
    expect([0, 1, 2, 3].map(markKind)).toEqual(["entrada", "salida", "entrada", "salida"])
  })
})

describe("dropRepeated", () => {
  it("descarta la marca a menos de 5 minutos de la anterior", () => {
    expect(uuids(dropRepeated([markAt("entrada", "10:00"), markAt("doble", "10:01"), markAt("salida", "19:00")]))).toEqual([
      "entrada",
      "salida",
    ])
  })

  it("descarta una rafaga de toques aunque en total pasen mas de 5 minutos", () => {
    expect(uuids(dropRepeated([markAt("entrada", "10:00"), markAt("toque2", "10:04"), markAt("toque3", "10:08")]))).toEqual([
      "entrada",
    ])
  })

  it("conserva marcas separadas por 5 minutos o mas", () => {
    expect(dropRepeated([markAt("entrada", "10:00"), markAt("salida", "10:05")])).toHaveLength(2)
  })
})

describe("pairMarks", () => {
  const pairUuids = (marks: ReturnType<typeof markAt>[]) =>
    pairMarks(marks).map(({ checkIn, checkOut }) => [checkIn.uuid, checkOut?.uuid ?? null])

  it("arma entrada y salida con el almuerzo fichado", () => {
    const marks = [markAt("in1", "10:00"), markAt("out1", "13:00"), markAt("in2", "14:00"), markAt("out2", "19:00")]
    expect(pairUuids(marks)).toEqual([
      ["in1", "out1"],
      ["in2", "out2"],
    ])
  })

  it("un doble toque no da vuelta el dia", () => {
    expect(pairUuids([markAt("in1", "10:00"), markAt("doble", "10:01"), markAt("out1", "19:00")])).toEqual([["in1", "out1"]])
  })

  it("si falta la salida, el tramo queda abierto: no ficho", () => {
    expect(pairUuids([markAt("in1", "10:00")])).toEqual([["in1", null]])
  })

  it("devuelve vacio sin marcas", () => {
    expect(pairMarks([])).toEqual([])
  })
})

describe("toOdooDatetime", () => {
  it("convierte a UTC con el formato de Odoo", () => {
    expect(toOdooDatetime("2026-09-21T14:01:29+00:00")).toBe("2026-09-21 14:01:29")
    expect(toOdooDatetime("2026-09-21T11:01:29-03:00")).toBe("2026-09-21 14:01:29")
  })
})

describe("dayRangeUtc", () => {
  it("el dia de Buenos Aires va de 03:00 UTC a 03:00 UTC del dia siguiente", () => {
    expect(dayRangeUtc("2026-09-21")).toEqual(["2026-09-21 03:00:00", "2026-09-22 03:00:00"])
  })
})

// Lunes a viernes 10 a 19 con descanso de 13 a 14, sabado 10 a 15 (como esta en CrossChex)
const schedule = [
  ...["0", "1", "2", "3", "4"].flatMap((dayofweek) => [
    { dayofweek, hour_to: 13, day_period: "morning" },
    { dayofweek, hour_to: 14, day_period: "lunch" },
    { dayofweek, hour_to: 19, day_period: "afternoon" },
  ]),
  { dayofweek: "5", hour_to: 15, day_period: "full_day" },
]

describe("scheduledEnd", () => {
  it("devuelve la hora de cierre del dia, sin contar el descanso", () => {
    expect(scheduledEnd(schedule, "2026-09-21")).toBe("2026-09-21 22:00:00") // lunes 19:00
    expect(scheduledEnd(schedule, "2026-09-19")).toBe("2026-09-19 18:00:00") // sabado 15:00
  })

  it("devuelve null si ese dia no se trabaja", () => {
    expect(scheduledEnd(schedule, "2026-09-20")).toBeNull() // domingo
  })
})

describe("attendancesForDay", () => {
  const mondayEnd = scheduledEnd(schedule, "2026-09-21")

  it("convierte los tramos al formato de Odoo", () => {
    expect(attendancesForDay([markAt("in1", "10:00"), markAt("out1", "19:00")], true, mondayEnd)).toEqual([
      { check_in: "2026-09-21 13:00:00", check_out: "2026-09-21 22:00:00" },
    ])
  })

  it("si el dia termino sin salida, cierra a la hora de cierre del horario", () => {
    expect(attendancesForDay([markAt("in1", "10:00")], true, mondayEnd)).toEqual([
      { check_in: "2026-09-21 13:00:00", check_out: "2026-09-21 22:00:00", out_mode: "auto_check_out" },
    ])
  })

  it("sin horario ese dia, o si la marca es despues del cierre, cierra en 0 horas", () => {
    expect(attendancesForDay([markAt("in1", "10:00")], true, null)[0].check_out).toBe("2026-09-21 13:00:00")
    expect(attendancesForDay([markAt("in1", "19:30")], true, mondayEnd)[0].check_out).toBe("2026-09-21 22:30:00")
  })

  it("hoy, sin salida todavia, el tramo queda abierto", () => {
    expect(attendancesForDay([markAt("in1", "10:00")], false, mondayEnd)).toEqual([
      { check_in: "2026-09-21 13:00:00", check_out: false },
    ])
  })
})
