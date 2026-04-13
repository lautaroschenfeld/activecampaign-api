import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Logger } from "pino";
import type { NormalizedContactSyncRequest } from "../types/api";
import { hashEmail } from "../utils/email";
import { sleep } from "../utils/http";
import { AppError } from "../utils/errors";
import type { ContactSyncService } from "./contact-sync-service";

export interface ContactSyncQueueJob {
  requestId: string;
  idempotencyKey?: string;
  payload: NormalizedContactSyncRequest;
}

export interface ContactSyncQueueShutdownOptions {
  drainTimeoutMs: number;
}

export interface ContactSyncQueue {
  enqueue(job: ContactSyncQueueJob): Promise<void>;
  shutdown(options: ContactSyncQueueShutdownOptions): Promise<void>;
}

interface QueueJobRecord {
  id: string;
  requestId: string;
  idempotencyKey?: string;
  payload: NormalizedContactSyncRequest;
  attempts: number;
  createdAt: string;
  nextAttemptAt: number;
  lastError?: Record<string, unknown>;
}

interface PersistedQueueState {
  version: 1;
  jobs: QueueJobRecord[];
}

interface PersistentContactSyncQueueOptions {
  queueFilePath: string;
  retryInitialMs: number;
  retryMaxMs: number;
}

function serializeUnknownError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }

  return {
    value: String(error)
  };
}

function isQueueJobRecord(value: unknown): value is QueueJobRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<QueueJobRecord>;
  const payload = record.payload as Partial<NormalizedContactSyncRequest> | undefined;
  const listIds = payload?.list_ids;
  const hasValidListIds =
    Array.isArray(listIds) && listIds.every((listId) => Number.isInteger(listId) && listId > 0);

  return (
    typeof record.id === "string" &&
    typeof record.requestId === "string" &&
    !!payload &&
    typeof payload === "object" &&
    typeof payload.email === "string" &&
    payload.email.length > 0 &&
    hasValidListIds &&
    typeof record.attempts === "number" &&
    typeof record.createdAt === "string" &&
    typeof record.nextAttemptAt === "number"
  );
}

export class PersistentContactSyncQueue implements ContactSyncQueue {
  private readonly queueFilePath: string;
  private readonly retryInitialMs: number;
  private readonly retryMaxMs: number;
  private readonly queue: QueueJobRecord[] = [];
  private processing = false;
  private acceptingJobs = true;
  private stopWorker = false;
  private activeJobId: string | null = null;

  constructor(
    private readonly contactSyncService: ContactSyncService,
    private readonly logger: Logger,
    options: PersistentContactSyncQueueOptions
  ) {
    this.queueFilePath = resolve(options.queueFilePath);
    this.retryInitialMs = options.retryInitialMs;
    this.retryMaxMs = options.retryMaxMs;

    this.loadPersistedQueue();
    this.startWorker();
  }

  async enqueue(job: ContactSyncQueueJob): Promise<void> {
    if (!this.acceptingJobs) {
      throw new AppError("Contact sync queue is unavailable", 503, "service_unavailable");
    }

    const record: QueueJobRecord = {
      id: randomUUID(),
      requestId: job.requestId,
      idempotencyKey: job.idempotencyKey,
      payload: job.payload,
      attempts: 0,
      createdAt: new Date().toISOString(),
      nextAttemptAt: Date.now()
    };

    this.queue.push(record);

    try {
      this.persistQueue();
    } catch (error) {
      this.queue.pop();
      throw new AppError("Contact sync queue is unavailable", 503, "service_unavailable", {
        reason: error instanceof Error ? error.message : "queue_persist_failed"
      });
    }

    this.logger.info(
      {
        request_id: record.requestId,
        idempotency_key: record.idempotencyKey ?? null,
        email_hash: hashEmail(record.payload.email),
        queue_size: this.queue.length
      },
      "contact_sync_async_enqueued"
    );

    this.startWorker();
  }

  async shutdown(options: ContactSyncQueueShutdownOptions): Promise<void> {
    this.acceptingJobs = false;

    if (this.queue.length === 0 && !this.processing) {
      return;
    }

    this.startWorker();
    const deadline = Date.now() + options.drainTimeoutMs;

    while (this.processing && Date.now() < deadline) {
      await sleep(50);
    }

    if (this.processing) {
      this.stopWorker = true;
      this.logger.warn(
        {
          queue_size: this.queue.length,
          active_job_id: this.activeJobId,
          drain_timeout_ms: options.drainTimeoutMs
        },
        "contact_sync_async_shutdown_timeout"
      );
    }

    this.persistQueue();
  }

  private loadPersistedQueue(): void {
    if (!existsSync(this.queueFilePath)) {
      return;
    }

    try {
      const raw = readFileSync(this.queueFilePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<PersistedQueueState>;

      if (parsed.version !== 1 || !Array.isArray(parsed.jobs)) {
        throw new Error("invalid_queue_file_shape");
      }

      const restoredJobs = parsed.jobs.filter((job) => isQueueJobRecord(job));
      this.queue.push(...restoredJobs);

      if (restoredJobs.length > 0) {
        this.logger.warn(
          {
            queue_file_path: this.queueFilePath,
            restored_jobs: restoredJobs.length
          },
          "contact_sync_async_queue_restored"
        );
      }
    } catch (error) {
      this.logger.error(
        {
          queue_file_path: this.queueFilePath,
          error: serializeUnknownError(error)
        },
        "contact_sync_async_queue_restore_failed"
      );
    }
  }

  private persistQueue(): void {
    const directory = dirname(this.queueFilePath);
    mkdirSync(directory, { recursive: true });

    if (this.queue.length === 0) {
      if (existsSync(this.queueFilePath)) {
        rmSync(this.queueFilePath, { force: true });
      }
      return;
    }

    const tempPath = `${this.queueFilePath}.tmp`;
    const payload: PersistedQueueState = {
      version: 1,
      jobs: this.queue
    };

    writeFileSync(tempPath, JSON.stringify(payload), "utf8");
    renameSync(tempPath, this.queueFilePath);
  }

  private startWorker(): void {
    if (this.processing || this.stopWorker) {
      return;
    }

    if (this.queue.length === 0) {
      return;
    }

    this.processing = true;
    setImmediate(() => {
      void this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    try {
      while (!this.stopWorker && this.queue.length > 0) {
        const job = this.queue.shift();
        if (!job) {
          continue;
        }

        if (job.nextAttemptAt > Date.now()) {
          this.queue.push(job);
          const waitMs = Math.min(1000, Math.max(50, job.nextAttemptAt - Date.now()));
          await sleep(waitMs);
          continue;
        }

        this.activeJobId = job.id;
        const startedAt = Date.now();

        try {
          const result = await this.contactSyncService.syncAndSubscribe(job.payload);

          this.logger.info(
            {
              request_id: job.requestId,
              idempotency_key: job.idempotencyKey ?? null,
              email_hash: hashEmail(job.payload.email),
              contact_id: result.contactId,
              subscribed_list_ids: result.subscribedListIds,
              tagged_tag_ids: result.taggedTagIds,
              attempts: job.attempts + 1,
              duration_ms: Date.now() - startedAt,
              queue_size: this.queue.length
            },
            "contact_sync_async_completed"
          );

          this.persistQueue();
          this.activeJobId = null;
        } catch (error) {
          job.attempts += 1;
          job.lastError = serializeUnknownError(error);
          job.nextAttemptAt = Date.now() + this.backoffMs(job.attempts);
          this.queue.push(job);

          this.logger.error(
            {
              request_id: job.requestId,
              idempotency_key: job.idempotencyKey ?? null,
              email_hash: hashEmail(job.payload.email),
              attempts: job.attempts,
              next_retry_in_ms: Math.max(0, job.nextAttemptAt - Date.now()),
              duration_ms: Date.now() - startedAt,
              error: job.lastError,
              queue_size: this.queue.length
            },
            "contact_sync_async_failed_retrying"
          );

          this.persistQueue();
          this.activeJobId = null;
        }
      }
    } finally {
      this.processing = false;
      this.activeJobId = null;

      if (!this.stopWorker && this.queue.length > 0) {
        this.startWorker();
      }
    }
  }

  private backoffMs(attempt: number): number {
    const exponential = this.retryInitialMs * 2 ** Math.max(0, attempt - 1);
    return Math.min(this.retryMaxMs, exponential);
  }
}
