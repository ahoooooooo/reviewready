import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  commitEvaluationIfCurrent,
  MAX_WEBHOOK_BODY_BYTES,
  receiveGitHubWebhook,
  sha256Hex,
  type DurableResultStore,
  type DurableWebhookStore
} from "../src/webhook.js";
import { MAX_REPLAY_AGE_MS, type EvaluationBinding } from "../src/trust.js";

const secret = "It's a Secret to Everybody";
const baseSha = "a".repeat(40);
const headSha = "b".repeat(40);

function body(action = "opened"): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      action,
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

function headers(rawBody: Uint8Array, delivery = "delivery-1", event = "pull_request") {
  const signature = createHmac("sha256", secret).update(rawBody).digest("hex");
  return {
    "X-Hub-Signature-256": `sha256=${signature}`,
    "X-GitHub-Delivery": delivery,
    "X-GitHub-Event": event,
    "X-GitHub-Hook-ID": "hook-5"
  };
}

function store(result: "new" | "duplicate" | "conflict" = "new"): DurableWebhookStore {
  return { record: vi.fn(() => Promise.resolve(result)) };
}

function signedRequest(
  rawBody: Uint8Array,
  overrides: Partial<{
    headers: ReturnType<typeof headers>;
    receivedAtMs: number;
    nowMs: number;
  }> = {}
) {
  const receivedAtMs = overrides.receivedAtMs ?? 1_000;
  return {
    rawBody,
    headers: overrides.headers ?? headers(rawBody),
    receivedAtMs,
    nowMs: overrides.nowMs ?? receivedAtMs
  };
}

type WebhookTestHeaders = Readonly<Record<string, string | readonly string[] | undefined>>;

function binding(overrides: Partial<EvaluationBinding> = {}): EvaluationBinding {
  return {
    deliveryId: "delivery-1",
    pullNumber: 42,
    repositoryId: 99,
    baseSha,
    headSha,
    policyPath: ".reviewready.yml",
    policySha: baseSha,
    trustedWorkflowRef: ".github/workflows/reviewready.yml@" + baseSha,
    freshness: "2026-08-12T00:00:00Z",
    evidenceFingerprint: "evidence-1",
    ...overrides
  };
}

describe("GitHub webhook ingress", () => {
  it("verifies raw bytes and atomically records a namespaced delivery", async () => {
    const rawBody = body();
    const record = vi.fn<DurableWebhookStore["record"]>(() => Promise.resolve("new"));
    const durable: DurableWebhookStore = { record };

    const result = await receiveGitHubWebhook(
      { rawBody, headers: headers(rawBody), receivedAtMs: 1_000, nowMs: 1_000 },
      { appId: 123, webhookSecret: secret, hookId: "hook-5" },
      durable
    );

    expect(result).toMatchObject({
      accepted: true,
      reason: "accepted",
      deliveryId: "delivery-1",
      installationId: 17,
      repositoryId: 99,
      pullNumber: 42,
      baseSha,
      headSha,
      action: "opened"
    });
    const captured = record.mock.calls[0]?.[0];
    if (captured === undefined) {
      throw new Error("webhook record was not captured");
    }
    expect(captured.key).toEqual({
      appId: "123",
      hookId: "hook-5",
      installationId: 17,
      deliveryId: "delivery-1"
    });
    expect(captured.replayKey).toMatch(/^123:hook-5:17:[0-9a-f]{64}$/u);
    expect(captured.bodySha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(captured.receivedAtMs).toBe(1_000);
  });

  it("distinguishes duplicate and same-id body conflicts", async () => {
    const rawBody = body();
    await expect(
      receiveGitHubWebhook(
        { rawBody, headers: headers(rawBody), receivedAtMs: 1_000, nowMs: 1_000 },
        { appId: 123, webhookSecret: secret, hookId: "hook-5" },
        store("duplicate")
      )
    ).resolves.toMatchObject({ accepted: false, reason: "duplicate" });
    await expect(
      receiveGitHubWebhook(
        { rawBody, headers: headers(rawBody), receivedAtMs: 1_000, nowMs: 1_000 },
        { appId: 123, webhookSecret: secret, hookId: "hook-5" },
        store("conflict")
      )
    ).resolves.toMatchObject({ accepted: false, reason: "conflict" });
  });

  it("rejects unsupported actions, duplicate headers, and bad signatures before durable access", async () => {
    const rawBody = body("closed");
    const durable = store();
    const invalidHeaders = { ...headers(rawBody), "x-github-delivery": "other-delivery" };

    await expect(
      receiveGitHubWebhook(
        { rawBody, headers: invalidHeaders, receivedAtMs: 1_000, nowMs: 1_000 },
        { appId: 123, webhookSecret: secret, hookId: "hook-5" },
        durable
      )
    ).resolves.toMatchObject({ accepted: false, reason: "invalid" });
    await expect(
      receiveGitHubWebhook(
        {
          rawBody,
          headers: { ...headers(rawBody), "X-Hub-Signature-256": ["bad", "bad"] },
          receivedAtMs: 1_000,
          nowMs: 1_000
        },
        { appId: 123, webhookSecret: secret, hookId: "hook-5" },
        durable
      )
    ).resolves.toMatchObject({ accepted: false, reason: "invalid" });
    expect(durable.record).not.toHaveBeenCalled();
  });

  it("lets the durable namespace reject a replayed body under a new delivery id", async () => {
    const rawBody = body();
    const seen = new Set<string>();
    const record = vi.fn<DurableWebhookStore["record"]>((captured) => {
      expect(captured.replayKey).toMatch(/^123:hook-5:17:[0-9a-f]{64}$/u);
      if (seen.has(captured.replayKey)) {
        return Promise.resolve("duplicate");
      }
      seen.add(captured.replayKey);
      return Promise.resolve("new");
    });
    const durable: DurableWebhookStore = {
      record
    };

    await expect(
      receiveGitHubWebhook(
        {
          rawBody,
          headers: headers(rawBody, "delivery-1"),
          receivedAtMs: 1_000,
          nowMs: 1_000
        },
        { appId: 123, webhookSecret: secret, hookId: "hook-5" },
        durable
      )
    ).resolves.toMatchObject({ accepted: true });
    await expect(
      receiveGitHubWebhook(
        {
          rawBody,
          headers: headers(rawBody, "delivery-2"),
          receivedAtMs: 1_001,
          nowMs: 1_001
        },
        { appId: 123, webhookSecret: secret, hookId: "hook-5" },
        durable
      )
    ).resolves.toMatchObject({ accepted: false, reason: "duplicate" });
  });

  it("rejects a signed body when an untrusted hook id changes the replay namespace", async () => {
    const rawBody = body();
    await expect(
      receiveGitHubWebhook(
        {
          rawBody,
          headers: { ...headers(rawBody), "X-GitHub-Hook-ID": "hook-attacker" },
          receivedAtMs: 1_000,
          nowMs: 1_000
        },
        { appId: 123, webhookSecret: secret, hookId: "hook-5" },
        store()
      )
    ).resolves.toMatchObject({ accepted: false, reason: "invalid" });
  });

  it("binds review events to a review payload discriminator", async () => {
    const rawBody = body("edited");

    await expect(
      receiveGitHubWebhook(
        {
          rawBody,
          headers: headers(rawBody, "delivery-1", "pull_request_review"),
          receivedAtMs: 1_000,
          nowMs: 1_000
        },
        { appId: 123, webhookSecret: secret, hookId: "hook-5" },
        store()
      )
    ).resolves.toMatchObject({ accepted: false, reason: "invalid" });
  });

  it("rejects a pull request event carrying a review payload discriminator", async () => {
    const payload = JSON.parse(new TextDecoder().decode(body("edited"))) as Record<string, unknown>;
    payload.review = { id: 7, state: "commented" };
    const rawBody = new TextEncoder().encode(JSON.stringify(payload));

    await expect(
      receiveGitHubWebhook(
        { rawBody, headers: headers(rawBody), receivedAtMs: 1_000, nowMs: 1_000 },
        { appId: 123, webhookSecret: secret, hookId: "hook-5" },
        store()
      )
    ).resolves.toMatchObject({ accepted: false, reason: "invalid" });
  });

  it("rejects a receipt that is older than the bounded replay window", async () => {
    const rawBody = body();
    const staleRequest = {
      rawBody,
      headers: headers(rawBody),
      receivedAtMs: 1_000,
      nowMs: 1_000 + MAX_REPLAY_AGE_MS + 1
    } as unknown as Parameters<typeof receiveGitHubWebhook>[0];

    await expect(
      receiveGitHubWebhook(
        staleRequest,
        { appId: 123, webhookSecret: secret, hookId: "hook-5" },
        store()
      )
    ).resolves.toMatchObject({ accepted: false, reason: "invalid" });
  });

  it("does not throw for inherited or unknown event names", async () => {
    const rawBody = body();

    await expect(
      receiveGitHubWebhook(
        {
          rawBody,
          headers: headers(rawBody, "delivery-1", "toString"),
          receivedAtMs: 1_000,
          nowMs: 1_000
        },
        { appId: 123, webhookSecret: secret, hookId: "hook-5" },
        store()
      )
    ).resolves.toMatchObject({ accepted: false, reason: "invalid" });
  });

  it("fails closed for malformed request framing and payloads", async () => {
    const rawBody = body();
    const cases: Array<{
      readonly rawBody: Uint8Array;
      readonly request: { readonly receivedAtMs?: number };
      readonly headers?: WebhookTestHeaders;
      readonly config?: {
        readonly appId: number;
        readonly webhookSecret: string;
        readonly hookId: string;
      };
    }> = [
      { rawBody: new Uint8Array(MAX_WEBHOOK_BODY_BYTES + 1), request: {} },
      { rawBody, request: { receivedAtMs: -1 } },
      {
        rawBody,
        request: {},
        config: { appId: 0, webhookSecret: secret, hookId: "hook-5" }
      },
      {
        rawBody,
        request: {},
        config: { appId: 123, webhookSecret: 7 as unknown as string, hookId: "hook-5" }
      },
      { rawBody, request: {}, headers: { ...headers(rawBody), "X-GitHub-Delivery": undefined } },
      {
        rawBody,
        request: {},
        headers: { ...headers(rawBody), "X-GitHub-Delivery": ["delivery-1", "delivery-2"] }
      },
      {
        rawBody,
        request: {},
        headers: { ...headers(rawBody), "X-GitHub-Delivery": "a".repeat(257) }
      },
      {
        rawBody,
        request: {},
        headers: { ...headers(rawBody), "X-GitHub-Hook-ID": "hook\0id" }
      },
      {
        rawBody,
        request: {},
        headers: { ...headers(rawBody), "X-Hub-Signature-256": "sha256=bad" }
      }
    ];

    for (const candidate of cases) {
      await expect(
        receiveGitHubWebhook(
          {
            rawBody: candidate.rawBody,
            headers: candidate.headers ?? headers(candidate.rawBody),
            receivedAtMs: candidate.request.receivedAtMs ?? 1_000,
            nowMs: candidate.request.receivedAtMs ?? 1_000
          },
          candidate.config ?? { appId: 123, webhookSecret: secret, hookId: "hook-5" },
          store()
        )
      ).resolves.toMatchObject({ accepted: false, reason: "invalid" });
    }

    const malformedUtf8 = new Uint8Array([0xff]);
    await expect(
      receiveGitHubWebhook(
        signedRequest(malformedUtf8),
        { appId: 123, webhookSecret: secret, hookId: "hook-5" },
        store()
      )
    ).resolves.toMatchObject({ accepted: false, reason: "invalid" });
    await expect(
      receiveGitHubWebhook(
        signedRequest(new TextEncoder().encode("{")),
        { appId: 123, webhookSecret: secret, hookId: "hook-5" },
        store()
      )
    ).resolves.toMatchObject({ accepted: false, reason: "invalid" });
    await expect(
      receiveGitHubWebhook(
        signedRequest(new TextEncoder().encode("null")),
        { appId: 123, webhookSecret: secret, hookId: "hook-5" },
        store()
      )
    ).resolves.toMatchObject({ accepted: false, reason: "invalid" });
  });

  it("does not throw when the request or configuration object is null", async () => {
    await expect(
      receiveGitHubWebhook(
        null as unknown as Parameters<typeof receiveGitHubWebhook>[0],
        { appId: 123, webhookSecret: secret, hookId: "hook-5" },
        store()
      )
    ).resolves.toMatchObject({ accepted: false, reason: "invalid" });
    await expect(
      receiveGitHubWebhook(
        signedRequest(body()),
        null as unknown as Parameters<typeof receiveGitHubWebhook>[1],
        store()
      )
    ).resolves.toMatchObject({ accepted: false, reason: "invalid" });
  });

  it("fails closed for invalid payload identity, action, SHA, and expiry", async () => {
    const validPayload = JSON.parse(new TextDecoder().decode(body())) as Record<string, unknown>;
    const invalidPayloads = [
      { ...validPayload, action: "closed" },
      { ...validPayload, action: "" },
      { ...validPayload, installation: { id: 0 } },
      { ...validPayload, repository: { id: 0 } },
      { ...validPayload, pull_request: { number: 0 } },
      {
        ...validPayload,
        pull_request: {
          number: 42,
          base: { sha: "bad" },
          head: { sha: headSha }
        }
      },
      { ...validPayload, pull_request: undefined }
    ];
    for (const payload of invalidPayloads) {
      const rawBody = new TextEncoder().encode(JSON.stringify(payload));
      await expect(
        receiveGitHubWebhook(
          signedRequest(rawBody),
          { appId: 123, webhookSecret: secret, hookId: "hook-5" },
          store()
        )
      ).resolves.toMatchObject({ accepted: false, reason: "invalid" });
    }
    await expect(
      receiveGitHubWebhook(
        signedRequest(body(), { receivedAtMs: Number.MAX_SAFE_INTEGER }),
        { appId: 123, webhookSecret: secret, hookId: "hook-5" },
        store()
      )
    ).resolves.toMatchObject({ accepted: false, reason: "invalid" });
  });

  it("accepts a review event only with its review discriminator and reports store failures", async () => {
    const payload = JSON.parse(new TextDecoder().decode(body("submitted"))) as Record<
      string,
      unknown
    >;
    payload.review = { state: "approved" };
    const rawBody = new TextEncoder().encode(JSON.stringify(payload));
    const reviewHeaders = headers(rawBody, "delivery-review", "pull_request_review");

    await expect(
      receiveGitHubWebhook(
        { rawBody, headers: reviewHeaders, receivedAtMs: 1_000, nowMs: 1_000 },
        { appId: 123, webhookSecret: secret, hookId: "hook-5" },
        store("new")
      )
    ).resolves.toMatchObject({ accepted: true, reason: "accepted", action: "submitted" });
    await expect(
      receiveGitHubWebhook(
        { rawBody, headers: reviewHeaders, receivedAtMs: 1_000, nowMs: 1_000 },
        { appId: 123, webhookSecret: secret, hookId: "hook-5" },
        { record: vi.fn(() => Promise.resolve("unexpected")) }
      )
    ).resolves.toMatchObject({ accepted: false, reason: "store_error" });
    await expect(
      receiveGitHubWebhook(
        { rawBody, headers: reviewHeaders, receivedAtMs: 1_000, nowMs: 1_000 },
        { appId: 123, webhookSecret: secret, hookId: "hook-5" },
        { record: vi.fn(() => Promise.reject(new Error("storage unavailable"))) }
      )
    ).resolves.toMatchObject({ accepted: false, reason: "store_error" });
  });
});

describe("durable evaluation result commit", () => {
  it("requires the exact binding and delegates stale ordering to durable CAS", async () => {
    const resultStore: DurableResultStore = {
      commitIfCurrent: vi.fn<DurableResultStore["commitIfCurrent"]>(() =>
        Promise.resolve("committed")
      )
    };
    const expected = binding();

    await expect(
      commitEvaluationIfCurrent(resultStore, {
        repositoryId: 99,
        pullNumber: 42,
        snapshotVersion: `${baseSha}:${headSha}`,
        expectedBinding: expected,
        binding: expected,
        resultDigest: "c".repeat(64)
      })
    ).resolves.toBe("committed");
    await expect(
      commitEvaluationIfCurrent(resultStore, {
        repositoryId: 99,
        pullNumber: 42,
        snapshotVersion: `${baseSha}:${headSha}`,
        expectedBinding: expected,
        binding: binding({ headSha: "d".repeat(40) }),
        resultDigest: "c".repeat(64)
      })
    ).resolves.toBe("binding_mismatch");
    await expect(
      commitEvaluationIfCurrent(resultStore, {
        repositoryId: 100,
        pullNumber: 42,
        snapshotVersion: `${baseSha}:${headSha}`,
        expectedBinding: binding({ repositoryId: 99 }),
        binding: binding({ repositoryId: 99 }),
        resultDigest: "c".repeat(64)
      })
    ).resolves.toBe("binding_mismatch");
    expect(resultStore.commitIfCurrent).toHaveBeenCalledTimes(1);
  });

  it("requires repository identity in the durable binding", async () => {
    const resultStore: DurableResultStore = {
      commitIfCurrent: vi.fn<DurableResultStore["commitIfCurrent"]>(() =>
        Promise.resolve("committed")
      )
    };
    const incomplete = { ...binding(), repositoryId: undefined } as unknown as EvaluationBinding;

    await expect(
      commitEvaluationIfCurrent(resultStore, {
        repositoryId: 99,
        pullNumber: 42,
        snapshotVersion: baseSha + ":" + headSha,
        expectedBinding: incomplete,
        binding: incomplete,
        resultDigest: "c".repeat(64)
      })
    ).resolves.toBe("binding_mismatch");
    expect(resultStore.commitIfCurrent).not.toHaveBeenCalled();
  });

  it("normalizes every durable CAS result and rejects malformed inputs", async () => {
    const expected = binding();
    const input = {
      repositoryId: 99,
      pullNumber: 42,
      snapshotVersion: baseSha + ":" + headSha,
      expectedBinding: expected,
      binding: expected,
      resultDigest: "c".repeat(64)
    };
    for (const result of ["stale", "duplicate", "unexpected"] as const) {
      const storeResult: DurableResultStore = {
        commitIfCurrent: vi.fn(() => Promise.resolve(result))
      };
      await expect(commitEvaluationIfCurrent(storeResult, input)).resolves.toBe(
        result === "unexpected" ? "store_error" : result
      );
    }
    const failing: DurableResultStore = {
      commitIfCurrent: vi.fn(() => Promise.reject(new Error("storage unavailable")))
    };
    await expect(commitEvaluationIfCurrent(failing, input)).resolves.toBe("store_error");
    await expect(
      commitEvaluationIfCurrent(failing, {
        ...input,
        expectedBinding: undefined as unknown as EvaluationBinding
      })
    ).resolves.toBe("binding_mismatch");
    await expect(
      commitEvaluationIfCurrent(failing, { ...input, resultDigest: "bad" })
    ).resolves.toBe("binding_mismatch");
    await expect(
      commitEvaluationIfCurrent(failing, { ...input, snapshotVersion: "" })
    ).resolves.toBe("binding_mismatch");
  });

  it("bounds standalone webhook hashing inputs", () => {
    expect(sha256Hex("payload")).toMatch(/^[0-9a-f]{64}$/u);
    expect(sha256Hex(new Uint8Array([1, 2, 3]))).toMatch(/^[0-9a-f]{64}$/u);
    expect(() => sha256Hex("a".repeat(MAX_WEBHOOK_BODY_BYTES + 1))).toThrow(
      "webhook hash input exceeds limit"
    );
    expect(() => sha256Hex(new Uint8Array(MAX_WEBHOOK_BODY_BYTES + 1))).toThrow(
      "webhook hash input exceeds limit"
    );
  });
});
