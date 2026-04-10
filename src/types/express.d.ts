import type { Logger } from "pino";
import type { NormalizedContactSyncRequest } from "./api";

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      log: Logger;
      normalizedBody?: NormalizedContactSyncRequest;
      idempotency?: {
        key: string;
        fingerprint: string;
        completed: boolean;
        complete: (statusCode: number, body: unknown) => void;
      };
    }
  }
}

export {};
