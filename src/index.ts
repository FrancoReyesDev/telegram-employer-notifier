import { Hono } from "hono"
export { CrossChexRateLimiter } from "./rate-limiter"
import type { CrossChexRateLimiter } from "./rate-limiter"
import { parseWebhookPayload } from "./crosschex"
import { localTime } from "./attendance"
import { saveMarks } from "./marks"
import { reconcile } from "./reconcile"
import { matchesSecret } from "./security"
import { syncPendingDays } from "./sync"

type Bindings = {
  CROSSCHEX_API_URL: string
  CROSSCHEX_API_KEY: string
  CROSSCHEX_API_SECRET: string
  CROSSCHEX_WEBHOOK_PASSWORD: string
  ODOO_URL: string
  ODOO_API_KEY: string
  ODOO_USER_ID: string
  RECONCILE_DAYS: string
  EMPLOYEES: KVNamespace
  RATE_LIMITER: DurableObjectNamespace<CrossChexRateLimiter>
  DB: D1Database
}

const app = new Hono<{ Bindings: Bindings }>()

// CrossChex webhook: cada vez que alguien pone la cara en el reloj
app.post("/webhook/crosschex", async (c) => {
  if (!(await matchesSecret(c.req.header("authorize-sign"), c.env.CROSSCHEX_WEBHOOK_PASSWORD))) {
    console.warn("aviso rechazado: contraseña incorrecta")
    return c.json({ code: "401", msg: "unauthorized" }, 401)
  }

  const body: unknown = await c.req.json()
  const records = parseWebhookPayload(body)
  if (!records.length) {
    console.warn(`aviso con formato inesperado: ${JSON.stringify(body)}`)
    return c.json({ code: "400", msg: "invalid payload" }, 400)
  }

  // Se guardan antes de responder: si falla, CrossChex reintenta
  await saveMarks(c.env.DB, records, "webhook")
  records.forEach(({ employee, checktime }) =>
    console.log(`fichaje: ${employee.first_name} ${employee.last_name} (${employee.workno}) ${localTime(checktime)}`),
  )
  // Despues de responder se pasa a Odoo; si Odoo falla, queda pendiente para el proximo fichaje
  c.executionCtx.waitUntil(
    syncPendingDays(c.env).catch((error: unknown) => console.error(`odoo: no se pudo sincronizar: ${String(error)}`)),
  )
  return c.json({ code: "200", msg: "success" })
})

app.get("/", (c) => c.text("telegram-employer-notifier running"))

// Sin crons en produccion: se corre a mano con `wrangler dev --test-scheduled` para cargar historial.
// Con este cron trae de CrossChex los ultimos RECONCILE_DAYS dias; con cualquier otro pasa a Odoo lo pendiente.
const IMPORT_CRON = "0 6 * * *"

export default {
  fetch: app.fetch,
  scheduled: async (controller, env) => {
    if (controller.cron === IMPORT_CRON) await reconcile(env)
    else await syncPendingDays(env)
  },
} satisfies ExportedHandler<Bindings>
