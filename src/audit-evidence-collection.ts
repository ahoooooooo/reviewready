import {
  AUDIT_BUNDLE_DIGEST_DOMAIN,
  canonicalizeAuditEvidenceJsonValue,
  canonicalizeJsonValue,
  hashAuditEvidenceDomain,
  type JsonValue
} from "./audit-evidence.js";
import {
  computeAuditEvidenceIntegrity,
  compareAuditEvidenceChecks,
  encodeAuditEvidenceBase64url,
  MAX_AUDIT_EVIDENCE_FINDINGS,
  MAX_AUDIT_EVIDENCE_RULESETS,
  MAX_AUDIT_EVIDENCE_SOURCE_BYTES,
  MAX_AUDIT_EVIDENCE_WORKFLOWS,
  sha256AuditEvidenceBytes,
  validateAuditEvidenceBundle
} from "./audit-evidence-bundle.js";
import { auditRepository, type AuditSnapshot } from "./audit.js";
import { parsePolicy } from "./policy.js";

export const AUDIT_EVIDENCE_API_VERSION = "2026-03-10" as const;
export const AUDIT_EVIDENCE_CONSISTENCY = "stable-double-observation-v1" as const;
export const MAX_AUDIT_EVIDENCE_AGGREGATE_SOURCE_BYTES = 4 * 1024 * 1024;
export const MAX_AUDIT_EVIDENCE_DURATION_MS = 120_000;

const SHA1 = /^[0-9a-f]{40}$/iu;
const SHA256 = /^[0-9a-f]{64}$/iu;
const OBSERVED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const UNSAFE_TEXT = /[\p{Control}\p{Format}\p{Surrogate}\u2028\u2029]/u;
const WORKFLOW_PATH =
  /^[.][gG][iI][tT][hH][uU][bB]\/[wW][oO][rR][kK][fF][lL][oO][wW][sS]\/[^/]+\.(?:[yY][mM][lL]|[yY][aA][mM][lL])$/u;
const EVIDENCE_MISSING_CODES = new Set([
  "settings-authority-incomplete",
  "settings-observation-mismatch"
]);
const REPORT_ONLY_MISSING_CODES = new Set([
  "trusted-workflow-root",
  "workflow-protection-root",
  "workflow-root-not-observed"
]);
const BOUNDS = {
  bundleBytes: 8_388_608,
  aggregateSourceBytes: 4_194_304,
  sourceFileBytes: 262_144,
  workflows: 100,
  rulesets: 100,
  findings: 500,
  requestAttempts: 768,
  pagesPerCollection: 10,
  itemsPerPage: 100,
  responseBytes: 2_097_152,
  retriesPerRequest: 1,
  deadlineMs: 120_000,
  concurrency: 4,
  jsonDepth: 32,
  jsonObjectMembers: 20_000,
  jsonArrayElements: 20_000,
  jsonTokens: 100_000,
  jsonStringBytes: 6_291_456,
  jsonNumberChars: 32
} as const;

export interface AuditEvidenceRepository {
  readonly id: number;
  readonly owner: string;
  readonly name: string;
  readonly ownerType: "organization" | "user";
  readonly visibility: "public" | "private" | "internal";
  readonly defaultBranch: string;
}

export type AuditEvidenceWorkflow = AuditSnapshot["workflows"][number] & {
  readonly artifactSha256: string;
};

export type AuditEvidenceSnapshot = Omit<AuditSnapshot, "workflows"> & {
  readonly workflows: readonly AuditEvidenceWorkflow[];
};

export function createAuditEvidenceSnapshot(snapshot: AuditSnapshot): AuditEvidenceSnapshot {
  return {
    ...snapshot,
    baseRevision: {
      ...snapshot.baseRevision,
      sha: sha(snapshot.baseRevision.sha),
      policyRevisionSha: sha(snapshot.baseRevision.policyRevisionSha)
    },
    workflows: snapshot.workflows.map((workflow) => ({
      ...workflow,
      revisionSha: sha(workflow.revisionSha),
      artifactSha256: sha256AuditEvidenceBytes(sourceBytes(workflow.source))
    }))
  };
}

export interface AuditEvidenceWorkflowSource {
  readonly path: string;
  readonly source: string;
}

export interface BuildAuditEvidenceBundleInput {
  readonly repository: AuditEvidenceRepository;
  readonly initialBranchSha: string;
  readonly endingBranchSha: string;
  readonly snapshot: AuditEvidenceSnapshot;
  readonly policySource: string;
  readonly workflowSources: readonly AuditEvidenceWorkflowSource[];
  readonly protectedWorkflowPaths: readonly string[];
  readonly trustedWorkflowPaths: readonly string[];
  readonly observedAt: string;
  readonly durationMs: number;
  readonly requestAttempts: number;
  readonly retryAttempts: number;
}

export class AuditEvidenceCollectionError extends Error {
  public constructor(public readonly code: string) {
    super(code);
    this.name = "AuditEvidenceCollectionError";
  }
}

function fail(code: string): never {
  throw new AuditEvidenceCollectionError(code);
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return true;
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function sourceBytes(value: string): Uint8Array {
  if (hasUnpairedSurrogate(value)) {
    fail("evidence-source-invalid");
  }
  return new TextEncoder().encode(value);
}

function boundedText(value: string): void {
  if (value.length === 0 || Array.from(value).length > 512 || UNSAFE_TEXT.test(value)) {
    fail("evidence-text-invalid");
  }
}

function sha(value: string): string {
  if (!SHA1.test(value)) {
    fail("evidence-sha-invalid");
  }
  return value.toLowerCase();
}

function sha256(value: string): string {
  if (!SHA256.test(value)) {
    fail("evidence-sha256-invalid");
  }
  return value.toLowerCase();
}

function sortedUniqueStrings(values: readonly string[], workflow = false): string[] {
  const result = [...values];
  for (const value of result) {
    boundedText(value);
    if (workflow && !WORKFLOW_PATH.test(value)) {
      fail("evidence-workflow-path-invalid");
    }
  }
  result.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  for (let index = 1; index < result.length; index += 1) {
    if (result[index] === result[index - 1]) {
      fail("evidence-array-duplicate");
    }
  }
  return result;
}

function check(value: {
  readonly name: string;
  readonly appId?: number | undefined;
  readonly appSlug?: string | undefined;
}): JsonValue {
  boundedText(value.name);
  if (value.appId !== undefined && value.appSlug !== undefined) {
    fail("evidence-check-provider");
  }
  if (value.appId !== undefined) {
    if (!Number.isSafeInteger(value.appId) || value.appId < 1 || value.appId > 2_147_483_647) {
      fail("evidence-check-provider");
    }
    return { name: value.name, appId: value.appId };
  }
  if (value.appSlug !== undefined) {
    boundedText(value.appSlug);
    return { name: value.name, appSlug: value.appSlug.toLowerCase() };
  }
  return { name: value.name };
}

function checkArray(
  values: readonly {
    readonly name: string;
    readonly appId?: number | undefined;
    readonly appSlug?: string | undefined;
  }[]
): JsonValue[] {
  const result = values.map(check);
  result.sort(compareAuditEvidenceChecks);
  for (let index = 1; index < result.length; index += 1) {
    if (canonicalizeJsonValue(result[index]) === canonicalizeJsonValue(result[index - 1])) {
      fail("evidence-check-duplicate");
    }
  }
  return result;
}

function policyCheckArray(
  values: readonly {
    readonly name: string;
    readonly appId?: number | undefined;
    readonly appSlug?: string | undefined;
  }[]
): JsonValue[] {
  const unique = new Map<
    string,
    {
      readonly name: string;
      readonly appId?: number | undefined;
      readonly appSlug?: string | undefined;
    }
  >();
  for (const value of values) {
    const normalized = check(value);
    unique.set(canonicalizeJsonValue(normalized), value);
  }
  return checkArray([...unique.values()]);
}

function branchBypassSummaries(
  actors: NonNullable<
    NonNullable<AuditSnapshot["branchProtection"]>["requiredPullRequestReviews"]
  >["bypassActors"]
): JsonValue[] {
  const counts = new Map<"app" | "team" | "user", number>();
  const identities = new Set<string>();
  for (const actor of actors) {
    const actorType = actor.type;
    if (actorType !== "app" && actorType !== "team" && actorType !== "user") {
      fail("evidence-branch-actor");
    }
    if (
      typeof actor.id !== "string" ||
      !/^[1-9][0-9]*$/u.test(actor.id) ||
      !Number.isSafeInteger(Number(actor.id))
    ) {
      fail("evidence-branch-actor");
    }
    const identity = actorType + "\u0000" + actor.id;
    if (identities.has(identity)) {
      fail("evidence-branch-actor-duplicate");
    }
    identities.add(identity);
    counts.set(actorType, (counts.get(actorType) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([actorType, count]) => ({ actorType, count }));
}

function rulesetBypassSummaries(
  actors: AuditSnapshot["rulesets"][number]["bypassActors"]
): JsonValue[] {
  const counts = new Map<string, number>();
  const identities = new Set<string>();
  for (const actor of actors) {
    const actorType = actor.actorType;
    const bypassMode = actor.bypassMode;
    if (
      actorType !== "deploy_key" &&
      actorType !== "integration" &&
      actorType !== "organization_admin" &&
      actorType !== "repository_role" &&
      actorType !== "team" &&
      actorType !== "user"
    ) {
      fail("evidence-ruleset-actor");
    }
    if (bypassMode !== "always" && bypassMode !== "exempt" && bypassMode !== "pull_request") {
      fail("evidence-ruleset-actor");
    }
    if (
      typeof actor.id !== "string" ||
      (actorType !== "deploy_key" &&
        actorType !== "organization_admin" &&
        (!/^[1-9][0-9]*$/u.test(actor.id) || !Number.isSafeInteger(Number(actor.id)))) ||
      (actorType === "deploy_key" && actor.id !== "deploykey") ||
      (actorType === "organization_admin" && actor.id !== "organizationadmin")
    ) {
      fail("evidence-ruleset-actor");
    }
    const identity = actorType + "\u0000" + actor.id;
    if (identities.has(identity)) {
      fail("evidence-ruleset-actor-duplicate");
    }
    identities.add(identity);
    const key = actorType + "\u0000" + bypassMode;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, count]) => {
      const separator = key.indexOf("\u0000");
      return {
        actorType: key.slice(0, separator),
        bypassMode: key.slice(separator + 1),
        count
      };
    });
}

function projectRulesetPullRequest(
  value: NonNullable<AuditSnapshot["rulesets"][number]["pullRequest"]>
): JsonValue {
  const allowedMergeMethods = sortedUniqueStrings(value.allowedMergeMethods);
  if (
    allowedMergeMethods.some(
      (method) => method !== "merge" && method !== "squash" && method !== "rebase"
    )
  ) {
    fail("evidence-ruleset-review-semantics");
  }
  if (value.requiredReviewers.length !== 0) {
    fail("evidence-ruleset-reviewers-unsupported");
  }
  return {
    allowedMergeMethods,
    dismissStaleReviewsOnPush: value.dismissStaleReviewsOnPush,
    requireCodeOwnerReview: value.requireCodeOwnerReview,
    requireLastPushApproval: value.requireLastPushApproval,
    requiredApprovingReviewCount: value.requiredApprovingReviewCount,
    requiredReviewThreadResolution: value.requiredReviewThreadResolution,
    requiredReviewers: []
  };
}

function hasVersionedRulesetSemantics(snapshot: AuditEvidenceSnapshot): boolean {
  return snapshot.rulesets.some(
    (ruleset) =>
      ruleset.pullRequest !== undefined || ruleset.requiredStatusChecksPolicy !== undefined
  );
}

function projectBranchProtection(value: AuditSnapshot["branchProtection"]): JsonValue | null {
  if (value === null) {
    return null;
  }
  return {
    branch: value.branch,
    exists: value.exists,
    enforceAdmins: value.enforceAdmins,
    allowForcePushes: value.allowForcePushes,
    allowDeletions: value.allowDeletions,
    requiredStatusChecks:
      value.requiredStatusChecks === null
        ? null
        : {
            strict: value.requiredStatusChecks.strict,
            checks: checkArray(value.requiredStatusChecks.checks)
          },
    requiredPullRequestReviews:
      value.requiredPullRequestReviews === null
        ? null
        : {
            requiredApprovingReviewCount:
              value.requiredPullRequestReviews.requiredApprovingReviewCount,
            bypassActorsKnown: value.requiredPullRequestReviews.bypassActorsKnown === true,
            bypassActorSummaries: branchBypassSummaries(
              value.requiredPullRequestReviews.bypassActors
            )
          }
  };
}

function projectRulesets(snapshot: Pick<AuditEvidenceSnapshot, "rulesets">): JsonValue[] {
  const result = snapshot.rulesets.map((value) => ({
    id: value.id,
    name: value.name,
    target: value.target,
    refPatterns: sortedUniqueStrings(value.refPatterns),
    ...(value.repositoryPatterns === undefined
      ? {}
      : { repositoryPatterns: sortedUniqueStrings(value.repositoryPatterns) }),
    enforcement: value.enforcement,
    bypassActorsKnown: value.bypassActorsKnown === true,
    bypassActorSummaries: rulesetBypassSummaries(value.bypassActors),
    ...(value.allowForcePushes === undefined ? {} : { allowForcePushes: value.allowForcePushes }),
    ...(value.allowDeletions === undefined ? {} : { allowDeletions: value.allowDeletions }),
    requiredChecks: checkArray(value.requiredChecks),
    ...(value.pullRequest === undefined
      ? {}
      : { pullRequest: projectRulesetPullRequest(value.pullRequest) }),
    ...(value.requiredStatusChecksPolicy === undefined
      ? {}
      : { requiredStatusChecksPolicy: value.requiredStatusChecksPolicy })
  }));
  result.sort((left, right) => left.id - right.id);
  return result;
}

function assertCompleteAuthority(snapshot: AuditEvidenceSnapshot, evidenceComplete: boolean): void {
  if (!evidenceComplete) {
    return;
  }
  if (
    snapshot.branchProtection === null ||
    snapshot.branchProtection.requiredPullRequestReviews === null ||
    snapshot.branchProtection.requiredPullRequestReviews.bypassActorsKnown !== true
  ) {
    fail("evidence-authority-incomplete");
  }
  if (!snapshot.tagProtection.known) {
    fail("evidence-authority-incomplete");
  }
  if (snapshot.rulesets.some((ruleset) => ruleset.bypassActorsKnown !== true)) {
    fail("evidence-authority-incomplete");
  }
}

function projectEvidenceCompleteness(snapshot: AuditEvidenceSnapshot): {
  readonly complete: boolean;
  readonly missing: string[];
} {
  const missing = sortedUniqueStrings(snapshot.completeness.missing);
  if (
    missing.some(
      (value) => !EVIDENCE_MISSING_CODES.has(value) && !REPORT_ONLY_MISSING_CODES.has(value)
    )
  ) {
    fail("evidence-collection-failure");
  }
  if (snapshot.completeness.complete !== (missing.length === 0)) {
    fail("evidence-completeness");
  }
  const evidenceMissing = missing.filter((value) => EVIDENCE_MISSING_CODES.has(value));
  if (
    evidenceMissing.includes("settings-authority-incomplete") &&
    evidenceMissing.includes("settings-observation-mismatch")
  ) {
    fail("evidence-completeness");
  }
  if (
    evidenceMissing.includes("settings-authority-incomplete") &&
    !hasUnknownAuthorityFact(snapshot)
  ) {
    fail("evidence-authority-mismatch");
  }
  return { complete: evidenceMissing.length === 0, missing: evidenceMissing };
}

function hasUnknownAuthorityFact(snapshot: AuditEvidenceSnapshot): boolean {
  return (
    !snapshot.tagProtection.known ||
    snapshot.branchProtection === null ||
    snapshot.branchProtection.requiredPullRequestReviews === null ||
    snapshot.branchProtection.requiredPullRequestReviews.bypassActorsKnown !== true ||
    snapshot.rulesets.some((ruleset) => ruleset.bypassActorsKnown !== true)
  );
}

function artifact(
  path: string,
  revisionSha: string,
  source: string,
  allowEmpty = false
): JsonValue {
  const bytes = sourceBytes(source);
  if ((!allowEmpty && bytes.byteLength < 1) || bytes.byteLength > MAX_AUDIT_EVIDENCE_SOURCE_BYTES) {
    fail("evidence-source-limit");
  }
  return {
    path,
    revisionSha,
    sha256: sha256AuditEvidenceBytes(bytes),
    byteLength: bytes.byteLength,
    contentBase64url: encodeAuditEvidenceBase64url(bytes)
  };
}

function projectSnapshot(
  input: BuildAuditEvidenceBundleInput,
  workflowArtifacts: readonly JsonValue[],
  snapshotVersion: 1 | 2
): JsonValue {
  const snapshot = input.snapshot;
  const policySha256 = snapshot.baseRevision.policySha256;
  if (policySha256 === undefined) {
    fail("evidence-policy-hash");
  }
  const completeness = projectEvidenceCompleteness(snapshot);
  return {
    snapshotVersion,
    repository: {
      owner: snapshot.repository.owner,
      name: snapshot.repository.name,
      defaultBranch: snapshot.repository.defaultBranch
    },
    baseRevision: {
      sha: sha(snapshot.baseRevision.sha),
      policyPath: snapshot.baseRevision.policyPath,
      policyRevisionSha: sha(snapshot.baseRevision.policyRevisionSha),
      policySha256: sha256(policySha256),
      policyLoadedFromBase: true
    },
    policy: {
      requiredChecks: policyCheckArray(snapshot.policy.requiredChecks),
      workflowPaths: sortedUniqueStrings(snapshot.policy.workflowPaths, true)
    },
    completeness: {
      complete: completeness.complete,
      missing: completeness.missing
    },
    branchProtection: projectBranchProtection(snapshot.branchProtection),
    rulesets: projectRulesets(snapshot),
    tagProtection: {
      known: snapshot.tagProtection.known,
      allowsDeletion: snapshot.tagProtection.allowsDeletion,
      allowsUpdate: snapshot.tagProtection.allowsUpdate
    },
    workflows: [...workflowArtifacts]
  };
}

function compareDerivedPolicy(
  source: string,
  expected: AuditSnapshot["policy"]["requiredChecks"]
): void {
  let policy: ReturnType<typeof parsePolicy>;
  try {
    policy = parsePolicy(source);
  } catch {
    fail("evidence-policy-invalid");
  }
  const derived = policy.rules.flatMap((rule) =>
    rule.require.flatMap((requirement) =>
      requirement.type === "check"
        ? [
            {
              name: requirement.name,
              ...(requirement.app === undefined ? {} : { appSlug: requirement.app })
            }
          ]
        : []
    )
  );
  const normalized = policyCheckArray(derived);
  if (canonicalizeJsonValue(normalized) !== canonicalizeJsonValue(policyCheckArray(expected))) {
    fail("evidence-policy-derived");
  }
}

export function buildAuditEvidenceBundle(input: BuildAuditEvidenceBundleInput): JsonValue {
  if (!Number.isSafeInteger(input.repository.id) || input.repository.id < 1) {
    fail("evidence-repository");
  }
  for (const value of [
    input.repository.owner,
    input.repository.name,
    input.repository.defaultBranch
  ]) {
    boundedText(value);
  }
  if (
    !OBSERVED_AT.test(input.observedAt) ||
    new Date(input.observedAt).toISOString() !== input.observedAt
  ) {
    fail("evidence-time");
  }
  if (
    !Number.isSafeInteger(input.durationMs) ||
    input.durationMs < 0 ||
    input.durationMs > MAX_AUDIT_EVIDENCE_DURATION_MS ||
    !Number.isSafeInteger(input.requestAttempts) ||
    input.requestAttempts < 0 ||
    input.requestAttempts > 768 ||
    !Number.isSafeInteger(input.retryAttempts) ||
    input.retryAttempts < 0 ||
    input.retryAttempts > input.requestAttempts
  ) {
    fail("evidence-collection-bounds");
  }
  const requestedBaseSha = sha(input.snapshot.baseRevision.sha);
  const policyRevisionSha = sha(input.snapshot.baseRevision.policyRevisionSha);
  const policyLoadedFromBase = input.snapshot.baseRevision.policyLoadedFromBase;
  if (
    sha(input.initialBranchSha) !== requestedBaseSha ||
    sha(input.endingBranchSha) !== requestedBaseSha ||
    policyRevisionSha !== requestedBaseSha ||
    typeof policyLoadedFromBase !== "boolean" ||
    !policyLoadedFromBase
  ) {
    fail("evidence-revision-mismatch");
  }
  const policySha256 = input.snapshot.baseRevision.policySha256;
  if (policySha256 === undefined) {
    fail("evidence-policy-hash");
  }
  const policyBytes = sourceBytes(input.policySource);
  if (policyBytes.byteLength < 1 || policyBytes.byteLength > MAX_AUDIT_EVIDENCE_SOURCE_BYTES) {
    fail("evidence-source-limit");
  }
  if (sha256AuditEvidenceBytes(policyBytes) !== sha256(policySha256)) {
    fail("evidence-policy-hash");
  }
  compareDerivedPolicy(input.policySource, input.snapshot.policy.requiredChecks);

  const workflowSources = new Map<string, string>();
  for (const source of input.workflowSources) {
    if (workflowSources.has(source.path)) {
      fail("evidence-workflow-duplicate");
    }
    workflowSources.set(source.path, source.source);
  }
  const expectedWorkflowPaths = sortedUniqueStrings(input.snapshot.policy.workflowPaths, true);
  if (
    workflowSources.size !== expectedWorkflowPaths.length ||
    expectedWorkflowPaths.some((path) => !workflowSources.has(path))
  ) {
    fail("evidence-workflow-artifact-binding");
  }
  const workflowArtifacts = expectedWorkflowPaths.map((path) => {
    const source = workflowSources.get(path);
    if (source === undefined) {
      fail("evidence-workflow-artifact-binding");
    }
    const current = input.snapshot.workflows.find((workflow) => workflow.path === path);
    if (
      current === undefined ||
      sha(current.revisionSha) !== requestedBaseSha ||
      current.source !== source
    ) {
      fail("evidence-workflow-binding");
    }
    const value = artifact(path, requestedBaseSha, source, true);
    const valueRecord = value as Record<string, JsonValue>;
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      valueRecord.sha256 !== current.artifactSha256
    ) {
      fail("evidence-workflow-binding");
    }
    return {
      path,
      revisionSha: requestedBaseSha,
      artifactSha256: current.artifactSha256,
      protectedFromPullRequest: false,
      trustedRoot: false
    };
  });
  const aggregateSourceBytes =
    policyBytes.byteLength +
    expectedWorkflowPaths.reduce(
      (total, path) => total + new TextEncoder().encode(workflowSources.get(path) ?? "").byteLength,
      0
    );
  if (aggregateSourceBytes > MAX_AUDIT_EVIDENCE_AGGREGATE_SOURCE_BYTES) {
    fail("evidence-aggregate-source-limit");
  }
  if (expectedWorkflowPaths.length > MAX_AUDIT_EVIDENCE_WORKFLOWS) {
    fail("evidence-workflow-limit");
  }
  if (input.snapshot.rulesets.length > MAX_AUDIT_EVIDENCE_RULESETS) {
    fail("evidence-ruleset-limit");
  }

  if (
    input.snapshot.workflows.some(
      (workflow) => workflow.protectedFromPullRequest || workflow.trustedRoot
    )
  ) {
    fail("evidence-workflow-authority");
  }
  const evidenceCompleteness = projectEvidenceCompleteness(input.snapshot);
  assertCompleteAuthority(input.snapshot, evidenceCompleteness.complete);
  const bundleVersion: 1 | 2 = hasVersionedRulesetSemantics(input.snapshot) ? 2 : 1;
  const snapshot = projectSnapshot(input, workflowArtifacts, bundleVersion);
  const reportSnapshot: AuditSnapshot = {
    ...input.snapshot,
    completeness: {
      complete: evidenceCompleteness.complete,
      missing: [...evidenceCompleteness.missing]
    },
    workflows: input.snapshot.workflows.map((workflow) => {
      const { artifactSha256, ...legacyWorkflow } = workflow;
      void artifactSha256;
      return legacyWorkflow;
    })
  };
  const report = auditRepository(reportSnapshot);
  if (report.findings.length > MAX_AUDIT_EVIDENCE_FINDINGS) {
    fail("evidence-findings-limit");
  }
  const bundle = {
    bundleVersion,
    canonicalization: "RFC8785",
    subject: {
      repositoryId: input.repository.id,
      owner: input.repository.owner,
      name: input.repository.name,
      ownerType: input.repository.ownerType,
      visibility: input.repository.visibility,
      defaultBranch: input.repository.defaultBranch,
      requestedBaseSha,
      observedBaseShaAtStart: requestedBaseSha,
      observedBaseShaAtEnd: requestedBaseSha
    },
    collection: {
      apiVersion: AUDIT_EVIDENCE_API_VERSION,
      consistency: AUDIT_EVIDENCE_CONSISTENCY,
      observedAt: input.observedAt,
      durationMs: input.durationMs,
      status: evidenceCompleteness.complete ? "complete" : "incomplete",
      missing: evidenceCompleteness.missing,
      requestAttempts: input.requestAttempts,
      retryAttempts: input.retryAttempts,
      bounds: BOUNDS
    },
    assertions: {
      policyPath: input.snapshot.baseRevision.policyPath,
      protectedWorkflowPaths: sortedUniqueStrings(input.protectedWorkflowPaths, true),
      trustedWorkflowPaths: sortedUniqueStrings(input.trustedWorkflowPaths, true)
    },
    snapshot,
    artifacts: {
      policy: artifact(
        input.snapshot.baseRevision.policyPath,
        requestedBaseSha,
        input.policySource
      ),
      workflows: expectedWorkflowPaths.map((path) => {
        const source = workflowSources.get(path);
        if (source === undefined) {
          fail("evidence-workflow-artifact-binding");
        }
        return artifact(path, requestedBaseSha, source, true);
      })
    },
    report: report as unknown as JsonValue,
    integrity: {
      algorithm: "sha256",
      snapshotSha256: "",
      reportSha256: "",
      payloadSha256: ""
    }
  } as unknown as Record<string, JsonValue>;
  const integrity = computeAuditEvidenceIntegrity(bundle);
  const completed = { ...bundle, integrity };
  validateAuditEvidenceBundle(completed);
  return completed as unknown as JsonValue;
}

export function serializeAuditEvidenceBundle(value: unknown): Uint8Array {
  validateAuditEvidenceBundle(value);
  return new TextEncoder().encode(canonicalizeAuditEvidenceJsonValue(value));
}

export function hashSerializedAuditEvidenceBundle(value: unknown): string {
  return hashAuditEvidenceDomain(AUDIT_BUNDLE_DIGEST_DOMAIN, serializeAuditEvidenceBundle(value));
}
