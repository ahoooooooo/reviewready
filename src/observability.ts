import { PlatformError } from "./errors.js";

const MAX_EVENT_ID_LENGTH = 256;
const MAX_CORRELATION_ID_LENGTH = 128;
const MAX_ACTION_LENGTH = 128;
const REVISION = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu;
const DIGEST = /^[0-9a-f]{64}$/iu;
const PRINTABLE = /^[!-~]+$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const ACTIONS = new Set([
  "opened",
  "reopened",
  "synchronize",
  "edited",
  "labeled",
  "unlabeled",
  "ready_for_review",
  "converted_to_draft",
  "submitted",
  "dismissed"
]);

export type TrustAuditEventKind = "webhook" | "evaluation" | "audit";
export type TrustAuditOutcome = "accepted" | "duplicate" | "conflict" | "invalid" | "failed";

export interface TrustAuditEventInput {
  readonly eventId: string;
  readonly correlationId: string;
  readonly kind: TrustAuditEventKind;
  readonly outcome: TrustAuditOutcome;
  readonly occurredAtMs: number;
  readonly repositoryId: number;
  readonly installationId?: number | undefined;
  readonly pullNumber: number;
  readonly baseSha: string;
  readonly headSha: string;
  readonly policySha: string;
  readonly action?: string | undefined;
}

export interface TrustAuditEvent {
  readonly eventVersion: 1;
  readonly eventId: string;
  readonly correlationId: string;
  readonly kind: TrustAuditEventKind;
  readonly outcome: TrustAuditOutcome;
  readonly occurredAtMs: number;
  readonly repositoryId: number;
  readonly installationId?: number | undefined;
  readonly pullNumber: number;
  readonly baseSha: string;
  readonly headSha: string;
  readonly policySha: string;
  readonly action?: string | undefined;
}

export interface TrustAuditEventSink {
  record: (event: TrustAuditEvent) => Promise<string>;
}

export type TrustAuditEmitResult = "recorded" | "duplicate" | "invalid" | "store_error";

function invalid(): never {
  throw new PlatformError("TRUST_AUDIT_EVENT_INVALID", "Trust audit event is invalid.");
}

function recordValue(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid();
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, max: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > max ||
    !PRINTABLE.test(value)
  ) {
    return invalid();
  }
  return value;
}

function identity(value: unknown, max: number): string {
  const candidate = text(value, max);
  if (!UUID.test(candidate)) {
    return invalid();
  }
  return candidate;
}

function action(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ACTION_LENGTH) {
    return invalid();
  }
  if (!ACTIONS.has(value)) {
    return invalid();
  }
  return value;
}

function identifier(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    return invalid();
  }
  return value as number;
}

function optionalIdentifier(value: unknown): number | undefined {
  return value === undefined ? undefined : identifier(value);
}

function enumValue<T extends string>(value: unknown, values: readonly T[]): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    return invalid();
  }
  return value as T;
}

export function createTrustAuditEvent(input: unknown): TrustAuditEvent {
  const value = recordValue(input);
  const baseSha = text(value.baseSha, 64);
  const headSha = text(value.headSha, 64);
  const policySha = text(value.policySha, 64);
  if (!REVISION.test(baseSha) || !REVISION.test(headSha) || !DIGEST.test(policySha)) {
    return invalid();
  }
  const occurredAtMs = value.occurredAtMs;
  if (!Number.isSafeInteger(occurredAtMs) || (occurredAtMs as number) < 0) {
    return invalid();
  }
  const actionValue = action(value.action);
  const event: TrustAuditEvent = {
    eventVersion: 1,
    eventId: identity(value.eventId, MAX_EVENT_ID_LENGTH),
    correlationId: identity(value.correlationId, MAX_CORRELATION_ID_LENGTH),
    kind: enumValue(value.kind, ["webhook", "evaluation", "audit"] as const),
    outcome: enumValue(value.outcome, [
      "accepted",
      "duplicate",
      "conflict",
      "invalid",
      "failed"
    ] as const),
    occurredAtMs: occurredAtMs as number,
    repositoryId: identifier(value.repositoryId),
    pullNumber: identifier(value.pullNumber),
    baseSha,
    headSha,
    policySha
  };
  const installationId = optionalIdentifier(value.installationId);
  if (installationId !== undefined) {
    return {
      ...event,
      installationId,
      ...(actionValue === undefined ? {} : { action: actionValue })
    };
  }
  return actionValue === undefined ? event : { ...event, action: actionValue };
}

export async function emitTrustAuditEvent(
  sink: TrustAuditEventSink,
  input: unknown
): Promise<TrustAuditEmitResult> {
  let event: TrustAuditEvent;
  try {
    event = createTrustAuditEvent(input);
  } catch {
    return "invalid";
  }
  try {
    const result = await sink.record(event);
    return result === "recorded" || result === "duplicate" ? result : "store_error";
  } catch {
    return "store_error";
  }
}
