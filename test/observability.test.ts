import { describe, expect, it, vi } from "vitest";

import {
  createTrustAuditEvent,
  emitTrustAuditEvent,
  type TrustAuditEventInput,
  type TrustAuditEventSink
} from "../src/observability.js";

const baseSha = "a".repeat(40);
const headSha = "b".repeat(40);
const policySha = "c".repeat(64);

function input(overrides: Partial<TrustAuditEventInput> = {}): TrustAuditEventInput {
  return {
    eventId: "11111111-1111-4111-8111-111111111111",
    correlationId: "22222222-2222-4222-8222-222222222222",
    kind: "webhook",
    outcome: "accepted",
    occurredAtMs: 1_000,
    repositoryId: 99,
    installationId: 17,
    pullNumber: 42,
    baseSha,
    headSha,
    policySha,
    action: "opened",
    ...overrides
  };
}

describe("trust observability contract", () => {
  it("creates a bounded event containing identities but no sensitive payload", () => {
    const event = createTrustAuditEvent({
      ...input(),
      rawBody: "must-not-be-copied",
      prompt: "must-not-be-copied"
    });

    expect(event).toEqual({
      eventVersion: 1,
      eventId: "11111111-1111-4111-8111-111111111111",
      correlationId: "22222222-2222-4222-8222-222222222222",
      kind: "webhook",
      outcome: "accepted",
      occurredAtMs: 1_000,
      repositoryId: 99,
      installationId: 17,
      pullNumber: 42,
      baseSha,
      headSha,
      policySha,
      action: "opened"
    });
    expect(event).not.toHaveProperty("rawBody");
    expect(event).not.toHaveProperty("prompt");
  });

  it.each([
    ["invalid SHA", { baseSha: "bad" }],
    ["invalid identity", { repositoryId: 0 }],
    ["unbounded correlation", { correlationId: "a".repeat(129) }],
    ["invalid outcome", { outcome: "maybe" as never }],
    ["invalid clock", { occurredAtMs: -1 }]
  ])("rejects %s without producing an event", (_label, overrides) => {
    expect(() => createTrustAuditEvent(input(overrides))).toThrow(
      expect.objectContaining({ code: "TRUST_AUDIT_EVENT_INVALID" })
    );
  });

  it.each([
    ["payload text in event id", { eventId: "pull request body with prompt text" }],
    ["payload text in correlation id", { correlationId: "workflow source: run deploy" }],
    ["payload text in action", { action: "send secret to an external service" as never }],
    ["token-shaped event id", { eventId: "gho_" + "a".repeat(36) }]
  ])("rejects %s in an identity-only field", (_label, overrides) => {
    expect(() => createTrustAuditEvent(input(overrides))).toThrow(
      expect.objectContaining({ code: "TRUST_AUDIT_EVENT_INVALID" })
    );
  });

  it("fails closed when the audit sink is unavailable or returns an unknown result", async () => {
    const event = createTrustAuditEvent(input());
    const failing: TrustAuditEventSink = {
      record: vi.fn(() => Promise.reject(new Error("sink unavailable")))
    };
    const unknown: TrustAuditEventSink = {
      record: vi.fn(() => Promise.resolve("unknown" as never))
    };

    await expect(emitTrustAuditEvent(failing, event)).resolves.toBe("store_error");
    await expect(emitTrustAuditEvent(unknown, event)).resolves.toBe("store_error");
  });

  it("does not turn invalid event data into a sink write", async () => {
    const sink: TrustAuditEventSink = {
      record: vi.fn(() => Promise.resolve("recorded"))
    };

    await expect(emitTrustAuditEvent(sink, input({ policySha: "bad" }))).resolves.toBe("invalid");
    expect(sink.record).not.toHaveBeenCalled();
  });
});
