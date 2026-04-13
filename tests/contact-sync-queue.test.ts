import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { Logger } from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PersistentContactSyncQueue } from "../src/services/contact-sync-queue";
import type { ContactSyncService } from "../src/services/contact-sync-service";
import type { ContactSyncResult } from "../src/services/contact-sync-service";

function wait(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

function createLoggerMock(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  } as unknown as Logger;
}

const queueFilePath = resolve("./tests/.tmp/contact-sync-queue-persistence.json");

afterEach(() => {
  rmSync(queueFilePath, { force: true });
});

describe("PersistentContactSyncQueue", () => {
  it("persists pending jobs and restores them after restart", async () => {
    mkdirSync(dirname(queueFilePath), { recursive: true });
    const logger = createLoggerMock();

    const failingSyncService = {
      syncAndSubscribe: vi.fn().mockRejectedValue(new Error("provider_unavailable"))
    } as unknown as ContactSyncService;

    const queue1 = new PersistentContactSyncQueue(failingSyncService, logger, {
      queueFilePath,
      retryInitialMs: 60_000,
      retryMaxMs: 60_000
    });

    await queue1.enqueue({
      requestId: "req_first",
      idempotencyKey: randomUUID(),
      payload: {
        email: "lead@example.com",
        list_ids: [37]
      }
    });

    await wait(80);
    await queue1.shutdown({ drainTimeoutMs: 200 });

    expect(existsSync(queueFilePath)).toBe(true);
    const persisted = JSON.parse(readFileSync(queueFilePath, "utf8")) as {
      version: number;
      jobs: Array<{ payload: { email: string }; nextAttemptAt: number }>;
    };

    expect(persisted.version).toBe(1);
    expect(persisted.jobs).toHaveLength(1);
    expect(persisted.jobs[0]?.payload.email).toBe("lead@example.com");

    persisted.jobs[0] = {
      ...persisted.jobs[0],
      nextAttemptAt: Date.now() - 1
    };
    writeFileSync(queueFilePath, JSON.stringify(persisted), "utf8");

    const successfulResult: ContactSyncResult = {
      contactId: 123,
      subscribedListIds: [37],
      taggedTagIds: [],
      meta: {},
      warnings: []
    };

    const successfulSyncService = {
      syncAndSubscribe: vi.fn().mockResolvedValue(successfulResult)
    } as unknown as ContactSyncService;

    const queue2 = new PersistentContactSyncQueue(successfulSyncService, logger, {
      queueFilePath,
      retryInitialMs: 20,
      retryMaxMs: 100
    });

    await wait(120);
    await queue2.shutdown({ drainTimeoutMs: 200 });

    expect(successfulSyncService.syncAndSubscribe).toHaveBeenCalledTimes(1);
    expect(existsSync(queueFilePath)).toBe(false);
  });

  it("skips malformed persisted jobs and still processes valid ones", async () => {
    mkdirSync(dirname(queueFilePath), { recursive: true });
    const logger = createLoggerMock();

    const malformedAndValid = {
      version: 1,
      jobs: [
        {
          id: randomUUID(),
          requestId: "req_bad",
          payload: null,
          attempts: 0,
          createdAt: new Date().toISOString(),
          nextAttemptAt: Date.now() - 1
        },
        {
          id: randomUUID(),
          requestId: "req_ok",
          payload: {
            email: "ok@example.com",
            list_ids: [37]
          },
          attempts: 0,
          createdAt: new Date().toISOString(),
          nextAttemptAt: Date.now() - 1
        }
      ]
    };

    writeFileSync(queueFilePath, JSON.stringify(malformedAndValid), "utf8");

    const successfulResult: ContactSyncResult = {
      contactId: 123,
      subscribedListIds: [37],
      taggedTagIds: [],
      meta: {},
      warnings: []
    };

    const successfulSyncService = {
      syncAndSubscribe: vi.fn().mockResolvedValue(successfulResult)
    } as unknown as ContactSyncService;

    const queue = new PersistentContactSyncQueue(successfulSyncService, logger, {
      queueFilePath,
      retryInitialMs: 20,
      retryMaxMs: 100
    });

    await wait(120);
    await queue.shutdown({ drainTimeoutMs: 200 });

    expect(successfulSyncService.syncAndSubscribe).toHaveBeenCalledTimes(1);
    expect(existsSync(queueFilePath)).toBe(false);
  });
});
