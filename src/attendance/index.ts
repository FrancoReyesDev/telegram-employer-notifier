// Una marca es cada vez que alguien pone la cara en el reloj. Cada dia arranca
// de cero: en las marcas del dia, en orden, la posicion par es entrada y la impar salida.

type Mark = {
  uuid: string
  checktime: string // ISO en UTC, tal como lo manda CrossChex
}

type MarkKind = "entrada" | "salida"

type Interval<T extends Mark> = { checkIn: T; checkOut: T | null }

// Si alguien vuelve a poner la cara porque no sabe si marco, esa marca no cuenta
const REPEAT_WINDOW_MS = 5 * 60_000

const localDateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Argentina/Buenos_Aires",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

export const localDate = (checktime: string): string => localDateFormat.format(new Date(checktime))

export const markKind = (position: number): MarkKind => (position % 2 === 0 ? "entrada" : "salida")

// Recibe las marcas del dia en orden y descarta las que llegan a menos de 5 minutos de la anterior
export const dropRepeated = <T extends Mark>(dayMarks: T[]): T[] =>
  dayMarks.filter(
    (mark, index) =>
      index === 0 || Date.parse(mark.checktime) - Date.parse(dayMarks[index - 1].checktime) >= REPEAT_WINDOW_MS,
  )

// Tramos del dia; si falta la ultima salida queda en null: no ficho
export const pairMarks = <T extends Mark>(dayMarks: T[]): Interval<T>[] => {
  const counted = dropRepeated(dayMarks)
  return counted
    .filter((_, position) => markKind(position) === "entrada")
    .map((checkIn, pairIndex) => ({ checkIn, checkOut: counted[pairIndex * 2 + 1] ?? null }))
}

type OdooAttendanceValues = { check_in: string; check_out: string | false; out_mode?: "auto_check_out" }

// Linea del horario de trabajo en Odoo: dia (lunes = "0"), hora de fin y si es el descanso
type ScheduleLine = { dayofweek: string; hour_to: number; day_period: string }

// Odoo guarda las fechas en UTC con formato "YYYY-MM-DD HH:MM:SS"
export const toOdooDatetime = (iso: string): string => new Date(iso).toISOString().slice(0, 19).replace("T", " ")

export const fromOdooDatetime = (value: string): string => `${value.replace(" ", "T")}Z`

// Argentina no tiene horario de verano: el dia local va de las 03:00 UTC a las 03:00 UTC del dia siguiente
export const dayRangeUtc = (date: string): [string, string] => {
  const start = new Date(`${date}T00:00:00-03:00`)
  const end = new Date(start.getTime() + 24 * 3600_000)
  return [toOdooDatetime(start.toISOString()), toOdooDatetime(end.toISOString())]
}

// Hora de cierre del horario ese dia (en hora de Buenos Aires), o null si ese dia no se trabaja
export const scheduledEnd = (lines: ScheduleLine[], date: string): string | null => {
  const dayStart = Date.parse(`${date}T00:00:00-03:00`)
  const weekday = String((new Date(dayStart + 12 * 3600_000).getUTCDay() + 6) % 7)
  const ends = lines
    .filter((line) => line.dayofweek === weekday && line.day_period !== "lunch")
    .map((line) => line.hour_to)
  if (!ends.length) return null
  return toOdooDatetime(new Date(dayStart + Math.max(...ends) * 3600_000).toISOString())
}

// Salida olvidada: se cierra a la hora de cierre del horario; si no hay horario o ya habia pasado, en 0 horas
export const closeForgotten = (checkIn: string, scheduleEnd: string | null): string =>
  scheduleEnd && scheduleEnd > checkIn ? scheduleEnd : checkIn

export const attendancesForDay = (
  dayMarks: Mark[],
  dayIsOver: boolean,
  scheduleEnd: string | null,
): OdooAttendanceValues[] =>
  pairMarks(dayMarks).map(({ checkIn, checkOut }) => {
    const checkInTime = toOdooDatetime(checkIn.checktime)
    if (checkOut) return { check_in: checkInTime, check_out: toOdooDatetime(checkOut.checktime) }
    if (!dayIsOver) return { check_in: checkInTime, check_out: false }
    return { check_in: checkInTime, check_out: closeForgotten(checkInTime, scheduleEnd), out_mode: "auto_check_out" }
  })

export type { Mark, MarkKind, Interval, OdooAttendanceValues, ScheduleLine }
