import { Hono } from "hono"
export { CrossChexRateLimiter } from "./rate-limiter"
import type { CrossChexRateLimiter } from "./rate-limiter"
import { parseWebhookPayload } from "./crosschex"
import { saveMark } from "./marks"
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
  const sign = c.req.header("authorize-sign")
  if (!(await matchesSecret(sign, c.env.CROSSCHEX_WEBHOOK_PASSWORD))) {
    console.warn(JSON.stringify({ message: "webhook de crosschex rechazado", signLength: sign?.length ?? 0 }))
    return c.json({ code: "401", msg: "unauthorized" }, 401)
  }

  const record = parseWebhookPayload(await c.req.json())
  if (!record) return c.json({ code: "400", msg: "invalid payload" }, 400)

  // Se guarda antes de responder: si falla, CrossChex reintenta
  await saveMark(c.env.DB, record, "webhook")
  // Despues de responder se pasa a Odoo; si Odoo falla, queda pendiente para el proximo fichaje
  c.executionCtx.waitUntil(
    syncPendingDays(c.env).catch((error: unknown) =>
      console.error(JSON.stringify({ message: "no se pudo sincronizar con odoo", error: String(error) })),
    ),
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
