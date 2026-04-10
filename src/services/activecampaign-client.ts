import { ProviderError } from "../utils/errors";
import { sleep } from "../utils/http";

interface ActiveCampaignClientOptions {
  baseUrl: string;
  apiToken: string;
  requestTimeoutMs: number;
  retryMaxAttempts: number;
  retryInitialMs: number;
  retryMaxMs: number;
  fetchImpl?: typeof fetch;
}

interface RequestOptions {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
}

export class ActiveCampaignClient {
  private readonly baseUrl: string;
  private readonly apiToken: string;
  private readonly requestTimeoutMs: number;
  private readonly retryMaxAttempts: number;
  private readonly retryInitialMs: number;
  private readonly retryMaxMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ActiveCampaignClientOptions) {
    this.baseUrl = this.normalizeBaseUrl(options.baseUrl);
    this.apiToken = options.apiToken;
    this.requestTimeoutMs = options.requestTimeoutMs;
    this.retryMaxAttempts = options.retryMaxAttempts;
    this.retryInitialMs = options.retryInitialMs;
    this.retryMaxMs = options.retryMaxMs;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async request<TResponse>(options: RequestOptions): Promise<TResponse> {
    const url = new URL(options.path.replace(/^\//, ""), this.baseUrl).toString();

    for (let attempt = 1; attempt <= this.retryMaxAttempts; attempt += 1) {
      try {
        const response = await this.fetchWithTimeout(url, options);
        const payload = await this.parsePayload(response);

        if (response.ok) {
          return payload as TResponse;
        }

        const details = {
          provider_status: response.status,
          provider_response: payload,
          method: options.method,
          path: options.path
        };

        if (this.isRetryableStatus(response.status) && attempt < this.retryMaxAttempts) {
          await sleep(this.backoffMs(attempt));
          continue;
        }

        throw new ProviderError("ActiveCampaign request failed", details);
      } catch (error) {
        if (error instanceof ProviderError) {
          throw error;
        }

        if (this.isRetryableError(error) && attempt < this.retryMaxAttempts) {
          await sleep(this.backoffMs(attempt));
          continue;
        }

        throw new ProviderError("ActiveCampaign request failed", {
          method: options.method,
          path: options.path,
          reason: error instanceof Error ? error.message : "unknown_error"
        });
      }
    }

    throw new ProviderError("ActiveCampaign request failed", {
      method: options.method,
      path: options.path,
      reason: "retry_exhausted"
    });
  }

  private async fetchWithTimeout(url: string, options: RequestOptions): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    try {
      return await this.fetchImpl(url, {
        method: options.method,
        headers: {
          "Api-Token": this.apiToken,
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async parsePayload(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) {
      return {};
    }

    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }

  private isRetryableStatus(status: number): boolean {
    return status === 429 || status >= 500;
  }

  private isRetryableError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    return error.name === "AbortError" || error.name === "TypeError";
  }

  private backoffMs(attempt: number): number {
    const exponential = this.retryInitialMs * 2 ** (attempt - 1);
    return Math.min(this.retryMaxMs, exponential);
  }

  private normalizeBaseUrl(rawBaseUrl: string): string {
    const url = new URL(rawBaseUrl);
    const pathWithoutTrailingSlash = url.pathname.replace(/\/+$/, "");

    if (pathWithoutTrailingSlash.endsWith("/api/3")) {
      url.pathname = `${pathWithoutTrailingSlash}/`;
      return url.toString();
    }

    if (!pathWithoutTrailingSlash || pathWithoutTrailingSlash === "/") {
      url.pathname = "/api/3/";
      return url.toString();
    }

    url.pathname = `${pathWithoutTrailingSlash}/api/3/`;
    return url.toString();
  }
}
