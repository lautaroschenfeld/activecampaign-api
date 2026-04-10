import type { NextFunction, Request, Response } from "express";
import { RateLimitStore } from "../services/rate-limit-store";
import { RateLimitError, ValidationError } from "../utils/errors";

function getClientIp(req: Request): string {
  if (req.ip) {
    return req.ip;
  }

  return req.socket.remoteAddress ?? "unknown";
}

function msToSeconds(ms: number): number {
  return Math.max(1, Math.ceil(ms / 1000));
}

export function rateLimitMiddleware(store: RateLimitStore) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const email = req.normalizedBody?.email;
    if (!email) {
      return next(new ValidationError("Email is required for rate limiting"));
    }

    const cooldown = store.checkEmailCooldown(email);
    if (!cooldown.allowed) {
      return next(
        new RateLimitError("Email cooldown active", {
          scope: "email_cooldown",
          retry_after_ms: cooldown.retryAfterMs,
          retry_after_seconds: msToSeconds(cooldown.retryAfterMs)
        })
      );
    }

    const ip = getClientIp(req);
    const ipResult = store.consumeIp(ip);
    if (!ipResult.allowed) {
      return next(
        new RateLimitError("Rate limit exceeded for IP", {
          scope: "ip",
          retry_after_ms: ipResult.retryAfterMs,
          retry_after_seconds: msToSeconds(ipResult.retryAfterMs)
        })
      );
    }

    const emailResult = store.consumeEmail(email);
    if (!emailResult.allowed) {
      return next(
        new RateLimitError("Rate limit exceeded for email", {
          scope: "email",
          retry_after_ms: emailResult.retryAfterMs,
          retry_after_seconds: msToSeconds(emailResult.retryAfterMs)
        })
      );
    }

    store.markEmailSubmission(email);
    next();
  };
}
