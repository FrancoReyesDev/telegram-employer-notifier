import { localDate } from "../attendance"
import type { AttendanceRecord } from "../crosschex"

type MarkSource = "webhook" | "api"

type StoredMark = {
  uuid: string
  checktime: string
}

type PendingDay = { workno: string; local_date: string }

// D1 acepta hasta 100 parametros por consulta; las marcas se insertan en tandas
const BATCH_SIZE = 100

const insertMark = (db: D1Database, record: AttendanceRecord, source: MarkSource) =>
  db
    .prepare(
      `INSERT OR IGNORE INTO marks
        (uuid, workno, checktime, local_date, checktype, device_serial, first_name, last_name, source, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      record.uuid,
      record.employee.workno,
      record.checktime,
      localDate(record.checktime),
      record.checktype,
      record.device?.serial_number ?? null,
      record.employee.first_name ?? null,
      record.employee.last_name ?? null,
      source,
      new Date().toISOString(),
    )

type SaveResult = { inserted: number; lastRowId: number }

// Cuantas marcas eran nuevas (CrossChex reintenta y la API repite marcas) y el numero de llegada
// de la ultima: la fila de la D1 crece con cada insert y no tiene empates como la hora
export const saveMarks = async (db: D1Database, records: AttendanceRecord[], source: MarkSource): Promise<SaveResult> => {
  const batches = Array.from({ length: Math.ceil(records.length / BATCH_SIZE) }, (_, index) =>
    records.slice(index * BATCH_SIZE, (index + 1) * BATCH_SIZE),
  )
  const results = await Promise.all(
    batches.map((batch) => db.batch(batch.map((record) => insertMark(db, record, source)))),
  )
  const inserted = results.flat().filter((result) => result.meta.changes === 1)
  return { inserted: inserted.length, lastRowId: Math.max(0, ...inserted.map((result) => result.meta.last_row_id)) }
}

export const hasNewerMarks = async (db: D1Database, rowId: number): Promise<boolean> =>
  (await db.prepare("SELECT 1 FROM marks WHERE rowid > ? LIMIT 1").bind(rowId).first()) !== null

// Las marcas de un empleado en un dia, en orden
export const getDayMarks = async (db: D1Database, workno: string, date: string): Promise<StoredMark[]> => {
  const { results } = await db
    .prepare("SELECT uuid, checktime FROM marks WHERE workno = ? AND local_date = ? ORDER BY checktime")
    .bind(workno, date)
    .all<StoredMark>()
  return results
}

// Dias con marcas que todavia no se pasaron a Odoo
export const getPendingDays = async (db: D1Database, limit: number): Promise<PendingDay[]> => {
  const { results } = await db
    .prepare("SELECT DISTINCT workno, local_date FROM marks WHERE synced = 0 ORDER BY local_date LIMIT ?")
    .bind(limit)
    .all<PendingDay>()
  return results
}

export const markSynced = async (db: D1Database, uuids: string[]) => {
  if (!uuids.length) return
  await db
    .prepare(`UPDATE marks SET synced = 1 WHERE uuid IN (${uuids.map(() => "?").join(", ")})`)
    .bind(...uuids)
    .run()
}

// Nombre tal como esta cargado en CrossChex, para crear el empleado en Odoo
export const getEmployeeName = async (db: D1Database, workno: string): Promise<string> => {
  const row = await db
    .prepare("SELECT first_name, last_name FROM marks WHERE workno = ? ORDER BY checktime DESC LIMIT 1")
    .bind(workno)
    .first<{ first_name: string | null; last_name: string | null }>()
  return [row?.first_name, row?.last_name].filter(Boolean).join(" ") || `Empleado ${workno}`
}

export type { StoredMark, PendingDay }
