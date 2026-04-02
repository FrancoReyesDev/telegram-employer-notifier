type Env = {
  TELEGRAM_BOT_TOKEN: string
  TELEGRAM_CHAT_ID: string
}

type TelegramUpdate = {
  message?: {
    chat: { id: number }
    text?: string
  }
  callback_query?: {
    id: string
    data?: string
    message?: { chat: { id: number } }
  }
}

type InlineButton = { text: string; callback_data: string }

const TELEGRAM_API = "https://api.telegram.org"

const buildUrl = (token: string, method: string) =>
  `${TELEGRAM_API}/bot${token}/${method}`

export const sendMessage = async (
  env: Env,
  text: string,
  chatId?: string | number,
) => {
  const url = buildUrl(env.TELEGRAM_BOT_TOKEN, "sendMessage")
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId ?? env.TELEGRAM_CHAT_ID,
      text,
      parse_mode: "Markdown",
    }),
  })
  return res.json()
}

export const sendMessageWithButtons = async (
  env: Env,
  text: string,
  buttons: InlineButton[][],
  chatId?: string | number,
) => {
  const url = buildUrl(env.TELEGRAM_BOT_TOKEN, "sendMessage")
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId ?? env.TELEGRAM_CHAT_ID,
      text,
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: buttons },
    }),
  })
  return res.json()
}

export const answerCallbackQuery = async (token: string, callbackQueryId: string) => {
  const url = buildUrl(token, "answerCallbackQuery")
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId }),
  })
}

export const parseCommand = (text: string): string | null => {
  if (text.startsWith("/")) return text.split("@")[0].split(" ")[0]

  const normalized = text.toLowerCase().trim()
  const aliases: Record<string, string> = {
    asistencia: "/asistencia",
    empleados: "/empleados",
    sync: "/sync",
  }
  return aliases[normalized] ?? null
}

export const parseUpdate = (body: unknown): TelegramUpdate | null => {
  const update = body as TelegramUpdate
  if (!update?.message?.text && !update?.callback_query) return null
  return update
}

export const setWebhook = async (token: string, url: string) => {
  const res = await fetch(buildUrl(token, "setWebhook"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  })
  return res.json()
}

export const MENU_BUTTONS: InlineButton[][] = [
  [{ text: "\u{1F4CB} Asistencia", callback_data: "asistencia" }],
  [{ text: "\u{1F465} Empleados", callback_data: "empleados" }],
  [{ text: "\u{1F504} Sync", callback_data: "sync" }],
]

export const MENU_TEXT = [
  "*Que queres hacer?*\n",
  "\u{1F4CB} *Asistencia* — Ver quien vino hoy y quien falta",
  "\u{1F465} *Empleados* — Lista de empleados registrados",
  "\u{1F504} *Sync* — Sincronizar empleados desde CrossChex",
].join("\n")
