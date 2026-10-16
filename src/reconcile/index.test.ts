import { describe, expect, it } from "vitest"
import { timeWindows } from "."

describe("timeWindows", () => {
  it("parte el rango en ventanas de hasta 30 dias, sin huecos", () => {
    const from = new Date("2026-03-20T00:00:00Z")
    const to = new Date("2026-05-01T00:00:00Z")
    const windows = timeWindows(from, to)

    expect(windows).toHaveLength(2)
    expect(windows[0][0]).toEqual(from)
    expect(windows[0][1]).toEqual(windows[1][0])
    expect(windows[1][1]).toEqual(to)
  })

  it("un rango corto es una sola ventana", () => {
    const from = new Date("2026-10-14T00:00:00Z")
    const to = new Date("2026-10-16T00:00:00Z")
    expect(timeWindows(from, to)).toEqual([[from, to]])
  })
})
