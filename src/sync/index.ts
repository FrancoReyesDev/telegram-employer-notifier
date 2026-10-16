import { attendancesForDay, closeForgotten, dayRangeUtc, fromOdooDatetime, localDate, scheduledEnd } from "../attendance"
import type { ScheduleLine } from "../attendance"
import { getDayMarks, getEmployeeName, getPendingDays, hasNewerMarks, markSynced } from "../marks"
import type { StoredMark } from "../marks"
import { callOdoo } from "../odoo"
import type { OdooEnv } from "../odoo"

type SyncEnv = OdooEnv & {
  DB: D1Database
  ODOO_USER_ID: string
}

type OdooAttendance = {
  id: number
  check_in: string
  employee_id: [number, string]
  create_uid: [number, string]
  write_uid: [number, string]
}

type OdooEmployee = {
  id: number
  name: string
  active: boolean
  resource_calendar_id: [number, string] | false
}

// Pocos dias por pasada: asi una pasada siempre termina antes de que termine la espera del proximo aviso
const DAYS_PER_RUN = 5

// Las rafagas de CrossChex (dobles toques, reintentos, marcas atrasadas) duran unos 6 segundos
const BURST_WINDOW_MS = 10_000

// Las asistencias las crea el Worker: sin mensajes de seguimiento en el chatter
const QUIET_CONTEXT = { context: { tracking_disable: true } }

const EMPLOYEE_FIELDS = ["name", "active", "resource_calendar_id"]

const searchEmployee = async (env: SyncEnv, workno: string): Promise<OdooEmployee | undefined> => {
  const [employee] = await callOdoo<OdooEmployee[]>(env, "hr.employee", "search_read", {
    domain: [["barcode", "=", workno]],
    fields: EMPLOYEE_FIELDS,
    limit: 1,
    context: { active_test: false },
  })
  return employee
}

const createEmployee = async (env: SyncEnv, workno: string): Promise<OdooEmployee | undefined> => {
  const name = await getEmployeeName(env.DB, workno)
  await callOdoo<number[]>(env, "hr.employee", "create", {
    vals_list: [{ name, barcode: workno, tz: "America/Argentina/Buenos_Aires" }],
  })
  console.log(`odoo: empleado creado: ${name} (${workno})`)
  return searchEmployee(env, workno)
}

// Devuelve null si el empleado esta archivado: no se controla su asistencia ni se vuelve a crear
const findOrCreateEmployee = async (env: SyncEnv, workno: string): Promise<OdooEmployee | null> => {
  const employee = (await searchEmployee(env, workno)) ?? (await createEmployee(env, workno))
  return employee?.active ? employee : null
}

// Horario de trabajo del empleado en Odoo (vacio si no tiene)
const getScheduleLines = async (env: SyncEnv, calendar: OdooEmployee["resource_calendar_id"]): Promise<ScheduleLine[]> =>
  calendar
    ? callOdoo<ScheduleLine[]>(env, "resource.calendar.attendance", "search_read", {
        domain: [["calendar_id", "=", calendar[0]]],
        fields: ["dayofweek", "hour_to", "day_period"],
      })
    : []

// Solo se rehacen las asistencias que creo el Worker y nadie toco despues
const isOwnedBy = (ownerId: number) => (attendance: OdooAttendance) =>
  attendance.create_uid[0] === ownerId && attendance.write_uid[0] === ownerId

const searchAttendances = (env: SyncEnv, domain: unknown[]) =>
  callOdoo<OdooAttendance[]>(env, "hr.attendance", "search_read", {
    domain,
    fields: ["check_in", "employee_id", "create_uid", "write_uid"],
  })

// Cada dia arranca de cero: lo que quedo abierto de dias anteriores se cierra a la hora de cierre
// del horario (no ficho la salida). Ademas Odoo no deja crear una asistencia si el empleado tiene otra abierta.
const closeStaleOpenAttendances = async (env: SyncEnv, today: string) => {
  const [todayStart] = dayRangeUtc(today)
  const open = await searchAttendances(env, [
    ["check_out", "=", false],
    ["check_in", "<", todayStart],
  ])
  for (const attendance of open.filter(isOwnedBy(Number(env.ODOO_USER_ID)))) {
    const [employee] = await callOdoo<OdooEmployee[]>(env, "hr.employee", "read", {
      ids: [attendance.employee_id[0]],
      fields: EMPLOYEE_FIELDS,
    })
    const lines = await getScheduleLines(env, employee.resource_calendar_id)
    const end = scheduledEnd(lines, localDate(fromOdooDatetime(attendance.check_in)))
    await callOdoo(env, "hr.attendance", "write", {
      ids: [attendance.id],
      vals: { check_out: closeForgotten(attendance.check_in, end), out_mode: "auto_check_out" },
      ...QUIET_CONTEXT,
    })
  }
}

// Rehace en Odoo las asistencias de un empleado en un dia a partir de sus marcas
const syncDay = async (env: SyncEnv, workno: string, date: string, today: string): Promise<StoredMark[]> => {
  const dayMarks = await getDayMarks(env.DB, workno, date)
  const employee = await findOrCreateEmployee(env, workno)
  if (!employee) {
    console.log(`odoo: el ${workno} esta archivado, no se sincroniza el ${date}`)
    return dayMarks
  }
  const [dayStart, dayEnd] = dayRangeUtc(date)

  const existing = await searchAttendances(env, [
    ["employee_id", "=", employee.id],
    ["check_in", ">=", dayStart],
    ["check_in", "<", dayEnd],
  ])
  // Si alguien corrigio el dia a mano en Odoo, vale lo de Odoo
  if (!existing.every(isOwnedBy(Number(env.ODOO_USER_ID)))) {
    console.warn(`odoo: el ${date} de ${employee.name} se corrigio a mano, no se toca`)
    return dayMarks
  }

  if (existing.length) {
    await callOdoo(env, "hr.attendance", "unlink", { ids: existing.map((attendance) => attendance.id) })
  }
  const end = scheduledEnd(await getScheduleLines(env, employee.resource_calendar_id), date)
  const attendances = attendancesForDay(dayMarks, date < today, end)
  if (attendances.length) {
    await callOdoo(env, "hr.attendance", "create", {
      vals_list: attendances.map((values) => ({ employee_id: employee.id, ...values })),
      ...QUIET_CONTEXT,
    })
  }
  console.log(`odoo: ${employee.name} ${date}: ${attendances.length} tramo(s)`)
  return dayMarks
}

// Pasa a Odoo todo lo que esta pendiente: el fichaje que acaba de llegar y lo que haya fallado antes
export const syncPendingDays = async (env: SyncEnv) => {
  const today = localDate(new Date().toISOString())
  await closeStaleOpenAttendances(env, today)
  const days = await getPendingDays(env.DB, DAYS_PER_RUN)

  for (const { workno, local_date: date } of days) {
    try {
      const dayMarks = await syncDay(env, workno, date, today)
      await markSynced(env.DB, dayMarks.map((mark) => mark.uuid))
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      console.error(`odoo: error en el ${date} del ${workno}: ${detail}`)
    }
  }
}

// Cada aviso espera a que pase la rafaga y solo el ultimo en llegar sincroniza:
// asi nunca hay dos procesos rearmando el mismo dia en Odoo a la vez
export const syncAfterBurst = async (env: SyncEnv, lastRowId: number) => {
  await new Promise((resolve) => setTimeout(resolve, BURST_WINDOW_MS))
  if (await hasNewerMarks(env.DB, lastRowId)) return
  await syncPendingDays(env)
}
