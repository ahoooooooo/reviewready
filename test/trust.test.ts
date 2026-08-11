import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  MAX_WEBHOOK_BODY_BYTES,
  MAX_WEBHOOK_SECRET_BYTES,
  MAX_WEBHOOK_SIGNATURE_LENGTH,
  acceptWebhookDelivery,
  bindingMatches,
  type ReplayStore,
  type WebhookDeliveryInput,
  type EvaluationBinding,
  verifyWebhookSignature
} from "../src/trust.js";

describe("trusted ingress primitives", () => {
  it("verifies the exact raw webhook bytes", () => {
    const body = Buffer.from('{"text":"caf?"}', "utf8");
    const secret = "test-secret";
    const signature = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

    expect(verifyWebhookSignature(body, signature, secret)).toBe(true);
    expect(verifyWebhookSignature(Buffer.from('{"text":"cafe"}'), signature, secret)).toBe(false);
    expect(verifyWebhookSignature(body, signature.slice(7), secret)).toBe(false);
    expect(verifyWebhookSignature(body, signature + "00", secret)).toBe(false);
  });

  it("rejects an over-limit body before hashing it", () => {
    const body = Buffer.alloc(MAX_WEBHOOK_BODY_BYTES + 1, 0x61);

    expect(verifyWebhookSignature(body, "sha256=" + "a".repeat(64), "secret")).toBe(false);
    expect(verifyWebhookSignature(body, "sha256=" + "a".repeat(1_000_000), "secret")).toBe(false);
  });

  it("rejects an over-limit signature before regex processing", () => {
    const body = Buffer.from("body", "utf8");
    const signature = "sha256=" + "a".repeat(MAX_WEBHOOK_SIGNATURE_LENGTH);

    expect(signature.length).toBeGreaterThan(MAX_WEBHOOK_SIGNATURE_LENGTH);
    expect(verifyWebhookSignature(body, signature, "secret")).toBe(false);
  });

  it("fails closed for malformed runtime ingress values", async () => {
    expect(
      verifyWebhookSignature(null as unknown as Uint8Array, "sha256=" + "a".repeat(64), "secret")
    ).toBe(false);
    expect(verifyWebhookSignature(Buffer.from("body"), null as unknown as string, "secret")).toBe(
      false
    );
    expect(
      verifyWebhookSignature(
        Buffer.from("body"),
        "sha256=" + "a".repeat(64),
        null as unknown as string
      )
    ).toBe(false);

    await expect(
      acceptWebhookDelivery(null as unknown as WebhookDeliveryInput, {
        claim: vi.fn()
      } satisfies ReplayStore)
    ).resolves.toMatchObject({ accepted: false, reason: "invalid" });
    await expect(
      acceptWebhookDelivery(
        {
          deliveryId: 123,
          createdAtMs: 10_000,
          nowMs: 10_500,
          maxAgeMs: 60_000,
          maxFutureSkewMs: 1_000
        } as unknown as WebhookDeliveryInput,
        { claim: vi.fn() } satisfies ReplayStore
      )
    ).resolves.toMatchObject({ accepted: false, reason: "invalid" });
  });

  it("rejects non-boolean replay claims", async () => {
    const claim = vi.fn().mockResolvedValue({ claimed: true });
    const result = await acceptWebhookDelivery(
      {
        deliveryId: "delivery-non-boolean",
        createdAtMs: 10_000,
        nowMs: 10_500,
        maxAgeMs: 60_000,
        maxFutureSkewMs: 1_000
      },
      { claim }
    );

    expect(result).toMatchObject({ accepted: false, reason: "store_error" });
  });

  it("rejects an oversized secret before encoding it", () => {
    const body = Buffer.from("body", "utf8");
    const bufferFrom = vi.spyOn(Buffer, "from");

    try {
      expect(
        verifyWebhookSignature(
          body,
          "sha256=" + "a".repeat(64),
          "s".repeat(MAX_WEBHOOK_SECRET_BYTES + 1)
        )
      ).toBe(false);
      expect(bufferFrom).not.toHaveBeenCalled();
    } finally {
      bufferFrom.mockRestore();
    }
  });

  it("claims a fresh delivery atomically and rejects duplicates", async () => {
    const claim = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const store = { claim };
    const input = {
      deliveryId: "delivery-1",
      createdAtMs: 10_000,
      nowMs: 10_500,
      maxAgeMs: 60_000,
      maxFutureSkewMs: 1_000
    };

    await expect(acceptWebhookDelivery(input, store)).resolves.toMatchObject({
      accepted: true,
      reason: "accepted"
    });
    await expect(acceptWebhookDelivery(input, store)).resolves.toMatchObject({
      accepted: false,
      reason: "duplicate"
    });
    expect(claim).toHaveBeenCalledTimes(2);
    expect(claim.mock.calls[0]?.[0]).toBe("delivery-1");
  });

  it.each([
    ["stale", { createdAtMs: 0, nowMs: 60_001, maxAgeMs: 60_000, maxFutureSkewMs: 1_000 }],
    ["future", { createdAtMs: 62_000, nowMs: 60_000, maxAgeMs: 60_000, maxFutureSkewMs: 1_000 }]
  ])("fails closed for a %s delivery", async (reason, timing) => {
    const claim = vi.fn().mockResolvedValue(true);
    const result = await acceptWebhookDelivery({ deliveryId: "delivery-2", ...timing }, { claim });

    expect(result).toMatchObject({ accepted: false, reason });
    expect(claim).not.toHaveBeenCalled();
  });

  it("fails closed when the replay store is unavailable", async () => {
    const result = await acceptWebhookDelivery(
      {
        deliveryId: "delivery-3",
        createdAtMs: 10_000,
        nowMs: 10_500,
        maxAgeMs: 60_000,
        maxFutureSkewMs: 1_000
      },
      { claim: vi.fn().mockRejectedValue(new Error("store down")) }
    );

    expect(result).toMatchObject({ accepted: false, reason: "store_error" });
  });

  it("binds an evaluation to every trust-relevant identity", () => {
    const binding: EvaluationBinding = {
      deliveryId: "delivery-4",
      pullNumber: 42,
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
      policyPath: ".reviewready.yml",
      policySha: "a".repeat(40),
      trustedWorkflowRef: ".github/workflows/reviewready.yml@" + "a".repeat(40),
      freshness: "snapshot-1",
      evidenceFingerprint: "evidence-1"
    };

    expect(bindingMatches(binding, { ...binding })).toBe(true);
    expect(bindingMatches(binding, { ...binding, headSha: "c".repeat(40) })).toBe(false);
    expect(bindingMatches(binding, { ...binding, policyPath: "other.yml" })).toBe(false);
    expect(bindingMatches(binding, { ...binding, freshness: "snapshot-2" })).toBe(false);
    expect(bindingMatches(binding, { ...binding, evidenceFingerprint: "evidence-2" })).toBe(false);
  });

  it("binds optional App and event identity when the evaluation requires it", () => {
    const expected = {
      deliveryId: "delivery-4",
      pullNumber: 42,
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
      policyPath: ".reviewready.yml",
      policySha: "a".repeat(40),
      trustedWorkflowRef: ".github/workflows/reviewready.yml@" + "a".repeat(40),
      freshness: "snapshot-1",
      evidenceFingerprint: "evidence-1",
      repositoryId: 99,
      installationId: 17,
      action: "opened"
    };

    expect(bindingMatches(expected, { ...expected })).toBe(true);
    expect(bindingMatches(expected, { ...expected, installationId: 18 })).toBe(false);
    expect(bindingMatches(expected, { ...expected, installationId: undefined })).toBe(false);
  });

  it("rejects replay expiries that overflow the safe integer range", async () => {
    const claim = vi.fn().mockResolvedValue(true);
    const result = await acceptWebhookDelivery(
      {
        deliveryId: "delivery-overflow",
        createdAtMs: Number.MAX_SAFE_INTEGER,
        nowMs: Number.MAX_SAFE_INTEGER,
        maxAgeMs: 1,
        maxFutureSkewMs: 0
      },
      { claim }
    );

    expect(result).toMatchObject({ accepted: false, reason: "invalid" });
    expect(claim).not.toHaveBeenCalled();
  });
});
