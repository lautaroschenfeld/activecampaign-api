import type { NextFunction, Request, Response } from "express";
import { ForbiddenOriginError } from "../utils/errors";

function extractOriginFromReferer(referer: string): string | null {
  try {
    const url = new URL(referer);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

export function trustedOriginMiddleware(allowedOrigins: string[]) {
  const allowedOriginSet = new Set(allowedOrigins);

  return (req: Request, _res: Response, next: NextFunction): void => {
    const origin = req.header("origin");
    const referer = req.header("referer");

    if (!origin && !referer) {
      return next(new ForbiddenOriginError("Missing origin and referer"));
    }

    if (origin && !allowedOriginSet.has(origin)) {
      return next(new ForbiddenOriginError("Origin is not trusted", { origin }));
    }

    if (referer) {
      const refererOrigin = extractOriginFromReferer(referer);
      if (!refererOrigin || !allowedOriginSet.has(refererOrigin)) {
        return next(new ForbiddenOriginError("Referer is not trusted", { referer }));
      }
    }

    next();
  };
}
