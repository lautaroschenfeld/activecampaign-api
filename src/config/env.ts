import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive(),
  NODE_ENV: z.enum(["development", "test", "production"]),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"]),
  ALLOWED_ORIGINS: z.string().min(1),
  ACTIVECAMPAIGN_BASE_URL: z.string().url(),
  ACTIVECAMPAIGN_API_TOKEN: z.string().min(1),
  CONTACT_SYNC_RESPONSE_MODE: z.enum(["sync", "async"]).default("sync"),
  CONTACT_SYNC_QUEUE_FILE: z.string().min(1).default("./data/contact-sync-queue.json"),
  CONTACT_SYNC_QUEUE_RETRY_INITIAL_MS: z.coerce.number().int().positive().default(5000),
  CONTACT_SYNC_QUEUE_RETRY_MAX_MS: z.coerce.number().int().positive().default(300000),
  CONTACT_SYNC_QUEUE_SHUTDOWN_DRAIN_MS: z.coerce.number().int().positive().default(15000),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive(),
  RETRY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10),
  RETRY_INITIAL_MS: z.coerce.number().int().positive(),
  RETRY_MAX_MS: z.coerce.number().int().positive(),
  IDEMPOTENCY_TTL_MS: z.coerce.number().int().positive(),
  IDEMPOTENCY_WAIT_MS: z.coerce.number().int().positive(),
  BODY_LIMIT: z.string().regex(/^\d+\s*(?:b|kb|mb)$/i),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive(),
  RATE_LIMIT_MAX_PER_IP: z.coerce.number().int().positive(),
  RATE_LIMIT_MAX_PER_EMAIL: z.coerce.number().int().positive()
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const message = JSON.stringify(parsed.error.flatten().fieldErrors);
  throw new Error(`Invalid environment variables: ${message}`);
}

const allowedOrigins = Array.from(
  new Set(
    parsed.data.ALLOWED_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0)
  )
);

if (allowedOrigins.length === 0) {
  throw new Error("Invalid environment variables: ALLOWED_ORIGINS cannot be empty");
}

export const env = {
  ...parsed.data,
  ALLOWED_ORIGINS: allowedOrigins
};

export type Env = typeof env;
