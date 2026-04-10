import type { NextFunction, Request, Response } from "express";
import type { ApiErrorResponse } from "../types/api";
import { RateLimitError, toAppError } from "../utils/errors";

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (res.headersSent) {
    return;
  }

  const appError = toAppError(error);
  const payload: ApiErrorResponse = {
    ok: false,
    request_id: req.requestId,
    error: {
      code: appError.code,
      message: appError.message,
      details: appError.details
    }
  };

  if (
    appError instanceof RateLimitError &&
    typeof appError.details.retry_after_seconds === "number"
  ) {
    res.setHeader("Retry-After", String(appError.details.retry_after_seconds));
  }

  if (req.idempotency && !req.idempotency.completed) {
    req.idempotency.complete(appError.statusCode, payload);
  }

  res.locals.result = "error";

  if (req.log) {
    req.log.error(
      {
        request_id: req.requestId,
        code: appError.code,
        status: appError.statusCode,
        details: appError.details
      },
      appError.message
    );
  }

  res.status(appError.statusCode).json(payload);
}
