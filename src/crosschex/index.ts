import pRetry from "p-retry"
import type { CrossChexRateLimiter } from "../rate-limiter"

type Env = {
  CROSSCHEX_API_URL: string
  CROSSCHEX_API_KEY: string
  CROSSCHEX_API_SECRET: string
  RATE_LIMITER: DurableObjectNamespace<CrossChexRateLimiter>
  EMPLOYEES: KVNamespace
}

type AttendanceRecord = {
  uuid: string
  checktype: number
  checktime: string
  source?: number
  device: { serial_number: string; name: string }
  employee: {
    first_name: string
    last_name: string
    workno: string
    department: string
    job_title: string
  }
}

const TOKEN_KV_KEY = "crosschex_token"
const TOKEN_TTL = 7000 // ~2h, margen sobre las 2h reales

const makeHeader = (nameSpace: string, nameAction: string) => ({
  nameSpace,
  nameAction,
  version: "1.0",
  requestId: crypto.randomUUID(),
  timestamp: new Date().toISOString(),
})

const getStub = (env: Env) => env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName("crosschex"))

const rateLimitedFetch = async (env: Env, body: object): Promise<unknown> =>
  pRetry(
    async () => {
      const { data } = await getStub(env).request(env.CROSSCHEX_API_URL, JSON.stringify(body))
      const parsed = JSON.parse(data) as { payload?: { type?: string } }

      if (parsed?.payload?.type === "FREQUENT_REQUEST") {
        throw new Error("FREQUENT_REQUEST")
      }

      return parsed
    },
    { retries: 3, minTimeout: 31_000, factor: 1.5 },
  )

export const getToken = async (env: Env): Promise<string> => {
  const cached = await env.EMPLOYEES.get(TOKEN_KV_KEY)
  if (cached) return cached

  const data = (await rateLimitedFetch(env, {
    header: makeHeader("authorize.token", "token"),
    payload: { api_key: env.CROSSCHEX_API_KEY, api_secret: env.CROSSCHEX_API_SECRET },
  })) as { payload: { token: string } }

  await env.EMPLOYEES.put(TOKEN_KV_KEY, data.payload.token, { expirationTtl: TOKEN_TTL })
  return data.payload.token
}

export const getRecords = async (
  env: Env,
  token: string,
  beginTime: string,
  endTime: string,
  page = 1,
  perPage = 100,
): Promise<{ list: AttendanceRecord[]; pageCount: number; count: number }> => {
  const data = (await rateLimitedFetch(env, {
    header: makeHeader("attendance.record", "getrecord"),
    authorize: { type: "token", token },
    payload: { begin_time: beginTime, end_time: endTime, order: "asc", page, per_page: perPage },
  })) as { payload: { list: AttendanceRecord[]; pageCount: number; count: number } }
  return data.payload
}

export const getAllRecords = async (
  env: Env,
  beginTime: string,
  endTime: string,
): Promise<AttendanceRecord[]> => {
  const token = await getToken(env)
  const first = await getRecords(env, token, beginTime, endTime, 1, 100)
  const all = [...first.list]

  for (let page = 2; page <= first.pageCount; page++) {
    const { list } = await getRecords(env, token, beginTime, endTime, page, 100)
    all.push(...list)
  }

  return all
}

// Asi llega cada marca por webhook: con check_time/check_type en vez del checktime/checktype de la API
type WebhookRecord = Omit<AttendanceRecord, "checktime" | "checktype"> & {
  check_time: string
  check_type: number
}

// El webhook manda { records: [...] }; se pasan al mismo formato que la API
export const parseWebhookPayload = (body: unknown): AttendanceRecord[] =>
  ((body as { records?: WebhookRecord[] })?.records ?? [])
    .filter((record) => record?.uuid && record.check_time && record.employee?.workno)
    .map(({ check_time, check_type, ...record }) => ({ ...record, checktime: check_time, checktype: check_type }))

export type { AttendanceRecord }
