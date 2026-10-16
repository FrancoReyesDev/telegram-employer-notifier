import { getAllRecords } from "../crosschex"
import { saveMarks } from "../marks"
import type { CrossChexRateLimiter } from "../rate-limiter"

type ReconcileEnv = {
  CROSSCHEX_API_URL: string
  CROSSCHEX_API_KEY: string
  CROSSCHEX_API_SECRET: string
  RATE_LIMITER: DurableObjectNamespace<CrossChexRateLimiter>
  EMPLOYEES: KVNamespace
  DB: D1Database
  RECONCILE_DAYS: string
}

const DAY_MS = 24 * 3600_000

// CrossChex no documenta el rango maximo por consulta: se pide de a 30 dias
const WINDOW_MS = 30 * DAY_MS

export const timeWindows = (from: Date, to: Date): [Date, Date][] =>
  Array.from({ length: Math.ceil((to.getTime() - from.getTime()) / WINDOW_MS) }, (_, index) => {
    const begin = new Date(from.getTime() + index * WINDOW_MS)
    const end = new Date(Math.min(begin.getTime() + WINDOW_MS, to.getTime()))
    return [begin, end]
  })

// Trae de CrossChex las marcas de los ultimos dias (carga de historial o marcas que no llegaron por webhook)
export const reconcile = async (env: ReconcileEnv) => {
  const now = new Date()
  const from = new Date(now.getTime() - Number(env.RECONCILE_DAYS) * DAY_MS)

  for (const [begin, end] of timeWindows(from, now)) {
    const records = await getAllRecords(env, begin.toISOString(), end.toISOString())
    const inserted = await saveMarks(env.DB, records, "api")
    console.log(`crosschex: ${records.length} marcas del ${begin.toISOString()} al ${end.toISOString()} (${inserted} nuevas)`)
  }
}
