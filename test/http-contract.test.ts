import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { handleGitHubWebhookHttp, type WebhookHttpRequest } from "../src/http-contract.js";
import { MAX_WEBHOOK_BODY_BYTES, type DurableWebhookStore } from "../src/webhook.js";

const secret = "It's a Secret to Everybody";
const baseSha = "a".repeat(40);
const headSha = "b".repeat(40);

function body(): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      action: "opened",
      installation: { id: 17 },
      repository: { id: 99 },
      pull_request: {
        number: 42,
        base: { sha: baseSha },
        head: { sha: headSha }
      }
    })
  );
}

function request(
  rawBody = body(),
  overrides: Partial<WebhookHttpRequest> = {}
): WebhookHttpRequest {
  const signature = createHmac("sha256", secret).update(rawBody).digest("hex");
  return {
    method: "POST",
    rawBody,
    headers: {
      "content-type": "application/json",
      "content-length": String(rawBody.byteLength),
      "x-hub-signature-256": "sha256=" + signature,
      "x-github-delivery": "delivery-1",
      "x-github-event": "pull_request",
      "x-github-hook-id": "hook-5"
    },
    receivedAtMs: 1_000,
    nowMs: 1_000,
    ...overrides
  };
}

function config() {
  return { appId: 123, webhookSecret: secret, hookId: "hook-5" };
}

function store(result: "new" | "duplicate" | "conflict" | "unexpected" = "new") {
  return { record: vi.fn<DurableWebhookStore["record"]>(() => Promise.resolve(result)) };
}

describe("framework-neutral webhook HTTP contract", () => {
  it("preserves raw bytes and maps an accepted delivery to 202", async () => {
    const durable = store();
    const result = await handleGitHubWebhookHttp(request(), config(), durable);

    expect(result).toEqual({
      status: 202,
      body: { accepted: true, reason: "accepted" }
    });
    expect(durable.record).toHaveBeenCalledTimes(1);
    expect(durable.record.mock.calls[0]?.[0].body).toEqual(body());
  });

  it("maps duplicates, conflicts, and storage failures without exposing payloads", async () => {
    await expect(handleGitHubWebhookHttp(request(), config(), store("duplicate"))).resolves.toEqual(
      {
        status: 200,
        body: { accepted: false, reason: "duplicate" }
      }
    );
    await expect(handleGitHubWebhookHttp(request(), config(), store("conflict"))).resolves.toEqual({
      status: 409,
      body: { accepted: false, reason: "conflict" }
    });
    await expect(
      handleGitHubWebhookHttp(request(), config(), store("unexpected"))
    ).resolves.toEqual({
      status: 503,
      body: { accepted: false, reason: "store_error" }
    });
  });

  it("rejects unsafe HTTP framing before durable access", async () => {
    const durable = store();
    await expect(
      handleGitHubWebhookHttp(request(body(), { method: "GET" }), config(), durable)
    ).resolves.toMatchObject({ status: 405, body: { reason: "invalid" } });
    await expect(
      handleGitHubWebhookHttp(
        request(body(), { headers: { ...request().headers, "content-type": "text/plain" } }),
        config(),
        durable
      )
    ).resolves.toMatchObject({ status: 400, body: { reason: "invalid" } });
    await expect(
      handleGitHubWebhookHttp(
        request(body(), {
          headers: { ...request().headers, "content-length": "999" }
        }),
        config(),
        durable
      )
    ).resolves.toMatchObject({ status: 400, body: { reason: "invalid" } });
    await expect(
      handleGitHubWebhookHttp(
        request(new Uint8Array(MAX_WEBHOOK_BODY_BYTES + 1)),
        config(),
        durable
      )
    ).resolves.toMatchObject({ status: 413, body: { reason: "invalid" } });
    expect(durable.record).not.toHaveBeenCalled();
  });

  it("rejects duplicate framing headers and never parses invalid input", async () => {
    const durable = store();
    await expect(
      handleGitHubWebhookHttp(
        request(body(), {
          headers: {
            ...request().headers,
            "content-type": ["application/json", "application/json"]
          }
        }),
        config(),
        durable
      )
    ).resolves.toMatchObject({ status: 400, body: { reason: "invalid" } });
    expect(durable.record).not.toHaveBeenCalled();
  });
});
