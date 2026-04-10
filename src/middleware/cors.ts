import type { NextFunction, Request, Response } from "express";
import { ForbiddenOriginError } from "../utils/errors";

export function corsMiddleware(allowedOrigins: string[]) {
  const allowedOriginSet = new Set(allowedOrigins);

  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.header("origin");
    if (!origin) {
      return next();
    }

    if (!allowedOriginSet.has(origin)) {
      return next(new ForbiddenOriginError("Origin is not allowed", { origin }));
    }

    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, X-Idempotency-Key, X-Request-Id"
    );

    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }

    next();
  };
}
