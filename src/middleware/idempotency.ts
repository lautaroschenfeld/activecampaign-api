import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { IdempotencyStore } from "../services/idempotency-store";
import { IdempotencyConflictError, ValidationError } from "../utils/errors";
import { createRequestFingerprint } from "../utils/http";

const idempotencyKeySchema = z.string().uuid();

export function idempotencyMiddleware(store: IdempotencyStore, waitMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const keyValue = req.header("x-idempotency-key")?.trim();
    if (!keyValue) {
      return next(
        new ValidationError("Missing X-Idempotency-Key header", {
          field: "x-idempotency-key"
        })
      );
    }

    const keyParse = idempotencyKeySchema.safeParse(keyValue);
    if (!keyParse.success) {
      return next(
        new ValidationError("X-Idempotency-Key must be a valid UUID", {
          field: "x-idempotency-key"
        })
      );
    }

    const key = keyParse.data;
    const bodyForFingerprint = req.normalizedBody ?? req.body ?? {};
    const fingerprint = createRequestFingerprint(req.method, req.path, bodyForFingerprint);

    const handle = async (): Promise<void> => {
      const beginResult = store.begin(key, fingerprint);
      if (beginResult.type === "started") {
        req.idempotency = {
          key,
          fingerprint,
          completed: false,
          complete: (statusCode: number, body: unknown) => {
            if (req.idempotency?.completed) {
              return;
            }

            store.complete(key, fingerprint, { statusCode, body });
            if (req.idempotency) {
              req.idempotency.completed = true;
            }
          }
        };
        next();
        return;
      }

      if (beginResult.type === "replay") {
        res.setHeader("X-Idempotent-Replay", "true");
        res.locals.result = "replay";
        res.status(beginResult.response.statusCode).json(beginResult.response.body);
        return;
      }

      if (beginResult.type === "conflict") {
        throw new IdempotencyConflictError("X-Idempotency-Key already used with a different payload", {
          key
        });
      }

      const waitedResult = await store.waitForCompletion(key, fingerprint, waitMs);
      if (waitedResult.type === "replay") {
        res.setHeader("X-Idempotent-Replay", "true");
        res.locals.result = "replay";
        res.status(waitedResult.response.statusCode).json(waitedResult.response.body);
        return;
      }

      if (waitedResult.type === "started") {
        req.idempotency = {
          key,
          fingerprint,
          completed: false,
          complete: (statusCode: number, body: unknown) => {
            if (req.idempotency?.completed) {
              return;
            }

            store.complete(key, fingerprint, { statusCode, body });
            if (req.idempotency) {
              req.idempotency.completed = true;
            }
          }
        };
        next();
        return;
      }

      throw new IdempotencyConflictError("Request with this idempotency key is still in progress", {
        key
      });
    };

    void handle().catch(next);
  };
}
