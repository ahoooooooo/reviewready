import { createHash } from "node:crypto";

import {
  bindingMatches,
  MAX_FUTURE_SKEW_MS,
  MAX_DELIVERY_ID_LENGTH,
  MAX_REPLAY_AGE_MS,
  verifyWebhookSignature,
  type EvaluationBinding
} from "./trust.js";

export const MAX_WEBHOOK_HEADER_LENGTH = 512;
export const MAX_WEBHOOK_BODY_BYTES = 1_048_576;
export const MAX_WEBHOOK_ALLOWLIST_IDS = 500;

export type WebhookHeaderValue = string | readonly string[];

export interface GitHubWebhookRequest {
  readonly rawBody: Uint8Array;
  readonly headers: Readonly<Record<string, WebhookHeaderValue | undefined>>;
  readonly receivedAtMs: number;
  readonly nowMs: number;
}

export interface GitHubWebhookConfig {
  readonly appId: number;
  readonly webhookSecret: string;
  /** The hook identifier is deployment configuration, not trusted header input. */
  readonly hookId: string;
  /** TA-3 deployments must provide these out-of-band allowlists. */
  readonly allowedInstallationIds?: readonly number[] | undefined;
  readonly allowedRepositoryIds?: readonly number[] | undefined;
}

export interface DurableWebhookRecord {
  readonly key: {
    readonly appId: string;
    readonly hookId: string;
    readonly installationId: number;
    readonly deliveryId: string;
  };
  /** The durable store must atomically claim this body replay namespace as well as key.deliveryId. */
  readonly replayKey: string;
  readonly body: Uint8Array;
  readonly bodySha256: string;
  readonly event: "pull_request" | "pull_request_review";
  readonly action: string;
  readonly repositoryId: number;
  readonly pullNumber: number;
  readonly baseSha: string;
  readonly headSha: string;
  readonly receivedAtMs: number;
  readonly expiresAtMs: number;
}

export interface DurableWebhookStore {
  /** Return duplicate when either the delivery key or replayKey was already claimed. */
  record: (record: DurableWebhookRecord) => Promise<string>;
}

export type WebhookIngressReason =
  "accepted" | "duplicate" | "conflict" | "invalid" | "store_error";

export interface WebhookIngressResult {
  readonly accepted: boolean;
  readonly reason: WebhookIngressReason;
  readonly deliveryId?: string;
  readonly installationId?: number;
  readonly repositoryId?: number;
  readonly pullNumber?: number;
  readonly baseSha?: string;
  readonly headSha?: string;
  readonly action?: string;
}

export interface DurableResultStore {
  commitIfCurrent: (input: {
    readonly repositoryId: number;
    readonly pullNumber: number;
    readonly snapshotVersion: string;
    readonly binding: EvaluationBinding;
    readonly resultDigest: string;
  }) => Promise<string>;
}

export interface EvaluationCommitInput {
  readonly repositoryId: number;
  readonly pullNumber: number;
  readonly snapshotVersion: string;
  readonly expectedBinding: EvaluationBinding;
  readonly binding: unknown;
  readonly resultDigest: string;
}

export type EvaluationCommitResult =
  "committed" | "stale" | "duplicate" | "binding_mismatch" | "store_error";

const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/iu;
const DELIVERY = /^[\x21-\x7e]+$/u;
const EVENT_ACTIONS: Readonly<Record<string, ReadonlySet<string>>> = {
  pull_request: new Set([
    "opened",
    "reopened",
    "synchronize",
    "edited",
    "labeled",
    "unlabeled",
    "ready_for_review",
    "converted_to_draft"
  ]),
  pull_request_review: new Set(["submitted", "edited", "dismissed"])
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : undefined;
}

function validAllowlist(value: unknown): value is readonly number[] | undefined {
  if (value === undefined) {
    return true;
  }
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_WEBHOOK_ALLOWLIST_IDS) {
    return false;
  }
  const seen = new Set<number>();
  for (const entry of value) {
    if (!Number.isSafeInteger(entry) || (entry as number) <= 0 || seen.has(entry as number)) {
      return false;
    }
    seen.add(entry as number);
  }
  return true;
}

function stringValue(value: unknown, max = MAX_WEBHOOK_HEADER_LENGTH): string | undefined {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    !value.includes("\0")
    ? value
    : undefined;
}

function singleHeader(
  headers: Readonly<Record<string, WebhookHeaderValue | undefined>>,
  wanted: string
): string | undefined {
  const values: string[] = [];
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== wanted.toLowerCase()) {
      continue;
    }
    if (Array.isArray(value) || typeof value !== "string") {
      return undefined;
    }
    values.push(value);
  }
  return values.length === 1 ? stringValue(values[0]) : undefined;
}

function sha256(rawBody: Uint8Array): string {
  if (rawBody.byteLength > MAX_WEBHOOK_BODY_BYTES) {
    throw new Error("webhook body exceeds hash limit");
  }
  return createHash("sha256").update(rawBody).digest("hex");
}

function invalid(): WebhookIngressResult {
  return { accepted: false, reason: "invalid" };
}

function metadata(
  result: WebhookIngressResult,
  details: {
    readonly deliveryId: string;
    readonly installationId: number;
    readonly repositoryId: number;
    readonly pullNumber: number;
    readonly baseSha: string;
    readonly headSha: string;
    readonly action: string;
  }
): WebhookIngressResult {
  return { ...result, ...details };
}

export async function receiveGitHubWebhook(
  request: GitHubWebhookRequest,
  config: GitHubWebhookConfig,
  store: DurableWebhookStore
): Promise<WebhookIngressResult> {
  if (
    !isRecord(request) ||
    !isRecord(config) ||
    !isRecord(request.headers) ||
    !(request.rawBody instanceof Uint8Array) ||
    request.rawBody.byteLength > MAX_WEBHOOK_BODY_BYTES ||
    !Number.isSafeInteger(request.receivedAtMs) ||
    request.receivedAtMs < 0 ||
    !Number.isSafeInteger(request.nowMs) ||
    request.nowMs < 0 ||
    !Number.isSafeInteger(config.appId) ||
    config.appId <= 0 ||
    typeof config.webhookSecret !== "string" ||
    stringValue(config.hookId) === undefined ||
    !validAllowlist(config.allowedInstallationIds) ||
    !validAllowlist(config.allowedRepositoryIds)
  ) {
    return invalid();
  }
  const signature = singleHeader(request.headers, "x-hub-signature-256");
  const deliveryId = singleHeader(request.headers, "x-github-delivery");
  const event = singleHeader(request.headers, "x-github-event");
  const hookId = singleHeader(request.headers, "x-github-hook-id");
  if (
    signature === undefined ||
    deliveryId === undefined ||
    hookId === undefined ||
    event === undefined ||
    hookId !== config.hookId ||
    deliveryId.length > MAX_DELIVERY_ID_LENGTH ||
    !DELIVERY.test(deliveryId) ||
    !DELIVERY.test(hookId) ||
    !Object.prototype.hasOwnProperty.call(EVENT_ACTIONS, event) ||
    !verifyWebhookSignature(request.rawBody, signature, config.webhookSecret)
  ) {
    return invalid();
  }

  let payload: unknown;
  try {
    const source = new TextDecoder("utf-8", { fatal: true }).decode(request.rawBody);
    payload = JSON.parse(source) as unknown;
  } catch {
    return invalid();
  }
  if (!isRecord(payload)) {
    return invalid();
  }
  const action = stringValue(payload.action);
  const installation = isRecord(payload.installation)
    ? positiveInteger(payload.installation.id)
    : undefined;
  const repository = isRecord(payload.repository)
    ? positiveInteger(payload.repository.id)
    : undefined;
  const pullRequest = isRecord(payload.pull_request) ? payload.pull_request : undefined;
  const review = isRecord(payload.review) ? payload.review : undefined;
  const base =
    isRecord(pullRequest) && isRecord(pullRequest.base) ? pullRequest.base.sha : undefined;
  const head =
    isRecord(pullRequest) && isRecord(pullRequest.head) ? pullRequest.head.sha : undefined;
  const pullNumber = isRecord(pullRequest) ? positiveInteger(pullRequest.number) : undefined;
  if (
    action === undefined ||
    !Object.prototype.hasOwnProperty.call(EVENT_ACTIONS, event) ||
    !EVENT_ACTIONS[event]?.has(action) ||
    installation === undefined ||
    repository === undefined ||
    pullNumber === undefined ||
    typeof base !== "string" ||
    !SHA.test(base) ||
    typeof head !== "string" ||
    !SHA.test(head)
  ) {
    return invalid();
  }
  if (
    (event === "pull_request_review" && review === undefined) ||
    (event === "pull_request" && review !== undefined)
  ) {
    return invalid();
  }
  if (
    (config.allowedInstallationIds !== undefined &&
      !config.allowedInstallationIds.includes(installation)) ||
    (config.allowedRepositoryIds !== undefined && !config.allowedRepositoryIds.includes(repository))
  ) {
    return invalid();
  }
  if (
    request.nowMs - request.receivedAtMs > MAX_REPLAY_AGE_MS ||
    request.receivedAtMs - request.nowMs > MAX_FUTURE_SKEW_MS
  ) {
    return invalid();
  }

  const expiresAtMs = request.nowMs + MAX_REPLAY_AGE_MS;
  if (!Number.isSafeInteger(expiresAtMs)) {
    return invalid();
  }
  const bodySha256 = sha256(request.rawBody);
  const record: DurableWebhookRecord = {
    key: {
      appId: String(config.appId),
      hookId,
      installationId: installation,
      deliveryId
    },
    replayKey: `${String(config.appId)}:${hookId}:${String(installation)}:${bodySha256}`,
    body: request.rawBody.slice(),
    bodySha256,
    event: event as "pull_request" | "pull_request_review",
    action,
    repositoryId: repository,
    pullNumber,
    baseSha: base,
    headSha: head,
    receivedAtMs: request.receivedAtMs,
    expiresAtMs
  };
  try {
    const claim = await store.record(record);
    if (claim === "new") {
      return metadata({ accepted: true, reason: "accepted" }, recordDetails(record));
    }
    if (claim === "duplicate") {
      return metadata({ accepted: false, reason: "duplicate" }, recordDetails(record));
    }
    return claim === "conflict"
      ? metadata({ accepted: false, reason: "conflict" }, recordDetails(record))
      : metadata({ accepted: false, reason: "store_error" }, recordDetails(record));
  } catch {
    return metadata({ accepted: false, reason: "store_error" }, recordDetails(record));
  }
}

function recordDetails(record: DurableWebhookRecord): {
  readonly deliveryId: string;
  readonly installationId: number;
  readonly repositoryId: number;
  readonly pullNumber: number;
  readonly baseSha: string;
  readonly headSha: string;
  readonly action: string;
} {
  return {
    deliveryId: record.key.deliveryId,
    installationId: record.key.installationId,
    repositoryId: record.repositoryId,
    pullNumber: record.pullNumber,
    baseSha: record.baseSha,
    headSha: record.headSha,
    action: record.action
  };
}

export async function commitEvaluationIfCurrent(
  store: DurableResultStore,
  input: EvaluationCommitInput
): Promise<EvaluationCommitResult> {
  if (
    !isRecord(input) ||
    !Number.isSafeInteger(input.repositoryId) ||
    input.repositoryId <= 0 ||
    !Number.isSafeInteger(input.pullNumber) ||
    input.pullNumber <= 0 ||
    typeof input.snapshotVersion !== "string" ||
    input.snapshotVersion.length === 0 ||
    input.snapshotVersion.length > 512 ||
    typeof input.resultDigest !== "string" ||
    !/^[0-9a-f]{64}$/iu.test(input.resultDigest) ||
    !isRecord(input.expectedBinding) ||
    input.expectedBinding.pullNumber !== input.pullNumber ||
    !Number.isSafeInteger(input.expectedBinding.repositoryId) ||
    input.expectedBinding.repositoryId <= 0 ||
    input.expectedBinding.repositoryId !== input.repositoryId ||
    !bindingMatches(input.expectedBinding, input.binding)
  ) {
    return "binding_mismatch";
  }
  try {
    const result = await store.commitIfCurrent({
      repositoryId: input.repositoryId,
      pullNumber: input.pullNumber,
      snapshotVersion: input.snapshotVersion,
      binding: input.expectedBinding,
      resultDigest: input.resultDigest
    });
    if (result === "committed" || result === "stale" || result === "duplicate") {
      return result;
    }
    return "store_error";
  } catch {
    return "store_error";
  }
}

export function sha256Hex(value: Uint8Array | string): string {
  if (typeof value === "string" && Buffer.byteLength(value, "utf8") > MAX_WEBHOOK_BODY_BYTES) {
    throw new Error("webhook hash input exceeds limit");
  }
  if (value instanceof Uint8Array && value.byteLength > MAX_WEBHOOK_BODY_BYTES) {
    throw new Error("webhook hash input exceeds limit");
  }
  return createHash("sha256").update(value).digest("hex");
}
