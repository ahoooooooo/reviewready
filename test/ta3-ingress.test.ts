import { describe, expect, it } from "vitest";

import {
  InMemoryTrustedIngressStore,
  TA3_MAX_BODY_BYTES,
  TA3_MAX_REPLAY_AGE_MS,
  TrustedIngressModeController,
  acceptTrustedDelivery,
  deriveBindingDigest,
  evaluateTrustedSnapshot,
  validateInstallationTokenProfile,
  type TrustedDelivery,
  type TrustedIngressBinding,
  type ProviderCheckRun
} from "../src/ta3-ingress.js";

const baseSha = "a".repeat(40);
const headSha = "b".repeat(40);
const policySha256 = "1".repeat(64);
const rootDigest = "2".repeat(64);

function binding(overrides: Partial<TrustedIngressBinding> = {}): TrustedIngressBinding {
  return {
    appId: 9001,
    hookId: "hook-7",
    installationId: 8001,
    repositoryId: 7001,
    pullNumber: 42,
    baseSha,
    headSha,
    policyPath: ".reviewready.yml",
    policySha256,
    rootDigest,
    checkName: "ReviewReady / trusted",
    ...overrides
  };
}

function delivery(
  deliveryId: string,
  bodySha256: string,
  overrides: Partial<TrustedDelivery> = {}
): TrustedDelivery {
  return {
    deliveryId,
    bodySha256,
    binding: binding(),
    receivedAtMs: 1_000,
    nowMs: 1_000,
    ...overrides
  };
}

function checkRun(overrides: Partial<ProviderCheckRun> = {}): ProviderCheckRun {
  return {
    appId: 9001,
    repositoryId: 7001,
    headSha,
    name: "ReviewReady / trusted",
    externalId: "rr1-" + "3".repeat(64),
    ...overrides
  };
}

describe("TA-3 trusted ingress state machine", () => {
  it("claims a delivery and body atomically, then preserves idempotency aliases", async () => {
    const store = new InMemoryTrustedIngressStore();
    const first = delivery("delivery-1", "1".repeat(64));

    await expect(acceptTrustedDelivery(store, first)).resolves.toMatchObject({
      outcome: "accepted",
      accepted: true,
      generation: 1
    });
    await expect(acceptTrustedDelivery(store, first)).resolves.toMatchObject({
      outcome: "duplicate",
      accepted: false
    });
    await expect(
      acceptTrustedDelivery(store, delivery("delivery-2", first.bodySha256))
    ).resolves.toMatchObject({ outcome: "duplicate", accepted: false });

    expect(store.inspect()).toMatchObject({
      deliveryClaims: 1,
      bodyClaims: 1,
      evaluationCount: 1,
      deliveryAliases: 1,
      currentGeneration: 1
    });
  });

  it("distinguishes same-delivery conflicts from body replays", async () => {
    const store = new InMemoryTrustedIngressStore();
    const first = delivery("delivery-1", "1".repeat(64));
    await acceptTrustedDelivery(store, first);

    await expect(
      acceptTrustedDelivery(store, delivery("delivery-1", "2".repeat(64)))
    ).resolves.toMatchObject({ outcome: "conflict", accepted: false });
    await expect(
      acceptTrustedDelivery(
        store,
        delivery("delivery-2", first.bodySha256, {
          binding: binding({ policySha256: "4".repeat(64) })
        })
      )
    ).resolves.toMatchObject({ outcome: "conflict", accepted: false });
    expect(store.inspect()).toMatchObject({ deliveryClaims: 1, bodyClaims: 1 });
  });

  it("allows only one winner for concurrent first acceptance", async () => {
    const store = new InMemoryTrustedIngressStore();
    const results = await Promise.all([
      acceptTrustedDelivery(store, delivery("delivery-1", "1".repeat(64))),
      acceptTrustedDelivery(store, delivery("delivery-2", "1".repeat(64)))
    ]);

    expect(results.map((result) => result.outcome).sort()).toEqual(["accepted", "duplicate"]);
    expect(results.filter((result) => result.accepted)).toHaveLength(1);
    expect(store.inspect()).toMatchObject({ bodyClaims: 1, evaluationCount: 1 });
  });

  it("does not infer acceptance after an ambiguous store result", async () => {
    const store = new InMemoryTrustedIngressStore({ acceptFault: "unknown-after-commit" });
    const input = delivery("delivery-1", "1".repeat(64));

    await expect(acceptTrustedDelivery(store, input)).resolves.toMatchObject({
      outcome: "store_error",
      accepted: false,
      callerKnowledge: "unresolved",
      requiresReconciliation: true,
      retryBeforeReconciliation: false
    });
    await expect(store.reconcileAcceptance(input)).resolves.toBe("duplicate");
  });

  it("rejects stale or future receipts before touching the store", async () => {
    const store = new InMemoryTrustedIngressStore();
    await expect(
      acceptTrustedDelivery(
        store,
        delivery("delivery-stale", "1".repeat(64), {
          receivedAtMs: 1_000,
          nowMs: 1_000 + TA3_MAX_REPLAY_AGE_MS + 1
        })
      )
    ).resolves.toMatchObject({ outcome: "invalid", accepted: false });
    expect(store.inspect().storeCalls).toBe(0);
  });

  it("reclaims crashed work and fences an old generation", async () => {
    const store = new InMemoryTrustedIngressStore();
    const first = delivery("delivery-1", "1".repeat(64));
    await acceptTrustedDelivery(store, first);

    expect(store.lease("delivery-1", 2_000, 100)).toMatchObject({
      outcome: "leased",
      attempt: 1
    });
    expect(store.lease("delivery-1", 2_100, 100)).toMatchObject({
      outcome: "reclaimed",
      attempt: 2
    });
    const prepared = store.prepare("delivery-1", 2_100);
    expect(prepared).toMatchObject({ outcome: "prepared", generation: 1 });

    await acceptTrustedDelivery(
      store,
      delivery("delivery-3", "3".repeat(64), {
        binding: binding({ policySha256: "4".repeat(64) })
      })
    );
    expect(store.commit("delivery-1", 1, "5".repeat(64), 2_200)).toMatchObject({
      outcome: "stale"
    });
    expect(store.inspect()).toMatchObject({ currentGeneration: 2, successfulCommits: 0 });
  });

  it("adopts exactly one matching provider result before publishing success", async () => {
    const gate = new TrustedIngressModeController("required", "a".repeat(64));
    const store = new InMemoryTrustedIngressStore({ publicationGate: gate });
    const input = delivery("delivery-1", "1".repeat(64));
    const accepted = await acceptTrustedDelivery(store, input);
    store.lease("delivery-1", 2_000, 100);
    const prepared = store.prepare("delivery-1", 2_000);
    if (
      prepared.outcome !== "prepared" ||
      prepared.externalId === undefined ||
      prepared.generation === undefined ||
      accepted.generation === undefined
    ) {
      throw new Error("test setup did not prepare a receipt");
    }
    const expected = checkRun({ externalId: prepared.externalId });

    expect(store.reconcileCheckRun("delivery-1", [expected])).toBe("adopted");
    expect(store.completeCheckRun("delivery-1", prepared.generation, "success")).toBe("published");
    expect(store.inspect().successfulPublishes).toBe(1);
    expect(store.inspect()).toMatchObject({ outboxEvents: 1 });
    const outbox = store.nextOutboxEvent();
    expect(outbox).toMatchObject({
      receipt: "delivery-1",
      generation: 1,
      externalId: prepared.externalId
    });
    if (outbox === undefined) {
      throw new Error("test setup did not enqueue an outbox event");
    }
    expect(store.acknowledgeOutbox(outbox.eventId)).toBe("acknowledged");
    expect(store.acknowledgeOutbox(outbox.eventId)).toBe("duplicate");
    expect(store.inspect().outboxPending).toBe(0);
  });

  it("never publishes a success result without an explicit required-mode gate", async () => {
    const store = new InMemoryTrustedIngressStore();
    const input = delivery("delivery-no-gate", "1".repeat(64));
    await acceptTrustedDelivery(store, input);
    store.lease("delivery-no-gate", 2_000, 100);
    const prepared = store.prepare("delivery-no-gate", 2_000);
    if (
      prepared.outcome !== "prepared" ||
      prepared.generation === undefined ||
      prepared.externalId === undefined
    ) {
      throw new Error("test setup did not prepare a receipt");
    }

    expect(
      store.reconcileCheckRun("delivery-no-gate", [checkRun({ externalId: prepared.externalId })])
    ).toBe("adopted");
    expect(store.completeCheckRun("delivery-no-gate", prepared.generation, "success")).toBe(
      "blocked"
    );
    expect(store.inspect().successfulPublishes).toBe(0);
  });

  it("blocks wrong or duplicate provider matches", async () => {
    const store = new InMemoryTrustedIngressStore();
    await acceptTrustedDelivery(store, delivery("delivery-1", "1".repeat(64)));
    store.lease("delivery-1", 2_000, 100);
    const prepared = store.prepare("delivery-1", 2_000);
    if (prepared.outcome !== "prepared" || prepared.externalId === undefined) {
      throw new Error("test setup did not prepare a receipt");
    }

    expect(
      store.reconcileCheckRun("delivery-1", [
        checkRun({ externalId: prepared.externalId, appId: 9002 })
      ])
    ).toBe("provider_ambiguous");
    expect(
      store.reconcileCheckRun("delivery-1", [
        checkRun({ externalId: prepared.externalId }),
        checkRun({ externalId: prepared.externalId })
      ])
    ).toBe("provider_ambiguous");
    expect(store.inspect().successfulPublishes).toBe(0);
  });

  it("does not adopt a provider result before a durable prepare", async () => {
    const store = new InMemoryTrustedIngressStore();
    await acceptTrustedDelivery(store, delivery("delivery-unprepared", "1".repeat(64)));

    expect(
      store.reconcileCheckRun("delivery-unprepared", [
        checkRun({ externalId: "rr1-" + "3".repeat(64) })
      ])
    ).toBe("provider_ambiguous");
  });

  it("rejects a lease whose expiry would overflow the safe integer range", async () => {
    const store = new InMemoryTrustedIngressStore();
    await acceptTrustedDelivery(store, delivery("delivery-1", "1".repeat(64)));

    expect(store.lease("delivery-1", Number.MAX_SAFE_INTEGER, 1)).toMatchObject({
      outcome: "invalid"
    });
  });

  it("treats malformed provider records as ambiguity instead of throwing", async () => {
    const store = new InMemoryTrustedIngressStore();
    await acceptTrustedDelivery(store, delivery("delivery-1", "1".repeat(64)));
    store.lease("delivery-1", 2_000, 100);
    const prepared = store.prepare("delivery-1", 2_000);
    if (prepared.outcome !== "prepared") {
      throw new Error("test setup did not prepare a receipt");
    }

    expect(store.reconcileCheckRun("delivery-1", [null as never])).toBe("provider_ambiguous");
  });

  it("does not accept a different result digest as an idempotent duplicate", async () => {
    const store = new InMemoryTrustedIngressStore();
    await acceptTrustedDelivery(store, delivery("delivery-1", "1".repeat(64)));
    store.lease("delivery-1", 2_000, 100);
    const prepared = store.prepare("delivery-1", 2_000);
    if (prepared.outcome !== "prepared" || prepared.generation === undefined) {
      throw new Error("test setup did not prepare a receipt");
    }

    expect(store.commit("delivery-1", prepared.generation, "5".repeat(64), 2_000)).toMatchObject({
      outcome: "committed"
    });
    expect(store.commit("delivery-1", prepared.generation, "6".repeat(64), 2_000)).toMatchObject({
      outcome: "conflict"
    });
  });

  it("rejects token profile drift and downgrades required mode", () => {
    expect(
      validateInstallationTokenProfile(
        {
          installationId: 8001,
          allowedRepositoryIds: [7001],
          allowedPermissions: {
            metadata: "read",
            contents: "read",
            pull_requests: "read",
            checks: "write"
          }
        },
        {
          installationId: 8001,
          repositoryIds: [7001, 7002],
          permissions: {
            metadata: "read",
            contents: "read",
            pull_requests: "read",
            checks: "write",
            issues: "write"
          }
        }
      )
    ).toBe("profile_mismatch");

    const mode = new TrustedIngressModeController("required", "a".repeat(64));
    expect(mode.observeProfile("b".repeat(64))).toBe("profile_drift");
    expect(mode.currentMode).toBe("advisory");
    expect(mode.canPublishSuccess()).toBe(false);
  });

  it("rejects permission values outside the explicit least-privilege vocabulary", () => {
    expect(
      validateInstallationTokenProfile(
        {
          installationId: 8001,
          allowedRepositoryIds: [7001],
          allowedPermissions: { checks: "admin" }
        },
        {
          installationId: 8001,
          repositoryIds: [7001],
          permissions: { checks: "admin" }
        }
      )
    ).toBe("profile_mismatch");
  });

  it("fails closed for malformed profile, mode, and snapshot boundaries", () => {
    expect(validateInstallationTokenProfile(null, null)).toBe("profile_mismatch");
    expect(
      validateInstallationTokenProfile(
        {
          installationId: 8001,
          allowedRepositoryIds: [],
          allowedPermissions: { checks: "write" }
        },
        {
          installationId: 8001,
          repositoryIds: [],
          permissions: { checks: "write" }
        }
      )
    ).toBe("profile_mismatch");
    expect(() => new TrustedIngressModeController("required", "bad")).toThrow(
      "trusted ingress profile digest is invalid"
    );

    const mode = new TrustedIngressModeController("required", "a".repeat(64));
    expect(mode.observeProfile("a".repeat(64))).toBe("unchanged");
    expect(() => evaluateTrustedSnapshot(null)).toThrow("trusted snapshot input is invalid");
    expect(() => evaluateTrustedSnapshot({ basePolicyBytes: new Uint8Array() })).toThrow(
      "trusted snapshot input is invalid"
    );
    expect(
      validateInstallationTokenProfile(
        {
          installationId: 8001,
          allowedRepositoryIds: [7001],
          allowedPermissions: null
        },
        {
          installationId: 8001,
          repositoryIds: [7001],
          permissions: { checks: "write" }
        }
      )
    ).toBe("profile_mismatch");
    expect(
      validateInstallationTokenProfile(
        {
          installationId: 8001,
          allowedRepositoryIds: [7001],
          allowedPermissions: { checks: "write" }
        },
        {
          installationId: 8001,
          repositoryIds: [7001],
          permissions: { checks: "write" }
        }
      )
    ).toBe("valid");
  });

  it("blocks publication after a configured profile gate downgrades to advisory", async () => {
    const mode = new TrustedIngressModeController("required", "a".repeat(64));
    const store = new InMemoryTrustedIngressStore({ publicationGate: mode });
    await acceptTrustedDelivery(store, delivery("delivery-1", "1".repeat(64)));
    store.lease("delivery-1", 2_000, 100);
    const prepared = store.prepare("delivery-1", 2_000);
    if (
      prepared.outcome !== "prepared" ||
      prepared.generation === undefined ||
      prepared.externalId === undefined
    ) {
      throw new Error("test setup did not prepare a receipt");
    }
    expect(
      store.reconcileCheckRun("delivery-1", [checkRun({ externalId: prepared.externalId })])
    ).toBe("adopted");

    expect(mode.observeProfile("b".repeat(64))).toBe("profile_drift");
    expect(store.completeCheckRun("delivery-1", prepared.generation, "success")).toBe("blocked");
    expect(store.inspect().successfulPublishes).toBe(0);
  });

  it("returns bounded failure outcomes for missing or malformed state operations", async () => {
    const store = new InMemoryTrustedIngressStore();
    expect(store.lease("", -1, 0)).toMatchObject({ outcome: "invalid" });
    expect(store.lease("missing", 0)).toMatchObject({ outcome: "missing" });
    expect(store.prepare("", -1)).toMatchObject({ outcome: "invalid" });
    expect(store.prepare("missing", 0)).toMatchObject({ outcome: "missing" });
    expect(store.commit("", 0, "bad", -1)).toMatchObject({ outcome: "invalid" });
    expect(store.commit("missing", 1, "1".repeat(64), 0)).toMatchObject({ outcome: "missing" });
    expect(store.reconcileCheckRun("", [])).toBe("invalid");
    expect(store.reconcileCheckRun("missing", [])).toBe("missing");
    expect(store.completeCheckRun("", 0, "success")).toBe("invalid");
    expect(store.completeCheckRun("missing", 1, "failure")).toBe("missing");
    expect(store.cleanup(-1)).toMatchObject({ outcome: "invalid" });
    expect(store.nextOutboxEvent()).toBeUndefined();
    expect(store.acknowledgeOutbox("bad")).toBe("invalid");
    expect(store.acknowledgeOutbox("rr1-" + "1".repeat(64))).toBe("missing");

    const failingStore = {
      claim: () => Promise.reject(new Error("unavailable")),
      reconcileAcceptance: () => Promise.resolve("unknown" as const)
    };
    await expect(
      acceptTrustedDelivery(failingStore, delivery("delivery-store-down", "1".repeat(64)))
    ).resolves.toMatchObject({ outcome: "store_error", requiresReconciliation: true });
  });

  it("evaluates only bounded base inputs and exposes no execution operation", () => {
    expect(
      evaluateTrustedSnapshot({
        basePolicyBytes: new TextEncoder().encode("version: 1\nrules: []\n"),
        boundedApiData: new TextEncoder().encode(`repositoryId=7001\nheadSha=${headSha}`)
      })
    ).toMatchObject({ outcome: "evaluated", executedOperations: [] });
  });

  it("retains a delivery tombstone until the replay window expires", async () => {
    const store = new InMemoryTrustedIngressStore();
    await acceptTrustedDelivery(
      store,
      delivery("delivery-1", "1".repeat(64), { receivedAtMs: 0, nowMs: 0 })
    );

    expect(store.cleanup(TA3_MAX_REPLAY_AGE_MS - 1)).toMatchObject({
      outcome: "cleanup_deferred",
      deliveryTombstoneExists: true
    });
    expect(store.hasDeliveryTombstone("delivery-1")).toBe(true);
  });

  it("cleans expired body bytes while retaining the delivery tombstone", async () => {
    const store = new InMemoryTrustedIngressStore();
    await acceptTrustedDelivery(
      store,
      delivery("delivery-expired", "1".repeat(64), { receivedAtMs: 0, nowMs: 0 })
    );

    expect(store.cleanup(TA3_MAX_REPLAY_AGE_MS)).toMatchObject({ outcome: "cleaned" });
    expect(store.cleanup(TA3_MAX_REPLAY_AGE_MS + 1)).toMatchObject({
      outcome: "cleanup_deferred",
      deliveryTombstoneExists: true
    });
    expect(store.hasDeliveryTombstone("")).toBe(false);
    expect(store.hasDeliveryTombstone("missing-delivery")).toBe(false);
    expect(store.hasDeliveryTombstone("delivery-expired")).toBe(true);
  });

  it("rejects traversal policy paths before any durable claim", async () => {
    const store = new InMemoryTrustedIngressStore();
    await expect(
      acceptTrustedDelivery(
        store,
        delivery("delivery-traversal", "1".repeat(64), {
          binding: binding({ policyPath: "../untrusted.yml" })
        })
      )
    ).resolves.toMatchObject({ outcome: "invalid", accepted: false });
    expect(store.inspect().storeCalls).toBe(0);
  });

  it("rejects a forged durable receipt instead of trusting caller digests", async () => {
    const store = new InMemoryTrustedIngressStore();
    const input = delivery("delivery-forged", "1".repeat(64));
    const forged = {
      ...input,
      bindingDigest: "0".repeat(64),
      expiresAtMs: input.receivedAtMs + TA3_MAX_REPLAY_AGE_MS
    };

    await expect(store.claim(forged)).resolves.toMatchObject({ outcome: "unknown" });
    expect(store.inspect().storeCalls).toBe(0);
  });

  it("turns an invalid store response into unresolved failure", async () => {
    const store = {
      claim: () => Promise.resolve({ outcome: "accepted" } as never),
      reconcileAcceptance: () => Promise.resolve("unknown" as const)
    };

    await expect(
      acceptTrustedDelivery(store, delivery("delivery-invalid-store", "1".repeat(64)))
    ).resolves.toMatchObject({
      outcome: "store_error",
      callerKnowledge: "unresolved",
      requiresReconciliation: true
    });
  });

  it("does not extend a live lease or exceed the bounded retry count", async () => {
    const store = new InMemoryTrustedIngressStore();
    await acceptTrustedDelivery(store, delivery("delivery-lease", "1".repeat(64)));

    expect(store.lease("delivery-lease", 2_000, 100)).toMatchObject({
      outcome: "leased",
      attempt: 1
    });
    expect(store.lease("delivery-lease", 2_050, 100)).toMatchObject({
      outcome: "busy",
      attempt: 1
    });
    expect(store.lease("delivery-lease", 2_100, 100)).toMatchObject({
      outcome: "reclaimed",
      attempt: 2
    });
    expect(store.lease("delivery-lease", 2_200, 100)).toMatchObject({
      outcome: "reclaimed",
      attempt: 3
    });
    expect(store.lease("delivery-lease", 2_300, 100)).toMatchObject({
      outcome: "exhausted",
      attempt: 3
    });
  });

  it("rejects oversized trusted snapshot bytes without invoking any evaluator", () => {
    expect(() =>
      evaluateTrustedSnapshot({
        basePolicyBytes: new Uint8Array(TA3_MAX_BODY_BYTES + 1),
        boundedApiData: new Uint8Array()
      })
    ).toThrow("trusted snapshot input is invalid");
  });

  it("derives a stable binding digest from the trusted authority fields", () => {
    expect(deriveBindingDigest(binding())).toBe(deriveBindingDigest(binding()));
    expect(deriveBindingDigest(binding())).not.toBe(
      deriveBindingDigest(binding({ policySha256: "4".repeat(64) }))
    );
  });
});
