import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import type { ContactSyncQueue, ContactSyncQueueJob } from "../src/services/contact-sync-queue";
import { RateLimitStore } from "../src/services/rate-limit-store";

const allowedOrigin = "https://allowed.example.com";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

function buildPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    email: "user@example.com",
    first_name: " Juan ",
    last_name: " Perez ",
    phone: "+54 9 11 1234 5678",
    country: " Argentina ",
    consent: true,
    list_ids: [1],
    utm_source: "facebook",
    utm_medium: "cpc",
    utm_campaign: "campania",
    utm_content: "anuncio-1",
    utm_term: "marketing",
    page_url: "https://midominio.com/landing",
    referrer: "https://google.com",
    ...overrides
  };
}

function buildSuccessfulFetch(listIds: number[] = [1], contactId = "123", tagIds: number[] = []) {
  const fetchMock = vi.fn();
  fetchMock.mockResolvedValueOnce(jsonResponse(200, { contact: { id: contactId } }));
  for (const listId of listIds) {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        contactList: {
          id: String(listId),
          list: String(listId),
          contact: contactId,
          status: "1"
        }
      })
    );
  }
  for (const tagId of tagIds) {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, {
        contactTag: {
          id: String(tagId),
          contact: contactId,
          tag: String(tagId)
        }
      })
    );
  }
  return fetchMock;
}

function postSync(app: ReturnType<typeof createApp>, payload: Record<string, unknown>, key?: string) {
  const idempotencyKey = key ?? randomUUID();
  return request(app)
    .post("/contacts/sync-and-subscribe")
    .set("Origin", allowedOrigin)
    .set("Referer", `${allowedOrigin}/landing`)
    .set("X-Idempotency-Key", idempotencyKey)
    .send(payload);
}

function postSyncWithMode(
  app: ReturnType<typeof createApp>,
  payload: Record<string, unknown>,
  mode: "sync" | "async",
  key?: string
) {
  const idempotencyKey = key ?? randomUUID();
  return request(app)
    .post("/contacts/sync-and-subscribe")
    .set("Origin", allowedOrigin)
    .set("Referer", `${allowedOrigin}/landing`)
    .set("X-Idempotency-Key", idempotencyKey)
    .set("X-Contact-Sync-Mode", mode)
    .send(payload);
}

function createQueueMock() {
  const jobs: ContactSyncQueueJob[] = [];
  const queue: ContactSyncQueue = {
    enqueue: vi.fn(async (job: ContactSyncQueueJob) => {
      jobs.push(job);
    }),
    shutdown: vi.fn(async () => {})
  };

  return {
    queue,
    jobs
  };
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("GET /health", () => {
  it("returns service health payload", async () => {
    const app = createApp({ fetchImpl: vi.fn() as unknown as typeof fetch });
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.service).toBe("activecampaign-contact-sync-api");
    expect(typeof response.body.timestamp).toBe("string");
  });
});

describe("POST /contacts/sync-and-subscribe", () => {
  it("syncs and subscribes successfully", async () => {
    const fetchMock = buildSuccessfulFetch([1, 3, 7]);
    const app = createApp({ fetchImpl: fetchMock as unknown as typeof fetch });

    const response = await postSync(app, buildPayload({ list_ids: [1, 3, 7] }));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      request_id: expect.any(String),
      action: "synced",
      contact_id: 123,
      subscribed_list_ids: [1, 3, 7],
      meta: {},
      warnings: []
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("syncs, subscribes and tags successfully", async () => {
    const fetchMock = buildSuccessfulFetch([1, 3], "123", [10, 20]);
    const app = createApp({ fetchImpl: fetchMock as unknown as typeof fetch });

    const response = await postSync(app, buildPayload({ list_ids: [1, 3], tag_ids: [10, 20] }));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      request_id: expect.any(String),
      action: "synced",
      contact_id: 123,
      subscribed_list_ids: [1, 3],
      meta: {
        tagged_tag_ids: [10, 20]
      },
      warnings: []
    });
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("returns 202 and enqueues contact sync in async response mode", async () => {
    const fetchMock = vi.fn();
    const { queue, jobs } = createQueueMock();
    const app = createApp({
      fetchImpl: fetchMock as unknown as typeof fetch,
      contactSyncQueue: queue,
      responseMode: "async"
    });

    const response = await postSync(app, buildPayload({ list_ids: [1, 3], tag_ids: [10, 20] }));

    expect(response.status).toBe(202);
    expect(response.body).toEqual({
      ok: true,
      request_id: expect.any(String),
      action: "accepted",
      queued: true
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.payload.list_ids).toEqual([1, 3]);
    expect(jobs[0]?.payload.tag_ids).toEqual([10, 20]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows overriding response mode with header", async () => {
    const fetchMock = vi.fn();
    const { queue, jobs } = createQueueMock();
    const app = createApp({
      fetchImpl: fetchMock as unknown as typeof fetch,
      contactSyncQueue: queue,
      responseMode: "sync"
    });

    const response = await postSyncWithMode(app, buildPayload({ list_ids: [1, 3] }), "async");

    expect(response.status).toBe(202);
    expect(response.body.action).toBe("accepted");
    expect(jobs).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid x-contact-sync-mode header", async () => {
    const fetchMock = vi.fn();
    const app = createApp({ fetchImpl: fetchMock as unknown as typeof fetch });

    const response = await request(app)
      .post("/contacts/sync-and-subscribe")
      .set("Origin", allowedOrigin)
      .set("Referer", `${allowedOrigin}/landing`)
      .set("X-Idempotency-Key", randomUUID())
      .set("X-Contact-Sync-Mode", "fast")
      .send(buildPayload());

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("validation_error");
    expect(response.body.error.details.field).toBe("x-contact-sync-mode");
  });

  it("deduplicates list_ids before provider calls", async () => {
    const fetchMock = buildSuccessfulFetch([1, 3]);
    const app = createApp({ fetchImpl: fetchMock as unknown as typeof fetch });

    const response = await postSync(app, buildPayload({ list_ids: [1, 1, 3, 3] }));

    expect(response.status).toBe(200);
    expect(response.body.subscribed_list_ids).toEqual([1, 3]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not call contactTags when tag_ids are omitted", async () => {
    const fetchMock = buildSuccessfulFetch([1, 3]);
    const app = createApp({ fetchImpl: fetchMock as unknown as typeof fetch });

    const response = await postSync(app, buildPayload({ list_ids: [1, 3] }));

    expect(response.status).toBe(200);
    expect(response.body.meta).toEqual({});
    const calledUrls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(calledUrls.some((url) => url.endsWith("/contactTags"))).toBe(false);
  });

  it("deduplicates tag_ids before provider calls", async () => {
    const fetchMock = buildSuccessfulFetch([1], "123", [10, 20]);
    const app = createApp({ fetchImpl: fetchMock as unknown as typeof fetch });

    const response = await postSync(app, buildPayload({ list_ids: [1], tag_ids: [10, 10, 20, 20] }));

    expect(response.status).toBe(200);
    expect(response.body.meta).toEqual({ tagged_tag_ids: [10, 20] });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("returns validation failure", async () => {
    const fetchMock = vi.fn();
    const app = createApp({ fetchImpl: fetchMock as unknown as typeof fetch });

    const response = await postSync(app, { list_ids: [1] });

    expect(response.status).toBe(400);
    expect(response.body.ok).toBe(false);
    expect(response.body.error.code).toBe("validation_error");
  });

  it("fails when idempotency key is missing", async () => {
    const fetchMock = vi.fn();
    const app = createApp({ fetchImpl: fetchMock as unknown as typeof fetch });

    const response = await request(app)
      .post("/contacts/sync-and-subscribe")
      .set("Origin", allowedOrigin)
      .set("Referer", `${allowedOrigin}/landing`)
      .send(buildPayload());

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("validation_error");
  });

  it("fails when idempotency key is invalid", async () => {
    const fetchMock = vi.fn();
    const app = createApp({ fetchImpl: fetchMock as unknown as typeof fetch });

    const response = await request(app)
      .post("/contacts/sync-and-subscribe")
      .set("Origin", allowedOrigin)
      .set("Referer", `${allowedOrigin}/landing`)
      .set("X-Idempotency-Key", "not-a-uuid")
      .send(buildPayload());

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("validation_error");
  });

  it("rejects forbidden origin", async () => {
    const fetchMock = vi.fn();
    const app = createApp({ fetchImpl: fetchMock as unknown as typeof fetch });

    const response = await request(app)
      .post("/contacts/sync-and-subscribe")
      .set("Origin", "https://evil.example.com")
      .set("Referer", "https://evil.example.com/form")
      .set("X-Idempotency-Key", randomUUID())
      .send(buildPayload());

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("forbidden_origin");
  });

  it("rejects invalid list_ids values", async () => {
    const fetchMock = vi.fn();
    const app = createApp({ fetchImpl: fetchMock as unknown as typeof fetch });

    const response = await postSync(app, buildPayload({ list_ids: [1, "bad"] }));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("validation_error");
  });

  it("rejects invalid tag_ids values", async () => {
    const fetchMock = vi.fn();
    const app = createApp({ fetchImpl: fetchMock as unknown as typeof fetch });

    const response = await postSync(app, buildPayload({ list_ids: [1], tag_ids: [1, "bad"] }));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("validation_error");
  });

  it("rejects empty tag_ids when provided", async () => {
    const fetchMock = vi.fn();
    const app = createApp({ fetchImpl: fetchMock as unknown as typeof fetch });

    const response = await postSync(app, buildPayload({ list_ids: [1], tag_ids: [] }));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("validation_error");
  });

  it("rejects empty list_ids", async () => {
    const fetchMock = vi.fn();
    const app = createApp({ fetchImpl: fetchMock as unknown as typeof fetch });

    const response = await postSync(app, buildPayload({ list_ids: [] }));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("validation_error");
  });

  it("replays same idempotency key with same body", async () => {
    const fetchMock = buildSuccessfulFetch([1]);
    const app = createApp({ fetchImpl: fetchMock as unknown as typeof fetch });
    const key = randomUUID();
    const payload = buildPayload({ list_ids: [1] });

    const firstResponse = await postSync(app, payload, key);
    const secondResponse = await postSync(app, payload, key);

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(secondResponse.headers["x-idempotent-replay"]).toBe("true");
    expect(secondResponse.body).toEqual(firstResponse.body);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("replays same idempotency key in async mode without enqueueing twice", async () => {
    const fetchMock = vi.fn();
    const { queue, jobs } = createQueueMock();
    const app = createApp({
      fetchImpl: fetchMock as unknown as typeof fetch,
      contactSyncQueue: queue,
      responseMode: "async"
    });
    const key = randomUUID();
    const payload = buildPayload({ list_ids: [1] });

    const firstResponse = await postSync(app, payload, key);
    const secondResponse = await postSync(app, payload, key);

    expect(firstResponse.status).toBe(202);
    expect(secondResponse.status).toBe(202);
    expect(secondResponse.headers["x-idempotent-replay"]).toBe("true");
    expect(secondResponse.body).toEqual(firstResponse.body);
    expect(jobs).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("replays when body differences normalize to same payload", async () => {
    const fetchMock = buildSuccessfulFetch([1]);
    const app = createApp({ fetchImpl: fetchMock as unknown as typeof fetch });
    const key = randomUUID();

    const firstResponse = await postSync(
      app,
      buildPayload({
        email: " USER@Example.com ",
        first_name: "  Juan   Perez  ",
        list_ids: [1, 1]
      }),
      key
    );

    const secondResponse = await postSync(
      app,
      buildPayload({
        email: "user@example.com",
        first_name: "Juan Perez",
        list_ids: [1]
      }),
      key
    );

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(secondResponse.headers["x-idempotent-replay"]).toBe("true");
    expect(secondResponse.body).toEqual(firstResponse.body);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("replays when normalized tag_ids are equivalent", async () => {
    const fetchMock = buildSuccessfulFetch([1], "123", [10]);
    const app = createApp({ fetchImpl: fetchMock as unknown as typeof fetch });
    const key = randomUUID();

    const firstResponse = await postSync(
      app,
      buildPayload({
        list_ids: [1],
        tag_ids: [10, 10]
      }),
      key
    );

    const secondResponse = await postSync(
      app,
      buildPayload({
        list_ids: [1],
        tag_ids: [10]
      }),
      key
    );

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(secondResponse.headers["x-idempotent-replay"]).toBe("true");
    expect(secondResponse.body).toEqual(firstResponse.body);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("returns idempotency conflict for same key and different body", async () => {
    const fetchMock = buildSuccessfulFetch([1]);
    const app = createApp({ fetchImpl: fetchMock as unknown as typeof fetch });
    const key = randomUUID();

    const firstResponse = await postSync(app, buildPayload({ list_ids: [1] }), key);
    const secondResponse = await postSync(app, buildPayload({ list_ids: [2] }), key);

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(409);
    expect(secondResponse.body.error.code).toBe("idempotency_conflict");
  });

  it("returns idempotency conflict for same key and different tag_ids", async () => {
    const fetchMock = buildSuccessfulFetch([1], "123", [10]);
    const app = createApp({ fetchImpl: fetchMock as unknown as typeof fetch });
    const key = randomUUID();

    const firstResponse = await postSync(app, buildPayload({ list_ids: [1], tag_ids: [10] }), key);
    const secondResponse = await postSync(app, buildPayload({ list_ids: [1], tag_ids: [20] }), key);

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(409);
    expect(secondResponse.body.error.code).toBe("idempotency_conflict");
  });

  it("returns provider failure when ActiveCampaign fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(500, {
        errors: [{ title: "Provider error", detail: "Internal error" }]
      })
    );
    const app = createApp({ fetchImpl: fetchMock as unknown as typeof fetch });

    const response = await postSync(app, buildPayload({ list_ids: [1] }));

    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe("provider_error");
  });

  it("returns provider failure when tagging fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { contact: { id: "123" } }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          contactList: { id: "1", list: "1", contact: "123", status: "1" }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(500, {
          errors: [{ title: "Provider error", detail: "Tag failed" }]
        })
      );

    const app = createApp({ fetchImpl: fetchMock as unknown as typeof fetch });
    const response = await postSync(app, buildPayload({ list_ids: [1], tag_ids: [10] }));

    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe("provider_error");
    expect(response.body.error.details.tag_id).toBe(10);
  });

  it("treats duplicate contact tag as success", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { contact: { id: "123" } }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          contactList: { id: "1", list: "1", contact: "123", status: "1" }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(422, {
          errors: [{ title: "Unprocessable", detail: "Contact already has this tag" }]
        })
      );

    const app = createApp({ fetchImpl: fetchMock as unknown as typeof fetch });
    const response = await postSync(app, buildPayload({ list_ids: [1], tag_ids: [10] }));

    expect(response.status).toBe(200);
    expect(response.body.meta).toEqual({ tagged_tag_ids: [10] });
  });

  it("enforces rate limit per IP", async () => {
    const fetchMock = buildSuccessfulFetch([1]);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { contact: { id: "124" } }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        contactList: { id: "1", list: "1", contact: "124", status: "1" }
      })
    );

    const app = createApp({ fetchImpl: fetchMock as unknown as typeof fetch });

    const first = await postSync(app, buildPayload({ email: "one@example.com" }));
    const second = await postSync(app, buildPayload({ email: "two@example.com" }));
    const third = await postSync(app, buildPayload({ email: "three@example.com" }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe("rate_limit_error");
    expect(third.body.error.details.scope).toBe("ip");
  });

  it("ignores spoofed x-forwarded-for for IP rate limit", async () => {
    const fetchMock = buildSuccessfulFetch([1]);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { contact: { id: "124" } }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        contactList: { id: "1", list: "1", contact: "124", status: "1" }
      })
    );

    const app = createApp({ fetchImpl: fetchMock as unknown as typeof fetch });

    const first = await request(app)
      .post("/contacts/sync-and-subscribe")
      .set("Origin", allowedOrigin)
      .set("Referer", `${allowedOrigin}/landing`)
      .set("X-Idempotency-Key", randomUUID())
      .set("X-Forwarded-For", "10.1.1.1")
      .send(buildPayload({ email: "one-spoof@example.com" }));

    const second = await request(app)
      .post("/contacts/sync-and-subscribe")
      .set("Origin", allowedOrigin)
      .set("Referer", `${allowedOrigin}/landing`)
      .set("X-Idempotency-Key", randomUUID())
      .set("X-Forwarded-For", "10.2.2.2")
      .send(buildPayload({ email: "two-spoof@example.com" }));

    const third = await request(app)
      .post("/contacts/sync-and-subscribe")
      .set("Origin", allowedOrigin)
      .set("Referer", `${allowedOrigin}/landing`)
      .set("X-Idempotency-Key", randomUUID())
      .set("X-Forwarded-For", "10.3.3.3")
      .send(buildPayload({ email: "three-spoof@example.com" }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);
    expect(third.body.error.details.scope).toBe("ip");
  });

  it("enforces rate limit per email", async () => {
    const fetchMock = buildSuccessfulFetch([1]);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { contact: { id: "124" } }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        contactList: { id: "1", list: "1", contact: "124", status: "1" }
      })
    );

    const rateLimitStore = new RateLimitStore(60_000, 10, 2, 0);
    const app = createApp({
      fetchImpl: fetchMock as unknown as typeof fetch,
      rateLimitStore
    });

    const payload = buildPayload({ email: "repeat@example.com" });

    const first = await postSync(app, payload);
    const second = await postSync(app, payload);
    const third = await postSync(app, payload);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe("rate_limit_error");
    expect(third.body.error.details.scope).toBe("email");
  });

  it("enforces cooldown for repeated submits of same email", async () => {
    const fetchMock = buildSuccessfulFetch([1]);
    const app = createApp({ fetchImpl: fetchMock as unknown as typeof fetch });
    const payload = buildPayload({ email: "cooldown@example.com" });

    const first = await postSync(app, payload);
    const second = await postSync(app, payload);

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(second.body.error.code).toBe("rate_limit_error");
    expect(second.body.error.details.scope).toBe("email_cooldown");
  });
});
