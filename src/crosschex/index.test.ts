import { describe, expect, it } from "vitest"
import { parseWebhookPayload } from "."

// Mismo formato que manda el webhook de CrossChex (datos inventados)
const webhookBody = {
  records: [
    {
      uuid: "abc123",
      dst_check_time: "2026-10-16T16:47:49+00:00",
      check_time: "2026-10-16T16:47:49+00:00",
      check_type: 128,
      employee: { workno: "99", first_name: "Prueba", last_name: "Local", job_title: "Vendedor", department: "RPM" },
      device: { serial_number: "SN-TEST", name: "FaceDeep3" },
    },
  ],
}

describe("parseWebhookPayload", () => {
  it("lee las marcas de records y las pasa al formato de la API", () => {
    expect(parseWebhookPayload(webhookBody)).toEqual([
      {
        uuid: "abc123",
        dst_check_time: "2026-10-16T16:47:49+00:00",
        checktime: "2026-10-16T16:47:49+00:00",
        checktype: 128,
        employee: webhookBody.records[0].employee,
        device: webhookBody.records[0].device,
      },
    ])
  })

  it("descarta lo que no tiene uuid, hora o empleado", () => {
    expect(parseWebhookPayload({ records: [{ check_time: "2026-10-16T16:47:49+00:00" }] })).toEqual([])
    expect(parseWebhookPayload({ payload: {} })).toEqual([])
    expect(parseWebhookPayload(null)).toEqual([])
  })
})
