import type { NextFunction, Request, RequestHandler, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import type { ContactSyncQueue } from "../services/contact-sync-queue";
import { ContactSyncService } from "../services/contact-sync-service";
import type {
  ContactSyncAcceptedResponse,
  ContactSyncRequest,
  ContactSyncResponseMode,
  ContactSyncSuccessResponse
} from "../types/api";
import { normalizeContactSyncInput } from "../utils/normalize";
import { isJsonContentType } from "../utils/http";
import { ValidationError } from "../utils/errors";

const contactSyncSchema = z
  .object({
    email: z.string().trim().toLowerCase().max(320).email(),
    first_name: z.string().trim().max(100).optional(),
    last_name: z.string().trim().max(100).optional(),
    phone: z.string().trim().max(40).optional(),
    country: z.string().trim().max(100).optional(),
    consent: z.boolean().optional(),
    list_ids: z.array(z.number().int().positive()).min(1),
    tag_ids: z.array(z.number().int().positive()).min(1).optional(),
    utm_source: z.string().trim().max(200).optional(),
    utm_medium: z.string().trim().max(200).optional(),
    utm_campaign: z.string().trim().max(200).optional(),
    utm_content: z.string().trim().max(200).optional(),
    utm_term: z.string().trim().max(200).optional(),
    page_url: z.string().trim().max(2048).optional(),
    referrer: z.string().trim().max(2048).optional()
  })
  .strict();

interface ContactsRouterOptions {
  contactSyncService: ContactSyncService;
  contactSyncQueue: ContactSyncQueue;
  responseMode: ContactSyncResponseMode;
  trustedOriginMiddleware: RequestHandler;
  idempotencyMiddleware: RequestHandler;
  rateLimitMiddleware: RequestHandler;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireJsonContentType(req: Request, _res: Response, next: NextFunction): void {
  if (!isJsonContentType(req.header("content-type"))) {
    return next(
      new ValidationError("Content-Type must be application/json", {
        field: "content-type"
      })
    );
  }

  next();
}

function validateAndNormalizePayload(req: Request, _res: Response, next: NextFunction): void {
  if (!isPlainObject(req.body) || Object.keys(req.body).length === 0) {
    return next(new ValidationError("Invalid request body", { reason: "empty_or_invalid_body" }));
  }

  const parsed = contactSyncSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(
      new ValidationError("Invalid request body", {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message
        }))
      })
    );
  }

  const normalized = normalizeContactSyncInput(parsed.data as ContactSyncRequest);
  if (normalized.list_ids.length === 0) {
    return next(
      new ValidationError("Invalid request body", {
        issues: [{ path: "list_ids", message: "list_ids must contain positive integers" }]
      })
    );
  }

  req.normalizedBody = normalized;
  next();
}

function resolveResponseMode(
  req: Request,
  defaultMode: ContactSyncResponseMode
): ContactSyncResponseMode {
  const headerValue = req.header("x-contact-sync-mode")?.trim().toLowerCase();
  if (!headerValue) {
    return defaultMode;
  }

  if (headerValue === "sync" || headerValue === "async") {
    return headerValue;
  }

  throw new ValidationError("Invalid x-contact-sync-mode header", {
    field: "x-contact-sync-mode",
    allowed_values: ["sync", "async"]
  });
}

export function createContactsRouter(options: ContactsRouterOptions): Router {
  const router = Router();

  router.post(
    "/sync-and-subscribe",
    options.trustedOriginMiddleware,
    requireJsonContentType,
    validateAndNormalizePayload,
    options.idempotencyMiddleware,
    options.rateLimitMiddleware,
    (req: Request, res: Response, next: NextFunction) => {
      const run = async (): Promise<void> => {
        const payload = req.normalizedBody;
        if (!payload) {
          throw new ValidationError("Invalid request body");
        }

        const responseMode = resolveResponseMode(req, options.responseMode);

        if (responseMode === "async") {
          await options.contactSyncQueue.enqueue({
            requestId: req.requestId,
            idempotencyKey: req.idempotency?.key,
            payload
          });

          const response: ContactSyncAcceptedResponse = {
            ok: true,
            request_id: req.requestId,
            action: "accepted",
            queued: true
          };

          if (req.idempotency) {
            req.idempotency.complete(202, response);
          }

          res.locals.result = "accepted";
          res.status(202).json(response);
          return;
        }

        const result = await options.contactSyncService.syncAndSubscribe(payload);

        const response: ContactSyncSuccessResponse = {
          ok: true,
          request_id: req.requestId,
          action: "synced",
          contact_id: result.contactId,
          subscribed_list_ids: result.subscribedListIds,
          meta: result.meta,
          warnings: result.warnings
        };

        if (req.idempotency) {
          req.idempotency.complete(200, response);
        }

        res.locals.result = "synced";
        res.status(200).json(response);
      };

      void run().catch(next);
    }
  );

  return router;
}
