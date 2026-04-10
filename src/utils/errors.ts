export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(
    message: string,
    statusCode: number,
    code: string,
    details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message = "Invalid request body", details: Record<string, unknown> = {}) {
    super(message, 400, "validation_error", details);
  }
}

export class ForbiddenOriginError extends AppError {
  constructor(message = "Forbidden origin", details: Record<string, unknown> = {}) {
    super(message, 403, "forbidden_origin", details);
  }
}

export class IdempotencyConflictError extends AppError {
  constructor(message = "Idempotency key conflict", details: Record<string, unknown> = {}) {
    super(message, 409, "idempotency_conflict", details);
  }
}

export class RateLimitError extends AppError {
  constructor(message = "Rate limit exceeded", details: Record<string, unknown> = {}) {
    super(message, 429, "rate_limit_error", details);
  }
}

export class ProviderError extends AppError {
  constructor(message = "Provider request failed", details: Record<string, unknown> = {}) {
    super(message, 502, "provider_error", details);
  }
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (
    error &&
    typeof error === "object" &&
    "type" in error &&
    (error as { type?: string }).type === "entity.too.large"
  ) {
    return new ValidationError("Payload too large");
  }

  if (error instanceof SyntaxError && "body" in error) {
    return new ValidationError("Malformed JSON body");
  }

  return new AppError("Internal server error", 500, "internal_error");
}
