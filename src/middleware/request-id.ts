import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const REQUEST_ID_HEADER = "x-request-id";

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incomingId = req.header(REQUEST_ID_HEADER);
  const requestId = incomingId?.trim() || `req_${randomUUID()}`;

  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  next();
}
