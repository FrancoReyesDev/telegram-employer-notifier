import { DurableObject } from "cloudflare:workers"

const REFILL_INTERVAL_MS = 30_000
const MAX_TOKENS = 1

export class CrossChexRateLimiter extends DurableObject {
  private tokens = MAX_TOKENS
  private lastRefillAt = Date.now()

  async request(url: string, body: string): Promise<{ data: string; waitedMs: number }> {
    const waitedMs = await this.consumeToken()

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    })
    const data = await res.text()

    return { data, waitedMs }
  }

  async hasToken(): Promise<boolean> {
    this.refill()
    return this.tokens >= 1
  }

  private refill() {
    const now = Date.now()
    const elapsed = now - this.lastRefillAt
    const newTokens = elapsed / REFILL_INTERVAL_MS
    this.tokens = Math.min(MAX_TOKENS, this.tokens + newTokens)
    this.lastRefillAt = now
  }

  private async consumeToken(): Promise<number> {
    this.refill()

    if (this.tokens >= 1) {
      this.tokens -= 1
      return 0
    }

    const deficit = 1 - this.tokens
    const waitMs = Math.ceil(deficit * REFILL_INTERVAL_MS)
    await new Promise((r) => setTimeout(r, waitMs))

    this.refill()
    this.tokens -= 1
    return waitMs
  }
}
