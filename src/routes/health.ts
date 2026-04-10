import { Router } from "express";
import type { HealthResponse } from "../types/api";

interface HealthRouteOptions {
  serviceName: string;
  version: string;
  environment: string;
}

export function createHealthRouter(options: HealthRouteOptions): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    const payload: HealthResponse = {
      ok: true,
      service: options.serviceName,
      version: options.version,
      environment: options.environment,
      timestamp: new Date().toISOString()
    };

    res.locals.result = "ok";
    res.status(200).json(payload);
  });

  return router;
}
