import { sleep } from "../utils/http";

export interface IdempotencyStoredResponse {
  statusCode: number;
  body: unknown;
}

interface IdempotencyRecord {
  key: string;
  fingerprint: string;
  state: "in_progress" | "completed";
  createdAt: number;
  expiresAt: number;
  response?: IdempotencyStoredResponse;
}

export type IdempotencyBeginResult =
  | { type: "started" }
  | { type: "replay"; response: IdempotencyStoredResponse }
  | { type: "conflict" }
  | { type: "in_progress" };

export class IdempotencyStore {
  private readonly records = new Map<string, IdempotencyRecord>();
  private readonly cleanupTimer: NodeJS.Timeout;

  constructor(private readonly ttlMs: number) {
    this.cleanupTimer = setInterval(() => this.cleanup(), Math.max(1000, Math.floor(ttlMs / 2)));
    this.cleanupTimer.unref();
  }

  begin(key: string, fingerprint: string): IdempotencyBeginResult {
    this.cleanup();
    const now = Date.now();
    const existing = this.getValidRecord(key, now);

    if (!existing) {
      this.records.set(key, {
        key,
        fingerprint,
        state: "in_progress",
        createdAt: now,
        expiresAt: now + this.ttlMs
      });
      return { type: "started" };
    }

    if (existing.fingerprint !== fingerprint) {
      return { type: "conflict" };
    }

    if (existing.state === "completed" && existing.response) {
      return { type: "replay", response: existing.response };
    }

    return { type: "in_progress" };
  }

  async waitForCompletion(
    key: string,
    fingerprint: string,
    waitMs: number
  ): Promise<IdempotencyBeginResult> {
    const deadline = Date.now() + waitMs;

    while (Date.now() <= deadline) {
      const existing = this.getValidRecord(key);
      if (!existing) {
        return this.begin(key, fingerprint);
      }

      if (existing.fingerprint !== fingerprint) {
        return { type: "conflict" };
      }

      if (existing.state === "completed" && existing.response) {
        return { type: "replay", response: existing.response };
      }

      await sleep(50);
    }

    return { type: "in_progress" };
  }

  complete(key: string, fingerprint: string, response: IdempotencyStoredResponse): void {
    const existing = this.getValidRecord(key);
    if (!existing) {
      return;
    }

    if (existing.fingerprint !== fingerprint) {
      return;
    }

    this.records.set(key, {
      ...existing,
      state: "completed",
      response,
      expiresAt: Date.now() + this.ttlMs
    });
  }

  shutdown(): void {
    clearInterval(this.cleanupTimer);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, record] of this.records.entries()) {
      if (record.expiresAt <= now) {
        this.records.delete(key);
      }
    }
  }

  private getValidRecord(key: string, now = Date.now()): IdempotencyRecord | undefined {
    const record = this.records.get(key);
    if (!record) {
      return undefined;
    }

    if (record.expiresAt <= now) {
      this.records.delete(key);
      return undefined;
    }

    return record;
  }
}
