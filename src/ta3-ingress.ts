import { createHash } from "node:crypto";

import {
  TA3_DEFAULT_LEASE_MS,
  TA3_MAX_ATTEMPTS,
  TA3_MAX_BODY_BYTES,
  TA3_MAX_LEASE_MS,
  TA3_MAX_PROVIDER_MATCHES,
  TA3_MAX_REPLAY_AGE_MS,
  TA3_TOMBSTONE_RETENTION_MS,
  type AcceptFault,
  type InMemoryTrustedIngressStoreOptions,
  type InstallationTokenValidation,
  type ProviderCheckRun,
  type ProviderCompletionOutcome,
  type ProviderReconciliationOutcome,
  type TrustedAcceptanceOutcome,
  type TrustedAcceptanceReconciliation,
  type TrustedAcceptanceResult,
  type TrustedCommitOutcome,
  type TrustedDelivery,
  type TrustedGitHubWebhookConfig,
  type TrustedIngressBinding,
  type TrustedIngressInspection,
  type TrustedIngressMode,
  type TrustedIngressStore,
  type TrustedLeaseResult,
  type TrustedOutboxAcknowledgement,
  type TrustedOutboxEvent,
  type TrustedPrepareResult,
  type TrustedPublicationGate,
  type TrustedSnapshotInput,
  type TrustedSnapshotResult,
  type TrustedStoreClaim,
  type TrustedStoreReceipt
} from "./ta3-ingress-contracts.js";
import { MAX_FUTURE_SKEW_MS } from "./trust.js";
import {
  MAX_WEBHOOK_ALLOWLIST_IDS,
  receiveGitHubWebhook,
  type DurableWebhookStore,
  type GitHubWebhookRequest,
  type WebhookIngressResult
} from "./webhook.js";

export * from "./ta3-ingress-contracts.js";

/**
 * Provider-neutral TA-3 ingress contracts and deterministic reference state.
 * InMemoryTrustedIngressStore is a test/reference implementation only; it is
 * not a production durability claim or a live GitHub enforcement mechanism.
 */

const SHA256 = /^[0-9a-f]{64}$/u;
const DELIVERY_ID = /^[\x21-\x7e]+$/u;
const PRINTABLE = /^[\x20-\x7e]+$/u;
const MAX_TEXT_LENGTH = 512;

function isTrustedIdAllowlist(value: unknown): value is readonly number[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_WEBHOOK_ALLOWLIST_IDS) {
    return false;
  }
  const seen = new Set<number>();
  for (const entry of value) {
    if (!isSafePositiveInteger(entry) || seen.has(entry)) {
      return false;
    }
    seen.add(entry);
  }
  return true;
}

export function isTrustedGitHubWebhookConfig(value: unknown): value is TrustedGitHubWebhookConfig {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isSafePositiveInteger(value.appId) &&
    typeof value.webhookSecret === "string" &&
    value.webhookSecret.length > 0 &&
    isBoundedText(value.hookId) &&
    isTrustedIdAllowlist(value.allowedInstallationIds) &&
    isTrustedIdAllowlist(value.allowedRepositoryIds)
  );
}

export async function receiveTrustedGitHubWebhook(
  request: GitHubWebhookRequest,
  config: unknown,
  store: DurableWebhookStore
): Promise<WebhookIngressResult> {
  if (!isTrustedGitHubWebhookConfig(config)) {
    return { accepted: false, reason: "invalid" };
  }
  return receiveGitHubWebhook(request, config, store);
}

interface ReceiptEntry {
  readonly receipt: string;
  readonly bodySha256: string;
  readonly binding: TrustedIngressBinding;
  readonly bindingDigest: string;
  readonly receivedAtMs: number;
  readonly expiresAtMs: number;
  readonly generation: number;
  readonly deliveryIds: Set<string>;
  bodyRetained: boolean;
  attempts: number;
  leaseUntilMs: number | undefined;
  state: "accepted" | "processing" | "prepared" | "provider_adopted" | "committed" | "published";
  externalId: string | undefined;
  resultDigest: string | undefined;
  providerAdopted: boolean;
  outboxEnqueued: boolean;
}

interface GenerationSlot {
  readonly generation: number;
  readonly receipt: string;
}

interface OutboxRecord {
  readonly event: TrustedOutboxEvent;
  acknowledged: boolean;
}

function isSafePositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isSafeTime(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isBoundedText(value: unknown, max = MAX_TEXT_LENGTH): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    PRINTABLE.test(value) &&
    !value.includes("\0")
  );
}

function isSha(value: unknown, length: 40 | 64): value is string {
  return typeof value === "string" && value.length === length && /^[0-9a-f]+$/u.test(value);
}

function isPolicyPath(value: unknown): value is string {
  if (!isBoundedText(value)) {
    return false;
  }
  if (value.startsWith("/") || value.includes("\\")) {
    return false;
  }
  return value
    .split("/")
    .every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function isBinding(value: unknown): value is TrustedIngressBinding {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    isSafePositiveInteger(candidate.appId) &&
    isBoundedText(candidate.hookId) &&
    isSafePositiveInteger(candidate.installationId) &&
    isSafePositiveInteger(candidate.repositoryId) &&
    isSafePositiveInteger(candidate.baseRepositoryId) &&
    isSafePositiveInteger(candidate.headRepositoryId) &&
    isSafePositiveInteger(candidate.repositoryOwnerId) &&
    candidate.baseRepositoryId === candidate.repositoryId &&
    (candidate.repositoryOwnerType === "User" ||
      candidate.repositoryOwnerType === "Organization") &&
    isBoundedText(candidate.repositoryOwnerLogin, 256) &&
    isSafePositiveInteger(candidate.pullNumber) &&
    isSha(candidate.baseSha, 40) &&
    isSha(candidate.headSha, 40) &&
    isPolicyPath(candidate.policyPath) &&
    isSha(candidate.policySha256, 64) &&
    isSha(candidate.rootDigest, 64) &&
    isBoundedText(candidate.checkName)
  );
}

function canonicalBinding(binding: TrustedIngressBinding): string {
  return JSON.stringify([
    binding.appId,
    binding.hookId,
    binding.installationId,
    binding.repositoryId,
    binding.baseRepositoryId,
    binding.headRepositoryId,
    binding.repositoryOwnerId,
    binding.repositoryOwnerType,
    binding.repositoryOwnerLogin,
    binding.pullNumber,
    binding.baseSha,
    binding.headSha,
    binding.policyPath,
    binding.policySha256,
    binding.rootDigest,
    binding.checkName
  ]);
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function deriveBindingDigest(binding: TrustedIngressBinding): string {
  if (!isBinding(binding)) {
    throw new Error("trusted ingress binding is invalid");
  }
  return digest(canonicalBinding(binding));
}

function namespace(binding: TrustedIngressBinding): string {
  return JSON.stringify([
    binding.appId,
    binding.hookId,
    binding.installationId,
    binding.repositoryId
  ]);
}

function deliveryKey(binding: TrustedIngressBinding, deliveryId: string): string {
  return JSON.stringify([namespace(binding), deliveryId]);
}

function bodyKey(binding: TrustedIngressBinding, bodySha256: string): string {
  return JSON.stringify([namespace(binding), bodySha256]);
}

function slotKey(binding: TrustedIngressBinding): string {
  return JSON.stringify([
    namespace(binding),
    binding.repositoryId,
    binding.pullNumber,
    binding.checkName
  ]);
}

function normalizeDelivery(input: unknown): TrustedStoreReceipt | undefined {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return undefined;
  }
  const candidate = input as Record<string, unknown>;
  if (
    typeof candidate.deliveryId !== "string" ||
    candidate.deliveryId.length === 0 ||
    candidate.deliveryId.length > 256 ||
    !DELIVERY_ID.test(candidate.deliveryId) ||
    !isSha(candidate.bodySha256, 64) ||
    !isBinding(candidate.binding) ||
    !isSafeTime(candidate.receivedAtMs) ||
    !isSafeTime(candidate.nowMs)
  ) {
    return undefined;
  }
  const receivedAtMs = candidate.receivedAtMs;
  const nowMs = candidate.nowMs;
  if (nowMs - receivedAtMs > TA3_MAX_REPLAY_AGE_MS || receivedAtMs - nowMs > MAX_FUTURE_SKEW_MS) {
    return undefined;
  }
  const expiresAtMs = receivedAtMs + TA3_MAX_REPLAY_AGE_MS;
  if (!Number.isSafeInteger(expiresAtMs)) {
    return undefined;
  }
  const binding = candidate.binding;
  return {
    deliveryId: candidate.deliveryId,
    bodySha256: candidate.bodySha256,
    binding,
    receivedAtMs,
    nowMs,
    bindingDigest: deriveBindingDigest(binding),
    expiresAtMs
  };
}

function result(
  outcome: TrustedAcceptanceOutcome,
  extras: Pick<TrustedAcceptanceResult, "generation" | "canonicalReceipt"> = {}
): TrustedAcceptanceResult {
  const unresolved = outcome === "store_error";
  return {
    accepted: outcome === "accepted",
    outcome,
    callerKnowledge: unresolved ? "unresolved" : "known",
    requiresReconciliation: unresolved,
    retryBeforeReconciliation: false,
    ...extras
  };
}

export async function acceptTrustedDelivery(
  store: TrustedIngressStore,
  input: TrustedDelivery
): Promise<TrustedAcceptanceResult> {
  const receipt = normalizeDelivery(input);
  if (receipt === undefined) {
    return result("invalid");
  }
  let claimed: unknown;
  try {
    claimed = await store.claim(receipt);
  } catch {
    return result("store_error");
  }
  if (!isTrustedStoreClaim(claimed)) {
    return result("store_error");
  }
  switch (claimed.outcome) {
    case "new":
      return result("accepted", claimExtras(claimed));
    case "duplicate":
      return result("duplicate", claimExtras(claimed));
    case "conflict":
      return result("conflict", claimExtras(claimed));
    default:
      return result("store_error");
  }
}

function claimExtras(
  claim: TrustedStoreClaim
): Pick<TrustedAcceptanceResult, "generation" | "canonicalReceipt"> {
  const extras: { generation?: number; canonicalReceipt?: string } = {};
  if (claim.generation !== undefined) {
    extras.generation = claim.generation;
  }
  if (claim.canonicalReceipt !== undefined) {
    extras.canonicalReceipt = claim.canonicalReceipt;
  }
  return extras;
}

function isTrustedStoreClaim(value: unknown): value is TrustedStoreClaim {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.outcome === "new" ||
      candidate.outcome === "duplicate" ||
      candidate.outcome === "conflict" ||
      candidate.outcome === "unknown") &&
    (candidate.generation === undefined || isSafePositiveInteger(candidate.generation)) &&
    (candidate.canonicalReceipt === undefined || isBoundedText(candidate.canonicalReceipt, 256))
  );
}

export class InMemoryTrustedIngressStore implements TrustedIngressStore {
  private readonly deliveries = new Map<string, string>();
  private readonly bodies = new Map<string, string>();
  private readonly records = new Map<string, ReceiptEntry>();
  private readonly slots = new Map<string, GenerationSlot>();
  private readonly outbox = new Map<string, OutboxRecord>();
  private readonly publicationGate: TrustedPublicationGate | undefined;
  private acceptFault: AcceptFault;
  private storeCalls = 0;
  private deliveryClaims = 0;
  private bodyClaims = 0;
  private deliveryAliases = 0;
  private evaluationCount = 0;
  private successfulCommits = 0;
  private successfulPublishes = 0;
  private outboxEvents = 0;

  public constructor(options: InMemoryTrustedIngressStoreOptions = {}) {
    this.acceptFault = options.acceptFault ?? "none";
    this.publicationGate = options.publicationGate;
  }

  public setAcceptFault(fault: AcceptFault): void {
    this.acceptFault = fault;
  }

  public async claim(receipt: TrustedStoreReceipt): Promise<TrustedStoreClaim> {
    await Promise.resolve();
    const normalized = normalizeDelivery(receipt);
    if (
      normalized === undefined ||
      normalized.bindingDigest !== receipt.bindingDigest ||
      normalized.expiresAtMs !== receipt.expiresAtMs
    ) {
      return { outcome: "unknown" };
    }
    this.storeCalls += 1;
    const fault = this.acceptFault;
    this.acceptFault = "none";
    if (fault === "unknown-before-commit") {
      return { outcome: "unknown" };
    }
    const claim = this.claimKnown(normalized);
    return fault === "unknown-after-commit" ? { outcome: "unknown" } : claim;
  }

  private claimKnown(receipt: TrustedStoreReceipt): TrustedStoreClaim {
    const dKey = deliveryKey(receipt.binding, receipt.deliveryId);
    const existingReceipt = this.deliveries.get(dKey);
    if (existingReceipt !== undefined) {
      const existing = this.records.get(existingReceipt);
      if (existing === undefined) {
        return { outcome: "unknown" };
      }
      const same =
        existing.bodySha256 === receipt.bodySha256 &&
        existing.bindingDigest === receipt.bindingDigest;
      return {
        outcome: same ? "duplicate" : "conflict",
        generation: existing.generation,
        canonicalReceipt: existing.receipt
      };
    }

    const bKey = bodyKey(receipt.binding, receipt.bodySha256);
    const existingBodyReceipt = this.bodies.get(bKey);
    if (existingBodyReceipt !== undefined) {
      const existing = this.records.get(existingBodyReceipt);
      if (existing === undefined) {
        return { outcome: "unknown" };
      }
      if (existing.bindingDigest !== receipt.bindingDigest) {
        return {
          outcome: "conflict",
          generation: existing.generation,
          canonicalReceipt: existing.receipt
        };
      }
      this.deliveries.set(dKey, existing.receipt);
      existing.deliveryIds.add(receipt.deliveryId);
      this.deliveryAliases += 1;
      return {
        outcome: "duplicate",
        generation: existing.generation,
        canonicalReceipt: existing.receipt
      };
    }

    const sKey = slotKey(receipt.binding);
    const previous = this.slots.get(sKey);
    const generation = (previous?.generation ?? 0) + 1;
    const entry: ReceiptEntry = {
      receipt: receipt.deliveryId,
      bodySha256: receipt.bodySha256,
      binding: receipt.binding,
      bindingDigest: receipt.bindingDigest,
      receivedAtMs: receipt.receivedAtMs,
      expiresAtMs: receipt.expiresAtMs,
      generation,
      deliveryIds: new Set([receipt.deliveryId]),
      bodyRetained: true,
      attempts: 0,
      leaseUntilMs: undefined,
      state: "accepted",
      externalId: undefined,
      resultDigest: undefined,
      providerAdopted: false,
      outboxEnqueued: false
    };
    this.records.set(entry.receipt, entry);
    this.deliveries.set(dKey, entry.receipt);
    this.bodies.set(bKey, entry.receipt);
    this.slots.set(sKey, { generation, receipt: entry.receipt });
    this.deliveryClaims += 1;
    this.bodyClaims += 1;
    this.evaluationCount += 1;
    return { outcome: "new", generation, canonicalReceipt: entry.receipt };
  }

  public async reconcileAcceptance(
    input: TrustedDelivery
  ): Promise<TrustedAcceptanceReconciliation> {
    await Promise.resolve();
    const receipt = normalizeDelivery(input);
    if (receipt === undefined) {
      return "unknown";
    }
    const existingReceipt = this.deliveries.get(deliveryKey(receipt.binding, receipt.deliveryId));
    if (existingReceipt !== undefined) {
      const existing = this.records.get(existingReceipt);
      if (existing === undefined) {
        return "unknown";
      }
      return existing.bodySha256 === receipt.bodySha256 &&
        existing.bindingDigest === receipt.bindingDigest
        ? "duplicate"
        : "conflict";
    }
    const existingBody = this.bodies.get(bodyKey(receipt.binding, receipt.bodySha256));
    if (existingBody === undefined) {
      return "missing";
    }
    const existing = this.records.get(existingBody);
    return existing?.bindingDigest === receipt.bindingDigest ? "duplicate" : "conflict";
  }

  public lease(receipt: string, nowMs: number, leaseMs = TA3_DEFAULT_LEASE_MS): TrustedLeaseResult {
    if (
      !isBoundedText(receipt, 256) ||
      !isSafeTime(nowMs) ||
      !Number.isSafeInteger(leaseMs) ||
      leaseMs <= 0 ||
      leaseMs > TA3_MAX_LEASE_MS
    ) {
      return { outcome: "invalid" };
    }
    const entry = this.records.get(receipt);
    if (entry === undefined) {
      return { outcome: "missing" };
    }
    if (!this.isCurrent(entry)) {
      return { outcome: "stale" };
    }
    if (entry.state === "published") {
      return { outcome: "busy" };
    }
    if (entry.attempts >= TA3_MAX_ATTEMPTS) {
      return { outcome: "exhausted", attempt: entry.attempts };
    }
    if (entry.leaseUntilMs !== undefined && entry.leaseUntilMs > nowMs) {
      return { outcome: "busy", attempt: entry.attempts };
    }
    const leaseUntilMs = nowMs + leaseMs;
    if (!Number.isSafeInteger(leaseUntilMs)) {
      return { outcome: "invalid" };
    }
    const reclaimed = entry.attempts > 0;
    entry.attempts += 1;
    entry.leaseUntilMs = leaseUntilMs;
    entry.state = "processing";
    return { outcome: reclaimed ? "reclaimed" : "leased", attempt: entry.attempts };
  }

  public prepare(receipt: string, nowMs: number, attempt: number): TrustedPrepareResult {
    if (!isBoundedText(receipt, 256) || !isSafeTime(nowMs) || !isSafePositiveInteger(attempt)) {
      return { outcome: "invalid" };
    }
    const entry = this.records.get(receipt);
    if (entry === undefined) {
      return { outcome: "missing" };
    }
    if (!this.isCurrent(entry)) {
      return { outcome: "stale" };
    }
    if (entry.state === "prepared" || entry.state === "provider_adopted") {
      return {
        outcome: "prepared",
        generation: entry.generation,
        ...(entry.externalId === undefined ? {} : { externalId: entry.externalId })
      };
    }
    if (
      entry.state !== "processing" ||
      entry.leaseUntilMs === undefined ||
      entry.leaseUntilMs <= nowMs
    ) {
      return { outcome: "busy" };
    }
    if (entry.attempts !== attempt) {
      return { outcome: "stale" };
    }
    entry.externalId = deriveExternalId(entry.bindingDigest, entry.generation);
    entry.outboxEnqueued = true;
    this.outbox.set(entry.externalId, {
      event: {
        eventId: entry.externalId,
        receipt: entry.receipt,
        generation: entry.generation,
        externalId: entry.externalId
      },
      acknowledged: false
    });
    this.outboxEvents += 1;
    entry.state = "prepared";
    return { outcome: "prepared", generation: entry.generation, externalId: entry.externalId };
  }

  public commit(
    receipt: string,
    generation: number,
    resultDigest: string,
    nowMs: number,
    attempt: number
  ): { readonly outcome: TrustedCommitOutcome } {
    if (
      !isBoundedText(receipt, 256) ||
      !isSafePositiveInteger(generation) ||
      !isSha(resultDigest, 64) ||
      !isSafeTime(nowMs) ||
      !isSafePositiveInteger(attempt)
    ) {
      return { outcome: "invalid" };
    }
    const entry = this.records.get(receipt);
    if (entry === undefined) {
      return { outcome: "missing" };
    }
    if (entry.generation !== generation || !this.isCurrent(entry)) {
      return { outcome: "stale" };
    }
    if (entry.state === "committed" || entry.state === "published") {
      return entry.resultDigest === resultDigest
        ? { outcome: "duplicate" }
        : { outcome: "conflict" };
    }
    if (entry.attempts !== attempt) {
      return { outcome: "stale" };
    }
    if (entry.state !== "prepared" && entry.state !== "provider_adopted") {
      return { outcome: "not_ready" };
    }
    entry.resultDigest = resultDigest;
    entry.state = "committed";
    this.successfulCommits += 1;
    return { outcome: "committed" };
  }

  public reconcileCheckRun(
    receipt: string,
    matches: readonly ProviderCheckRun[]
  ): ProviderReconciliationOutcome {
    if (!isBoundedText(receipt, 256) || !isProviderCheckRunList(matches)) {
      return "invalid";
    }
    const entry = this.records.get(receipt);
    if (entry === undefined) {
      return "missing";
    }
    if (!this.isCurrent(entry)) {
      return "stale";
    }
    if (matches.length === 0) {
      return "missing";
    }
    if (matches.length > TA3_MAX_PROVIDER_MATCHES) {
      return "provider_ambiguous";
    }
    const candidate: unknown = matches[0];
    if (candidate === undefined || !providerCheckMatches(candidate, expectedCheckRun(entry))) {
      return "provider_ambiguous";
    }
    entry.providerAdopted = true;
    if (entry.state !== "committed" && entry.state !== "published") {
      entry.state = "provider_adopted";
    }
    return "adopted";
  }

  public completeCheckRun(
    receipt: string,
    generation: number,
    conclusion: "success" | "failure" | "neutral"
  ): ProviderCompletionOutcome {
    if (!isBoundedText(receipt, 256) || !isSafePositiveInteger(generation)) {
      return "invalid";
    }
    const entry = this.records.get(receipt);
    if (entry === undefined) {
      return "missing";
    }
    if (entry.generation !== generation || !this.isCurrent(entry)) {
      return "stale";
    }
    if (conclusion !== "success" || !entry.providerAdopted) {
      return "blocked";
    }
    if (entry.state === "published") {
      return "published";
    }
    if (entry.state !== "committed") {
      return "blocked";
    }
    if (this.publicationGate === undefined || !this.publicationGate.canPublishSuccess()) {
      return "blocked";
    }
    entry.state = "published";
    this.successfulPublishes += 1;
    return "published";
  }

  public cleanup(nowMs: number): {
    readonly outcome: "cleanup_deferred" | "cleaned" | "invalid";
    readonly deliveryTombstoneExists: boolean;
  } {
    if (!isSafeTime(nowMs)) {
      return { outcome: "invalid", deliveryTombstoneExists: false };
    }
    let cleaned = 0;
    for (const entry of [...this.records.values()]) {
      if (entry.bodyRetained && entry.expiresAtMs <= nowMs) {
        entry.bodyRetained = false;
        cleaned += 1;
      }
      if (
        nowMs >= entry.receivedAtMs &&
        nowMs - entry.receivedAtMs >= TA3_TOMBSTONE_RETENTION_MS &&
        this.canPurge(entry)
      ) {
        this.purge(entry);
        cleaned += 1;
      }
    }
    return {
      outcome: cleaned > 0 ? "cleaned" : "cleanup_deferred",
      deliveryTombstoneExists: this.records.size > 0
    };
  }

  public hasDeliveryTombstone(deliveryId: string): boolean {
    if (!isBoundedText(deliveryId, 256)) {
      return false;
    }
    for (const entry of this.records.values()) {
      if (entry.deliveryIds.has(deliveryId)) {
        return true;
      }
    }
    return false;
  }

  public nextOutboxEvent(): TrustedOutboxEvent | undefined {
    for (const record of this.outbox.values()) {
      if (!record.acknowledged) {
        return record.event;
      }
    }
    return undefined;
  }

  public acknowledgeOutbox(eventId: unknown): TrustedOutboxAcknowledgement {
    if (typeof eventId !== "string" || !/^rr1-[0-9a-f]{64}$/u.test(eventId)) {
      return "invalid";
    }
    const record = this.outbox.get(eventId);
    if (record === undefined) {
      return "missing";
    }
    if (record.acknowledged) {
      return "duplicate";
    }
    record.acknowledged = true;
    return "acknowledged";
  }

  public inspect(): TrustedIngressInspection & { readonly storeCalls: number } {
    let currentGeneration = 0;
    for (const slot of this.slots.values()) {
      currentGeneration = Math.max(currentGeneration, slot.generation);
    }
    return {
      storeCalls: this.storeCalls,
      deliveryClaims: this.deliveryClaims,
      bodyClaims: this.bodyClaims,
      deliveryAliases: this.deliveryAliases,
      evaluationCount: this.evaluationCount,
      currentGeneration,
      successfulCommits: this.successfulCommits,
      successfulPublishes: this.successfulPublishes,
      outboxEvents: this.outboxEvents,
      outboxPending: [...this.outbox.values()].filter((record) => !record.acknowledged).length
    };
  }

  private isCurrent(entry: ReceiptEntry): boolean {
    const slot = this.slots.get(slotKey(entry.binding));
    return slot?.receipt === entry.receipt && slot.generation === entry.generation;
  }

  private canPurge(entry: ReceiptEntry): boolean {
    return (
      entry.externalId === undefined || this.outbox.get(entry.externalId)?.acknowledged === true
    );
  }

  private purge(entry: ReceiptEntry): void {
    for (const deliveryId of entry.deliveryIds) {
      this.deliveries.delete(deliveryKey(entry.binding, deliveryId));
    }
    this.bodies.delete(bodyKey(entry.binding, entry.bodySha256));
    const slot = this.slots.get(slotKey(entry.binding));
    if (slot?.receipt === entry.receipt) {
      this.slots.delete(slotKey(entry.binding));
    }
    if (entry.externalId !== undefined) {
      this.outbox.delete(entry.externalId);
    }
    this.records.delete(entry.receipt);
  }
}

function deriveExternalId(bindingDigest: string, generation: number): string {
  return `rr1-${digest(`${bindingDigest}:${String(generation)}`)}`;
}

function expectedCheckRun(entry: ReceiptEntry): ProviderCheckRun {
  if (entry.externalId === undefined) {
    return {
      appId: entry.binding.appId,
      repositoryId: entry.binding.repositoryId,
      headSha: entry.binding.headSha,
      name: entry.binding.checkName,
      externalId: ""
    };
  }
  return {
    appId: entry.binding.appId,
    repositoryId: entry.binding.repositoryId,
    headSha: entry.binding.headSha,
    name: entry.binding.checkName,
    externalId: entry.externalId
  };
}

function providerCheckMatches(candidate: unknown, expected: ProviderCheckRun): boolean {
  if (!isRecord(candidate)) {
    return false;
  }
  return (
    isSafePositiveInteger(candidate.appId) &&
    isSafePositiveInteger(candidate.repositoryId) &&
    isSha(candidate.headSha, 40) &&
    isBoundedText(candidate.name) &&
    typeof candidate.externalId === "string" &&
    /^rr1-[0-9a-f]{64}$/u.test(candidate.externalId) &&
    candidate.appId === expected.appId &&
    candidate.repositoryId === expected.repositoryId &&
    candidate.headSha === expected.headSha &&
    candidate.name === expected.name &&
    candidate.externalId === expected.externalId
  );
}

function isProviderCheckRunList(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function isPositiveIdList(value: unknown): value is readonly number[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 500 &&
    value.every((entry) => isSafePositiveInteger(entry))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function samePositiveIdSet(left: readonly number[], right: readonly number[]): boolean {
  const uniqueLeft = new Set(left);
  const uniqueRight = new Set(right);
  return (
    uniqueLeft.size === left.length &&
    uniqueRight.size === right.length &&
    left.length === right.length &&
    left.every((id) => uniqueRight.has(id))
  );
}

export function validateInstallationTokenProfile(
  profile: unknown,
  token: unknown
): InstallationTokenValidation {
  if (
    !isRecord(profile) ||
    !isRecord(token) ||
    !isSafePositiveInteger(profile.installationId) ||
    !isSafePositiveInteger(token.installationId) ||
    profile.installationId !== token.installationId ||
    !isPositiveIdList(profile.allowedRepositoryIds) ||
    !isPositiveIdList(token.repositoryIds) ||
    !samePositiveIdSet(profile.allowedRepositoryIds, token.repositoryIds)
  ) {
    return "profile_mismatch";
  }
  const expected = profile.allowedPermissions;
  const actual = token.permissions;
  if (
    !isRecord(expected) ||
    !isRecord(actual) ||
    Object.keys(expected).length !== Object.keys(actual).length
  ) {
    return "profile_mismatch";
  }
  for (const [name, permission] of Object.entries(expected)) {
    if (
      !isBoundedText(name, 128) ||
      (permission !== "read" && permission !== "write") ||
      actual[name] !== permission
    ) {
      return "profile_mismatch";
    }
  }
  return "valid";
}

export class TrustedIngressModeController {
  public currentMode: TrustedIngressMode;
  private readonly expectedProfileDigest: string;

  public constructor(initialMode: unknown, expectedProfileDigest: unknown) {
    if (
      !isTrustedIngressMode(initialMode) ||
      typeof expectedProfileDigest !== "string" ||
      !SHA256.test(expectedProfileDigest)
    ) {
      throw new Error("trusted ingress profile digest is invalid");
    }
    this.currentMode = initialMode;
    this.expectedProfileDigest = expectedProfileDigest;
  }

  public observeProfile(observedProfileDigest: unknown): "unchanged" | "profile_drift" {
    if (
      typeof observedProfileDigest !== "string" ||
      !SHA256.test(observedProfileDigest) ||
      observedProfileDigest !== this.expectedProfileDigest
    ) {
      this.currentMode = "advisory";
      return "profile_drift";
    }
    return "unchanged";
  }

  public canPublishSuccess(): boolean {
    return this.currentMode === "required";
  }
}

function isTrustedIngressMode(value: unknown): value is TrustedIngressMode {
  return value === "disabled" || value === "shadow" || value === "advisory" || value === "required";
}

function isTrustedSnapshotInput(value: unknown): value is TrustedSnapshotInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    candidate.basePolicyBytes instanceof Uint8Array &&
    candidate.boundedApiData instanceof Uint8Array &&
    candidate.basePolicyBytes.byteLength > 0 &&
    candidate.basePolicyBytes.byteLength <= TA3_MAX_BODY_BYTES &&
    candidate.boundedApiData.byteLength <= TA3_MAX_BODY_BYTES
  );
}

export function evaluateTrustedSnapshot(input: unknown): TrustedSnapshotResult {
  if (!isTrustedSnapshotInput(input)) {
    throw new Error("trusted snapshot input is invalid");
  }
  return {
    outcome: "evaluated",
    basePolicySha256: createHash("sha256").update(input.basePolicyBytes).digest("hex"),
    apiDataSha256: createHash("sha256").update(input.boundedApiData).digest("hex"),
    executedOperations: []
  };
}
