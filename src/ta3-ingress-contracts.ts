import { MAX_REPLAY_AGE_MS, MAX_WEBHOOK_BODY_BYTES } from "./trust.js";
import type { GitHubWebhookConfig } from "./webhook.js";

export const TA3_MAX_REPLAY_AGE_MS = MAX_REPLAY_AGE_MS;
export const TA3_MAX_BODY_BYTES = MAX_WEBHOOK_BODY_BYTES;
export const TA3_MAX_ATTEMPTS = 3;
export const TA3_MAX_PROVIDER_MATCHES = 1;
export const TA3_DEFAULT_LEASE_MS = 60_000;
export const TA3_MAX_LEASE_MS = 15 * 60 * 1_000;
export const TA3_TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

export type TrustedIngressMode = "disabled" | "shadow" | "advisory" | "required";

export interface TrustedIngressBinding {
  readonly appId: number;
  readonly hookId: string;
  readonly installationId: number;
  readonly repositoryId: number;
  readonly baseRepositoryId: number;
  readonly headRepositoryId: number;
  readonly repositoryOwnerId: number;
  readonly repositoryOwnerType: "User" | "Organization";
  readonly repositoryOwnerLogin: string;
  readonly pullNumber: number;
  readonly baseSha: string;
  readonly headSha: string;
  readonly policyPath: string;
  readonly policySha256: string;
  readonly rootDigest: string;
  readonly checkName: string;
}

export interface TrustedGitHubWebhookConfig extends GitHubWebhookConfig {
  readonly allowedInstallationIds: readonly number[];
  readonly allowedRepositoryIds: readonly number[];
}

export interface TrustedDelivery {
  readonly deliveryId: string;
  readonly bodySha256: string;
  readonly binding: TrustedIngressBinding;
  readonly receivedAtMs: number;
  readonly nowMs: number;
}

export interface TrustedStoreReceipt extends TrustedDelivery {
  readonly bindingDigest: string;
  readonly expiresAtMs: number;
}

export type TrustedStoreClaimOutcome = "new" | "duplicate" | "conflict" | "unknown";

export interface TrustedStoreClaim {
  readonly outcome: TrustedStoreClaimOutcome;
  readonly generation?: number;
  readonly canonicalReceipt?: string;
}

export type TrustedAcceptanceOutcome =
  "accepted" | "duplicate" | "conflict" | "invalid" | "store_error";

export interface TrustedAcceptanceResult {
  readonly accepted: boolean;
  readonly outcome: TrustedAcceptanceOutcome;
  readonly callerKnowledge: "known" | "unresolved";
  readonly requiresReconciliation: boolean;
  readonly retryBeforeReconciliation: boolean;
  readonly generation?: number;
  readonly canonicalReceipt?: string;
}

export type TrustedAcceptanceReconciliation =
  "accepted" | "duplicate" | "conflict" | "missing" | "unknown";

export interface TrustedIngressStore {
  claim: (receipt: TrustedStoreReceipt) => Promise<TrustedStoreClaim>;
  reconcileAcceptance: (input: TrustedDelivery) => Promise<TrustedAcceptanceReconciliation>;
}

export type TrustedLeaseOutcome =
  "leased" | "reclaimed" | "busy" | "stale" | "missing" | "exhausted" | "invalid";

export interface TrustedLeaseResult {
  readonly outcome: TrustedLeaseOutcome;
  readonly attempt?: number;
}

export type TrustedPrepareOutcome = "prepared" | "busy" | "stale" | "missing" | "invalid";

export interface TrustedPrepareResult {
  readonly outcome: TrustedPrepareOutcome;
  readonly generation?: number;
  readonly externalId?: string;
}

export type TrustedCommitOutcome =
  "committed" | "stale" | "duplicate" | "conflict" | "not_ready" | "missing" | "invalid";

export interface ProviderCheckRun {
  readonly appId: number;
  readonly repositoryId: number;
  readonly headSha: string;
  readonly name: string;
  readonly externalId: string;
}

export type ProviderReconciliationOutcome =
  "adopted" | "provider_ambiguous" | "stale" | "missing" | "invalid";

export type ProviderCompletionOutcome = "published" | "blocked" | "stale" | "missing" | "invalid";

export interface TrustedIngressInspection {
  readonly storeCalls: number;
  readonly deliveryClaims: number;
  readonly bodyClaims: number;
  readonly deliveryAliases: number;
  readonly evaluationCount: number;
  readonly currentGeneration: number;
  readonly successfulCommits: number;
  readonly successfulPublishes: number;
  readonly outboxEvents: number;
  readonly outboxPending: number;
}

export interface TrustedOutboxEvent {
  readonly eventId: string;
  readonly receipt: string;
  readonly generation: number;
  readonly externalId: string;
}

export type TrustedOutboxAcknowledgement = "acknowledged" | "duplicate" | "missing" | "invalid";

export type AcceptFault = "none" | "unknown-before-commit" | "unknown-after-commit";

export interface InMemoryTrustedIngressStoreOptions {
  readonly acceptFault?: AcceptFault;
  readonly publicationGate?: TrustedPublicationGate;
}

export interface TrustedPublicationGate {
  readonly canPublishSuccess: () => boolean;
}

export interface InstallationTokenProfile {
  readonly installationId: number;
  readonly allowedRepositoryIds: readonly number[];
  readonly allowedPermissions: Readonly<Record<string, "read" | "write">>;
}

export interface InstallationTokenSnapshot {
  readonly installationId: number;
  readonly repositoryIds: readonly number[];
  readonly permissions: Readonly<Record<string, string>>;
}

export type InstallationTokenValidation = "valid" | "profile_mismatch";

export interface TrustedSnapshotInput {
  readonly basePolicyBytes: Uint8Array;
  readonly boundedApiData: Uint8Array;
}

export interface TrustedSnapshotResult {
  readonly outcome: "evaluated";
  readonly basePolicySha256: string;
  readonly apiDataSha256: string;
  readonly executedOperations: readonly [];
}
