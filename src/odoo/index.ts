type OdooEnv = {
  ODOO_URL: string
  ODOO_API_KEY: string
}

// API JSON-2 de Odoo 19: POST /json/2/<modelo>/<metodo> con los parametros en el body
export const callOdoo = async <T>(
  env: OdooEnv,
  model: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> => {
  const response = await fetch(`${env.ODOO_URL}/json/2/${model}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `bearer ${env.ODOO_API_KEY}`,
      "Content-Type": "application/json; charset=utf-8",
      "User-Agent": "telegram-employer-notifier",
    },
    body: JSON.stringify(params),
  })
  const body = (await response.json()) as T & { message?: string }
  if (!response.ok) throw new Error(`Odoo ${model}.${method} (${response.status}): ${body.message ?? "sin detalle"}`)
  return body
}

export type { OdooEnv }
