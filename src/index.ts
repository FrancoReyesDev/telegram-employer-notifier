import { Hono } from "hono"
export { CrossChexRateLimiter } from "./rate-limiter"
import type { CrossChexRateLimiter } from "./rate-limiter"
import { sendMessage, sendMessageWithButtons, answerCallbackQuery, parseCommand, parseUpdate, setWebhook, MENU_BUTTONS, MENU_TEXT } from "./telegram"
import { parseWebhookPayload, formatTime, checkLabel, getAllRecords, hasTokenAvailable } from "./crosschex"
import { getAll, sync } from "./employees"
import type { Employee } from "./employees"
import type { AttendanceRecord } from "./crosschex"

type Bindings = {
  CROSSCHEX_API_URL: string
  CROSSCHEX_API_KEY: string
  CROSSCHEX_API_SECRET: string
  TELEGRAM_BOT_TOKEN: string
  TELEGRAM_CHAT_ID: string
  EMPLOYEES: KVNamespace
  RATE_LIMITER: DurableObjectNamespace<CrossChexRateLimiter>
}

const app = new Hono<{ Bindings: Bindings }>()

// CrossChex webhook: notificacion en tiempo real
app.post("/webhook/crosschex", async (c) => {
  const body = await c.req.json()
  const record = parseWebhookPayload(body)
  if (!record) return c.json({ code: "400", msg: "invalid payload" }, 400)

  const { employee, checktime, checktype } = record
  const name = `${employee.first_name} ${employee.last_name}`
  const time = formatTime(checktime)
  const label = checkLabel(checktype)
  const job = employee.job_title ? ` (${employee.job_title})` : ""
  const text = `*${name}*${job} ficho ${label} a las *${time}*`

  await sendMessage(c.env, text)
  return c.json({ code: "200", msg: "success" })
})

// Telegram webhook: comandos del bot + callback queries
app.post("/webhook/telegram", async (c) => {
  const body = await c.req.json()
  const update = parseUpdate(body)
  if (!update) return c.json({ ok: true })

  // Callback query (boton inline)
  if (update.callback_query) {
    const { id: queryId, data, message } = update.callback_query
    if (!data || !message) return c.json({ ok: true })

    const chatId = message.chat.id
    const reply = (text: string) => sendMessage(c.env, text, chatId)

    await answerCallbackQuery(c.env.TELEGRAM_BOT_TOKEN, queryId)
    await executeCommand(`/${data}`, c.env, reply)
    return c.json({ ok: true })
  }

  // Mensaje de texto
  if (!update.message?.text) return c.json({ ok: true })

  const chatId = update.message.chat.id
  const command = parseCommand(update.message.text)
  const reply = (text: string) => sendMessage(c.env, text, chatId)

  if (!command) {
    await sendMessageWithButtons(c.env, MENU_TEXT, MENU_BUTTONS, chatId)
    return c.json({ ok: true })
  }

  await executeCommand(command, c.env, reply)
  return c.json({ ok: true })
})

const executeCommand = async (command: string, env: Bindings, reply: (t: string) => Promise<unknown>) => {
  switch (command) {
    case "/asistencia": {
      const tokenCached = await env.EMPLOYEES.get("crosschex_token")
      const bucketReady = tokenCached ? await hasTokenAvailable(env) : false
      if (!bucketReady) {
        await reply("Consultando fichajes en CrossChex... esto puede tardar ~30 segundos")
      }
      await handleAsistencia(env, reply)
      break
    }

    case "/empleados":
      await handleEmpleados(env, reply)
      break

    case "/sync": {
      await reply("Sincronizando empleados desde CrossChex... esto puede tardar dependiendo de la cantidad de registros del ultimo mes")
      await handleSync(env, reply)
      break
    }

    default:
      await reply("No entiendo ese comando.")
  }
}

const toArgentinaDate = (date: Date) => {
  const arg = new Date(date.toLocaleString("en-US", { timeZone: "America/Argentina/Buenos_Aires" }))
  return arg
}

const handleAsistencia = async (env: Bindings, reply: (t: string) => Promise<unknown>) => {
  const now = new Date()
  const argNow = toArgentinaDate(now)
  const startOfDay = new Date(Date.UTC(argNow.getFullYear(), argNow.getMonth(), argNow.getDate(), 3)) // 00:00 ART = 03:00 UTC
  const start = startOfDay.toISOString()
  const end = now.toISOString()

  const records = await getAllRecords(env, start, end)
  const employees = await getAll(env.EMPLOYEES)

  const firstCheckin = buildFirstCheckins(records)
  const lastCheckout = buildLastCheckouts(records)
  const byDept = groupByDepartment(employees)

  const date = now.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" })
  const lines: string[] = [`*Asistencia ${date}:*\n`]

  for (const [dept, emps] of byDept) {
    lines.push(`*${dept}:*`)
    const present: string[] = []
    const absent: string[] = []

    for (const emp of emps) {
      const checkin = firstCheckin.get(emp.workno)
      if (checkin) {
        const checkout = lastCheckout.get(emp.workno)
        const timeStr = checkout
          ? `${formatTime(checkin.checktime)} → ${formatTime(checkout.checktime)}`
          : formatTime(checkin.checktime)
        const job = emp.jobTitle ? ` (${emp.jobTitle})` : ""
        present.push(`  ${emp.firstName} ${emp.lastName}${job} - ${timeStr}`)
      } else {
        absent.push(`  ${emp.firstName} ${emp.lastName}`)
      }
    }

    if (present.length) lines.push("_Presentes:_", ...present)
    if (absent.length) lines.push("_Ausentes:_", ...absent)
    lines.push("")
  }

  if (!employees.length) lines.push("No hay empleados en KV. Usa /sync primero.")

  await reply(lines.join("\n"))
}

const handleEmpleados = async (env: Bindings, reply: (t: string) => Promise<unknown>) => {
  const employees = await getAll(env.EMPLOYEES)
  if (!employees.length) {
    await reply("No hay empleados registrados. Usa /sync para importar desde CrossChex.")
    return
  }
  const byDept = groupByDepartment(employees)
  const lines: string[] = ["*Empleados registrados:*\n"]
  for (const [dept, emps] of byDept) {
    lines.push(`*${dept}:*`)
    for (const e of emps) {
      const job = e.jobTitle ? ` - ${e.jobTitle}` : ""
      lines.push(`  ${e.firstName} ${e.lastName} (${e.workno})${job}`)
    }
    lines.push("")
  }
  await reply(lines.join("\n"))
}

const handleSync = async (env: Bindings, reply: (t: string) => Promise<unknown>) => {
  const now = new Date()
  const monthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate())
  const records = await getAllRecords(env, monthAgo.toISOString(), now.toISOString())

  const uniqueByWorkno = new Map<string, Employee>()
  for (const r of records) {
    if (!uniqueByWorkno.has(r.employee.workno)) {
      uniqueByWorkno.set(r.employee.workno, {
        firstName: r.employee.first_name,
        lastName: r.employee.last_name,
        workno: r.employee.workno,
        department: r.employee.department,
        jobTitle: r.employee.job_title,
      })
    }
  }

  await sync(env.EMPLOYEES, [...uniqueByWorkno.values()])
  const employees = await getAll(env.EMPLOYEES)
  const byDept = groupByDepartment(employees)
  const lines: string[] = [`Sincronizados *${employees.length}* empleados desde CrossChex:\n`]
  for (const [dept, emps] of byDept) {
    lines.push(`*${dept}:*`)
    for (const e of emps) {
      const job = e.jobTitle ? ` - ${e.jobTitle}` : ""
      lines.push(`  ${e.firstName} ${e.lastName} (${e.workno})${job}`)
    }
    lines.push("")
  }
  await reply(lines.join("\n"))
}

// Helpers
const buildFirstCheckins = (records: AttendanceRecord[]) => {
  const map = new Map<string, AttendanceRecord>()
  for (const r of records) {
    if (!map.has(r.employee.workno)) map.set(r.employee.workno, r)
  }
  return map
}

const buildLastCheckouts = (records: AttendanceRecord[]) => {
  const map = new Map<string, AttendanceRecord>()
  for (const r of records) {
    if (r.checktype === 129) map.set(r.employee.workno, r)
  }
  return map
}

const groupByDepartment = (employees: Employee[]) => {
  const map = new Map<string, Employee[]>()
  for (const emp of employees) {
    const dept = emp.department || "Sin departamento"
    const list = map.get(dept) ?? []
    list.push(emp)
    map.set(dept, list)
  }
  return map
}

// Setup: registrar webhook de telegram
app.get("/setup-telegram", async (c) => {
  const url = new URL(c.req.url)
  const webhookUrl = `${url.origin}/webhook/telegram`
  const result = await setWebhook(c.env.TELEGRAM_BOT_TOKEN, webhookUrl)
  return c.json({ webhookUrl, result })
})

app.get("/", (c) => c.text("telegram-employer-notifier running"))

export default app
