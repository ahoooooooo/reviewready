import { createHmac, timingSafeEqual } from "node:crypto";

export const MAX_WEBHOOK_BODY_BYTES = 1_048_576;
export const MAX_WEBHOOK_SECRET_BYTES = 4_096;
export const MAX_WEBHOOK_SIGNATURE_LENGTH = "sha256=".length + 64;
export const MAX_DELIVERY_ID_LENGTH = 256;
export const MAX_REPLAY_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
export const MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;

const SHA256_SIGNATURE = /^sha256=([0-9a-f]{64})$/iu;
const DELIVERY_ID = /^[\x21-\x7e]+$/u;

export function verifyWebhookSignature(
  rawBody: Uint8Array,
  signature: string,
  secret: string
): boolean {
  if (
    !(rawBody instanceof Uint8Array) ||
    typeof signature !== "string" ||
    typeof secret !== "string"
  ) {
    return false;
  }
  if (rawBody.byteLength > MAX_WEBHOOK_BODY_BYTES) {
    return false;
  }
  if (signature.length !== MAX_WEBHOOK_SIGNATURE_LENGTH) {
    return false;
  }
  if (secret.length > MAX_WEBHOOK_SECRET_BYTES) {
    return false;
  }
  const secretBytes = Buffer.from(secret, "utf8");
  if (secretBytes.length === 0 || secretBytes.length > MAX_WEBHOOK_SECRET_BYTES) {
    return false;
  }
  const match = SHA256_SIGNATURE.exec(signature);
  if (match?.[1] === undefined) {
    return false;
  }

  const expected = createHmac("sha256", secretBytes).update(rawBody).digest();
  const provided = Buffer.from(match[1], "hex");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export interface ReplayStore {
  claim: (deliveryId: string, expiresAtMs: number) => Promise<boolean>;
}

export interface WebhookDeliveryInput {
  readonly deliveryId: string;
  readonly createdAtMs: number;
  readonly nowMs: number;
  readonly maxAgeMs: number;
  readonly maxFutureSkewMs: number;
}

export type WebhookDeliveryReason =
  "accepted" | "duplicate" | "stale" | "future" | "invalid" | "store_error";

export interface WebhookDeliveryResult {
  readonly accepted: boolean;
  readonly reason: WebhookDeliveryReason;
}

function validTiming(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export async function acceptWebhookDelivery(
  input: WebhookDeliveryInput,
  store: ReplayStore
): Promise<WebhookDeliveryResult> {
  if (
    !isRecord(input) ||
    typeof input.deliveryId !== "string" ||
    input.deliveryId.length === 0 ||
    input.deliveryId.length > MAX_DELIVERY_ID_LENGTH ||
    !DELIVERY_ID.test(input.deliveryId) ||
    !validTiming(input.createdAtMs) ||
    !validTiming(input.nowMs) ||
    !Number.isSafeInteger(input.maxAgeMs) ||
    input.maxAgeMs <= 0 ||
    input.maxAgeMs > MAX_REPLAY_AGE_MS ||
    !Number.isSafeInteger(input.maxFutureSkewMs) ||
    input.maxFutureSkewMs < 0 ||
    input.maxFutureSkewMs > MAX_FUTURE_SKEW_MS
  ) {
    return { accepted: false, reason: "invalid" };
  }
  if (input.nowMs - input.createdAtMs > input.maxAgeMs) {
    return { accepted: false, reason: "stale" };
  }
  if (input.createdAtMs - input.nowMs > input.maxFutureSkewMs) {
    return { accepted: false, reason: "future" };
  }

  const expiresAtMs = input.createdAtMs + input.maxAgeMs;
  if (!Number.isSafeInteger(expiresAtMs)) {
    return { accepted: false, reason: "invalid" };
  }

  try {
    const claimed: unknown = await store.claim(input.deliveryId, expiresAtMs);
    if (claimed === true) {
      return { accepted: true, reason: "accepted" };
    }
    if (claimed === false) {
      return { accepted: false, reason: "duplicate" };
    }
    return { accepted: false, reason: "store_error" };
  } catch {
    return { accepted: false, reason: "store_error" };
  }
}

export interface EvaluationBinding {
  readonly deliveryId: string;
  readonly pullNumber: number;
  readonly baseSha: string;
  readonly headSha: string;
  readonly policyPath: string;
  readonly policySha: string;
  readonly policySha256?: string | undefined;
  readonly trustedWorkflowRef: string;
  readonly freshness: string;
  readonly evidenceFingerprint: string;
  readonly repositoryId?: number | undefined;
  readonly installationId?: number | undefined;
  readonly action?: string | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function bindingMatches(expected: EvaluationBinding, actual: unknown): boolean {
  if (!isRecord(actual)) {
    return false;
  }
  return (
    actual.deliveryId === expected.deliveryId &&
    actual.pullNumber === expected.pullNumber &&
    actual.baseSha === expected.baseSha &&
    actual.headSha === expected.headSha &&
    actual.policyPath === expected.policyPath &&
    actual.policySha === expected.policySha &&
    (expected.policySha256 === undefined || actual.policySha256 === expected.policySha256) &&
    actual.trustedWorkflowRef === expected.trustedWorkflowRef &&
    actual.freshness === expected.freshness &&
    actual.evidenceFingerprint === expected.evidenceFingerprint &&
    (expected.repositoryId === undefined || actual.repositoryId === expected.repositoryId) &&
    (expected.installationId === undefined || actual.installationId === expected.installationId) &&
    (expected.action === undefined || actual.action === expected.action)
  );
}
