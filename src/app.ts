import express, { type Express } from "express";
import type { Logger } from "pino";
import { env } from "./config/env";
import { createLogger } from "./config/logger";
import { corsMiddleware } from "./middleware/cors";
import { errorHandler } from "./middleware/error-handler";
import { idempotencyMiddleware } from "./middleware/idempotency";
import { rateLimitMiddleware } from "./middleware/rate-limit";
import { requestIdMiddleware } from "./middleware/request-id";
import { requestLoggerMiddleware } from "./middleware/request-logger";
import { trustedOriginMiddleware } from "./middleware/trusted-origin";
import { createContactsRouter } from "./routes/contacts";
import { createHealthRouter } from "./routes/health";
import { ActiveCampaignClient } from "./services/activecampaign-client";
import { ActiveCampaignService } from "./services/activecampaign-service";
import { ContactSyncService } from "./services/contact-sync-service";
import { IdempotencyStore } from "./services/idempotency-store";
import { RateLimitStore } from "./services/rate-limit-store";
import { AppError } from "./utils/errors";

export interface CreateAppOptions {
  fetchImpl?: typeof fetch;
  logger?: Logger;
  contactSyncService?: ContactSyncService;
  idempotencyStore?: IdempotencyStore;
  rateLimitStore?: RateLimitStore;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const logger = options.logger ?? createLogger(env.LOG_LEVEL);

  const idempotencyStore = options.idempotencyStore ?? new IdempotencyStore(env.IDEMPOTENCY_TTL_MS);
  const rateLimitStore =
    options.rateLimitStore ??
    new RateLimitStore(
      env.RATE_LIMIT_WINDOW_MS,
      env.RATE_LIMIT_MAX_PER_IP,
      env.RATE_LIMIT_MAX_PER_EMAIL,
      10_000
    );

  const contactSyncService =
    options.contactSyncService ??
    new ContactSyncService(
      new ActiveCampaignService(
        new ActiveCampaignClient({
          baseUrl: env.ACTIVECAMPAIGN_BASE_URL,
          apiToken: env.ACTIVECAMPAIGN_API_TOKEN,
          requestTimeoutMs: env.REQUEST_TIMEOUT_MS,
          retryMaxAttempts: env.RETRY_MAX_ATTEMPTS,
          retryInitialMs: env.RETRY_INITIAL_MS,
          retryMaxMs: env.RETRY_MAX_MS,
          fetchImpl: options.fetchImpl
        })
      )
    );

  const app = express();
  app.disable("x-powered-by");

  app.use(requestIdMiddleware);
  app.use(requestLoggerMiddleware(logger));
  app.use(corsMiddleware(env.ALLOWED_ORIGINS));
  app.use(
    express.json({
      limit: env.BODY_LIMIT
    })
  );

  app.use(
    "/health",
    createHealthRouter({
      serviceName: "activecampaign-contact-sync-api",
      version: process.env.npm_package_version ?? "1.0.0",
      environment: env.NODE_ENV
    })
  );

  app.use(
    "/contacts",
    createContactsRouter({
      contactSyncService,
      trustedOriginMiddleware: trustedOriginMiddleware(env.ALLOWED_ORIGINS),
      idempotencyMiddleware: idempotencyMiddleware(idempotencyStore, env.IDEMPOTENCY_WAIT_MS),
      rateLimitMiddleware: rateLimitMiddleware(rateLimitStore)
    })
  );

  app.use((_req, _res, next) => {
    next(new AppError("Route not found", 404, "not_found"));
  });

  app.use(errorHandler);

  app.locals.shutdown = () => {
    idempotencyStore.shutdown();
    rateLimitStore.shutdown();
  };

  return app;
}
