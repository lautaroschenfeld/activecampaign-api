interface RateCounter {
  count: number;
  windowStart: number;
}

export interface RateLimitCheckResult {
  allowed: boolean;
  retryAfterMs: number;
}

export class RateLimitStore {
  private readonly ipCounters = new Map<string, RateCounter>();
  private readonly emailCounters = new Map<string, RateCounter>();
  private readonly emailCooldown = new Map<string, number>();
  private readonly cleanupTimer: NodeJS.Timeout;

  constructor(
    private readonly windowMs: number,
    private readonly maxPerIp: number,
    private readonly maxPerEmail: number,
    private readonly cooldownMs: number
  ) {
    this.cleanupTimer = setInterval(() => this.cleanup(), Math.max(1000, Math.floor(windowMs / 2)));
    this.cleanupTimer.unref();
  }

  consumeIp(ip: string): RateLimitCheckResult {
    return this.consume(this.ipCounters, ip, this.maxPerIp);
  }

  consumeEmail(email: string): RateLimitCheckResult {
    return this.consume(this.emailCounters, email, this.maxPerEmail);
  }

  checkEmailCooldown(email: string): RateLimitCheckResult {
    const now = Date.now();
    const lastSubmitAt = this.emailCooldown.get(email);
    if (lastSubmitAt === undefined) {
      return { allowed: true, retryAfterMs: 0 };
    }

    const elapsed = now - lastSubmitAt;
    if (elapsed >= this.cooldownMs) {
      return { allowed: true, retryAfterMs: 0 };
    }

    return { allowed: false, retryAfterMs: this.cooldownMs - elapsed };
  }

  markEmailSubmission(email: string): void {
    this.emailCooldown.set(email, Date.now());
  }

  shutdown(): void {
    clearInterval(this.cleanupTimer);
  }

  private consume(
    map: Map<string, RateCounter>,
    key: string,
    maxRequests: number
  ): RateLimitCheckResult {
    const now = Date.now();
    const current = map.get(key);

    if (!current) {
      map.set(key, { count: 1, windowStart: now });
      return { allowed: true, retryAfterMs: 0 };
    }

    if (now - current.windowStart >= this.windowMs) {
      map.set(key, { count: 1, windowStart: now });
      return { allowed: true, retryAfterMs: 0 };
    }

    if (current.count >= maxRequests) {
      return {
        allowed: false,
        retryAfterMs: current.windowStart + this.windowMs - now
      };
    }

    current.count += 1;
    map.set(key, current);
    return { allowed: true, retryAfterMs: 0 };
  }

  private cleanup(): void {
    const now = Date.now();

    for (const [key, value] of this.ipCounters.entries()) {
      if (now - value.windowStart > this.windowMs) {
        this.ipCounters.delete(key);
      }
    }

    for (const [key, value] of this.emailCounters.entries()) {
      if (now - value.windowStart > this.windowMs) {
        this.emailCounters.delete(key);
      }
    }

    for (const [key, value] of this.emailCooldown.entries()) {
      if (now - value > this.cooldownMs) {
        this.emailCooldown.delete(key);
      }
    }
  }
}
