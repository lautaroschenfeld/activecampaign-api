import type { NextFunction, Request, Response } from "express";
import type { Logger } from "pino";
import { hashEmail, normalizeEmail } from "../utils/email";

function readEmail(req: Request): string | undefined {
  if (req.normalizedBody?.email) {
    return req.normalizedBody.email;
  }

  const rawEmail = req.body?.email;
  if (typeof rawEmail !== "string") {
    return undefined;
  }

  return normalizeEmail(rawEmail);
}

export function requestLoggerMiddleware(logger: Logger) {
  return (req: Request, res: Response, next: NextFunction): void => {
    req.log = logger.child({ request_id: req.requestId });
    const startedAt = process.hrtime.bigint();

    res.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const email = readEmail(req);

      logger.info(
        {
          request_id: req.requestId,
          path: req.path,
          method: req.method,
          origin: req.header("origin") ?? null,
          email_hash: hashEmail(email),
          status: res.statusCode,
          duration_ms: Number(durationMs.toFixed(2)),
          result: res.locals.result ?? (res.statusCode < 400 ? "ok" : "error")
        },
        "request_completed"
      );
    });

    next();
  };
}
