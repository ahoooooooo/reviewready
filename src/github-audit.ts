import { createHash } from "node:crypto";

import { MAX_AUDIT_RULESETS, type AuditSnapshot } from "./audit.js";
import { canonicalizeJsonValue } from "./audit-evidence.js";
import { AuditApiFailure } from "./github-audit-api.js";
import { parsePolicy } from "./policy.js";
import { normalizeRepositoryPath } from "./input.js";
import { MAX_WORKFLOW_SOURCE_BYTES } from "./workflow-security.js";

export const MAX_AUDIT_WORKFLOW_SOURCES = 100;
export const MAX_AUDIT_SOURCE_BYTES = MAX_WORKFLOW_SOURCE_BYTES;
export const MAX_AUDIT_REPOSITORY_TEXT = 512;
export const MAX_AUDIT_COLLECTION_CONCURRENCY = 4;
export const MAX_AUDIT_WORKFLOW_ROOTS = 100;
const UNSAFE_TEXT = /[\p{Control}\p{Format}\p{Surrogate}\u2028\u2029]/u;

export interface AuditRepositoryArguments {
  readonly owner: string;
  readonly repo: string;
}

export interface AuditRepositoryMetadata {
  readonly owner: string;
  readonly name: string;
  readonly defaultBranch: string;
  readonly id: number;
  readonly ownerType: "organization" | "user";
  readonly visibility: "public" | "private" | "internal";
}

interface SnapshotCollectionContext {
  repository?: AuditRepositoryMetadata;
}

export interface AuditRequestMetrics {
  readonly requestAttempts: number;
  readonly retryAttempts: number;
}

export interface AuditBranchMetadata {
  readonly name: string;
  readonly sha: string;
}

export type AuditBranchProtection = NonNullable<AuditSnapshot["branchProtection"]>;
export type AuditRuleset = AuditSnapshot["rulesets"][number];
export type AuditTagProtection = AuditSnapshot["tagProtection"];

export interface AuditWorkflowFile {
  readonly path: string;
  readonly type: "file" | "symlink" | "submodule" | "dir";
}

export interface AuditGitHubClient {
  getRepository: (arguments_: AuditRepositoryArguments) => Promise<AuditRepositoryMetadata>;
  getBranch: (
    arguments_: AuditRepositoryArguments & { readonly branch: string }
  ) => Promise<AuditBranchMetadata>;
  getBranchProtection: (
    arguments_: AuditRepositoryArguments & { readonly branch: string }
  ) => Promise<AuditBranchProtection | null>;
  listRulesets: (
    arguments_: AuditRepositoryArguments & {
      readonly ownerType?: "organization" | "user" | undefined;
      readonly repositoryId?: number | undefined;
    }
  ) => Promise<readonly AuditRuleset[]>;
  listWorkflowFiles: (
    arguments_: AuditRepositoryArguments & { readonly ref: string }
  ) => Promise<readonly AuditWorkflowFile[]>;
  getFileAtRevision: (
    arguments_: AuditRepositoryArguments & { readonly path: string; readonly ref: string }
  ) => Promise<unknown>;
  getTagProtection: (arguments_: AuditRepositoryArguments) => Promise<AuditTagProtection>;
  readonly getRequestMetrics?: (() => AuditRequestMetrics) | undefined;
}

export interface GitHubAuditCollectorOptions {
  readonly branch?: string | undefined;
  readonly revision?: string | undefined;
  readonly policyPath?: string | undefined;
  readonly protectedWorkflowPaths?: readonly string[] | undefined;
  readonly trustedWorkflowPaths?: readonly string[] | undefined;
}

interface CollectionFailure {
  readonly code: string;
}

export class AuditCollectionFailure extends Error implements CollectionFailure {
  public constructor(public readonly code: string) {
    super(code);
    this.name = "AuditCollectionFailure";
  }
}

const SHA = /^[0-9a-f]{40}$/iu;
const REPOSITORY_NAME = /^[A-Za-z0-9._-]{1,100}$/u;
const WORKFLOW_PATH =
  /^[.][gG][iI][tT][hH][uU][bB]\/[wW][oO][rR][kK][fF][lL][oO][wW][sS]\/[^/]+\.(?:[yY][mM][lL]|[yY][aA][mM][lL])$/u;

function failure(code: string): AuditCollectionFailure {
  return new AuditCollectionFailure(code);
}

function isCollectionFailure(value: unknown): value is CollectionFailure {
  return value instanceof AuditCollectionFailure || value instanceof AuditApiFailure;
}

function evidenceFailureCode(snapshot: AuditSnapshot): string {
  const missing = new Set(snapshot.completeness.missing);
  if (
    [
      "base-revision-changed",
      "repository-identity-changed",
      "requested-revision-mismatch",
      "non-default-branch",
      "default-branch-invalid",
      "base-revision-invalid"
    ].some((code) => missing.has(code))
  ) {
    return "evidence-revision-not-stable";
  }
  if ([...missing].some((code) => code.includes("unsupported"))) {
    return "evidence-unsupported-semantics";
  }
  return "evidence-collection-failed";
}

function safeRepositoryName(value: string, fallback: string): string {
  return REPOSITORY_NAME.test(value) ? value : fallback;
}

function safeRepositoryText(value: string, fallback: string): string {
  return value.length > 0 &&
    value.length <= MAX_AUDIT_REPOSITORY_TEXT &&
    !/[\p{Control}\p{Format}\u2028\u2029]/u.test(value)
    ? value
    : fallback;
}

function validSha(value: string): boolean {
  return SHA.test(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safePolicyPath(value: string | undefined): string {
  const candidate = value ?? ".reviewready.yml";
  try {
    const normalized = normalizeRepositoryPath(candidate);
    if (normalized.length > MAX_AUDIT_REPOSITORY_TEXT || UNSAFE_TEXT.test(normalized)) {
      throw failure("policy-path-too-long");
    }
    return normalized;
  } catch {
    throw failure("policy-path-invalid");
  }
}

function safeWorkflowPath(value: string): string {
  try {
    const normalized = normalizeRepositoryPath(value);
    if (
      !WORKFLOW_PATH.test(normalized) ||
      normalized.length > MAX_AUDIT_REPOSITORY_TEXT ||
      UNSAFE_TEXT.test(normalized)
    ) {
      throw failure("workflow-path-invalid");
    }
    return normalized;
  } catch {
    throw failure("workflow-path-invalid");
  }
}

function validateRepositoryMetadata(
  value: unknown,
  expectedOwner?: string,
  expectedName?: string
): AuditRepositoryMetadata {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as { readonly owner?: unknown }).owner !== "string" ||
    typeof (value as { readonly name?: unknown }).name !== "string" ||
    typeof (value as { readonly defaultBranch?: unknown }).defaultBranch !== "string" ||
    ((value as { readonly ownerType?: unknown }).ownerType !== "organization" &&
      (value as { readonly ownerType?: unknown }).ownerType !== "user")
  ) {
    throw failure("repository-metadata-invalid");
  }
  const owner = (value as { readonly owner: string }).owner;
  const name = (value as { readonly name: string }).name;
  const defaultBranch = (value as { readonly defaultBranch: string }).defaultBranch;
  const ownerType = (value as { readonly ownerType: "organization" | "user" }).ownerType;
  const visibility = (value as { readonly visibility?: unknown }).visibility;
  const id = (value as { readonly id?: unknown }).id;
  if (
    !REPOSITORY_NAME.test(owner) ||
    !REPOSITORY_NAME.test(name) ||
    defaultBranch.length === 0 ||
    defaultBranch.length > MAX_AUDIT_REPOSITORY_TEXT ||
    /[\p{Control}\p{Format}\u2028\u2029]/u.test(defaultBranch) ||
    !Number.isSafeInteger(id) ||
    (id as number) < 1 ||
    (visibility !== "public" && visibility !== "private" && visibility !== "internal")
  ) {
    throw failure("repository-metadata-invalid");
  }
  if (
    (expectedOwner !== undefined && owner.toLowerCase() !== expectedOwner.toLowerCase()) ||
    (expectedName !== undefined && name.toLowerCase() !== expectedName.toLowerCase())
  ) {
    throw failure("repository-identity-mismatch");
  }
  return { owner, name, defaultBranch, id: id as number, ownerType, visibility };
}

function validateBranch(value: unknown, expectedBranch: string): AuditBranchMetadata {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as { readonly name?: unknown }).name !== "string" ||
    typeof (value as { readonly sha?: unknown }).sha !== "string"
  ) {
    throw failure("base-revision-invalid");
  }
  const name = (value as { readonly name: string }).name;
  const sha = (value as { readonly sha: string }).sha;
  if (
    name !== expectedBranch ||
    name.length === 0 ||
    name.length > MAX_AUDIT_REPOSITORY_TEXT ||
    /[\p{Control}\p{Format}\u2028\u2029]/u.test(name) ||
    !validSha(sha)
  ) {
    throw failure("base-revision-invalid");
  }
  return { name, sha: sha.toLowerCase() };
}

function uniqueSorted<T>(values: readonly T[], key: (value: T) => string): T[] {
  const seen = new Map<string, T>();
  for (const value of values) {
    seen.set(key(value), value);
  }
  return [...seen.values()].sort((left, right) => compareText(key(left), key(right)));
}

function policyFacts(source: string): {
  readonly requiredChecks: AuditSnapshot["policy"]["requiredChecks"];
} {
  const policy = parsePolicy(source);
  const checks = policy.rules.flatMap((rule) =>
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
  return {
    requiredChecks: uniqueSorted(checks, (check) => JSON.stringify(check))
  };
}

interface MutableAuditSettings {
  readonly branchProtection: AuditBranchProtection | null;
  readonly rulesets: readonly AuditRuleset[];
  readonly tagProtection: AuditTagProtection;
}

async function collectMutableSettings(
  client: AuditGitHubClient,
  arguments_: AuditRepositoryArguments,
  branch: string,
  ownerType: "organization" | "user",
  repositoryId: number
): Promise<MutableAuditSettings> {
  const [branchProtection, tagProtection] = await Promise.all([
    client.getBranchProtection({ ...arguments_, branch }),
    client.getTagProtection(arguments_)
  ]);
  const rulesets = await client.listRulesets({ ...arguments_, ownerType, repositoryId });
  return { branchProtection, rulesets, tagProtection };
}

function canonicalMutableSettings(value: MutableAuditSettings): string {
  const stable = (item: unknown): string => {
    return canonicalizeJsonValue(item);
  };
  const sortJson = <T>(values: readonly T[]): T[] =>
    [...values].sort((left, right) => compareText(stable(left), stable(right)));
  const sortText = (values: readonly string[]): string[] => [...values].sort(compareText);
  const branchProtection =
    value.branchProtection === null
      ? null
      : {
          branch: value.branchProtection.branch,
          exists: value.branchProtection.exists,
          enforceAdmins: value.branchProtection.enforceAdmins,
          allowForcePushes: value.branchProtection.allowForcePushes,
          allowDeletions: value.branchProtection.allowDeletions,
          requiredStatusChecks:
            value.branchProtection.requiredStatusChecks === null
              ? null
              : {
                  strict: value.branchProtection.requiredStatusChecks.strict,
                  checks: sortJson(value.branchProtection.requiredStatusChecks.checks)
                },
          requiredPullRequestReviews:
            value.branchProtection.requiredPullRequestReviews === null
              ? null
              : {
                  requiredApprovingReviewCount:
                    value.branchProtection.requiredPullRequestReviews.requiredApprovingReviewCount,
                  ...(value.branchProtection.requiredPullRequestReviews.bypassActorsKnown ===
                  undefined
                    ? {}
                    : {
                        bypassActorsKnown:
                          value.branchProtection.requiredPullRequestReviews.bypassActorsKnown
                      }),
                  bypassActors: sortJson(
                    value.branchProtection.requiredPullRequestReviews.bypassActors
                  )
                }
        };
  const rulesets = [...value.rulesets]
    .map((ruleset) => ({
      id: ruleset.id,
      name: ruleset.name,
      target: ruleset.target,
      refPatterns: sortText(ruleset.refPatterns),
      ...(ruleset.repositoryPatterns === undefined
        ? {}
        : { repositoryPatterns: sortText(ruleset.repositoryPatterns) }),
      enforcement: ruleset.enforcement,
      ...(ruleset.bypassActorsKnown === undefined
        ? {}
        : { bypassActorsKnown: ruleset.bypassActorsKnown }),
      bypassActors: sortJson(ruleset.bypassActors),
      ...(ruleset.allowForcePushes === undefined
        ? {}
        : { allowForcePushes: ruleset.allowForcePushes }),
      ...(ruleset.allowDeletions === undefined ? {} : { allowDeletions: ruleset.allowDeletions }),
      requiredChecks: sortJson(ruleset.requiredChecks)
    }))
    .sort((left, right) => left.id - right.id);
  const tagProtection = {
    known: value.tagProtection.known,
    allowsDeletion: value.tagProtection.allowsDeletion,
    allowsUpdate: value.tagProtection.allowsUpdate
  };
  return stable({ branchProtection, rulesets, tagProtection });
}

function hasUnknownMutableAuthority(value: MutableAuditSettings): boolean {
  return (
    !value.tagProtection.known ||
    value.branchProtection === null ||
    value.branchProtection.requiredPullRequestReviews === null ||
    value.branchProtection.requiredPullRequestReviews.bypassActorsKnown !== true ||
    value.rulesets.some((ruleset) => ruleset.bypassActorsKnown !== true)
  );
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  limit: number,
  mapper: (value: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = Array.from({ length: values.length });
  let next = 0;
  async function worker(): Promise<void> {
    while (next < values.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(values[index] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()));
  return results;
}

function incompleteSnapshot(
  owner: string,
  repo: string,
  defaultBranch: string,
  baseSha: string,
  policyPath: string,
  missing: readonly string[]
): AuditSnapshot {
  return {
    version: 1,
    repository: {
      owner: safeRepositoryName(owner, "unknown"),
      name: safeRepositoryName(repo, "unknown"),
      defaultBranch: safeRepositoryText(defaultBranch, "unknown")
    },
    baseRevision: {
      sha: validSha(baseSha) ? baseSha : "0".repeat(40),
      policyPath,
      policyRevisionSha: validSha(baseSha) ? baseSha : "0".repeat(40),
      policyLoadedFromBase: false
    },
    policy: { requiredChecks: [], workflowPaths: [] },
    completeness: {
      complete: false,
      missing: uniqueSorted(
        [...missing].filter((item) => item.length > 0 && item.length <= MAX_AUDIT_REPOSITORY_TEXT),
        (item) => item
      ).slice(0, 100)
    },
    branchProtection: null,
    rulesets: [],
    tagProtection: { known: false, allowsDeletion: true, allowsUpdate: true },
    workflows: []
  };
}

export interface AuditCollectionResult {
  readonly snapshot: AuditSnapshot;
  readonly repository: AuditRepositoryMetadata;
  readonly policySource: string;
  readonly initialBranchSha: string;
  readonly endingBranchSha: string;
}

export interface AuditEvidenceCollectionResult extends AuditCollectionResult {
  readonly requestAttempts: number;
  readonly retryAttempts: number;
}

export async function collectRepositoryAuditEvidenceData(
  owner: string,
  repo: string,
  client: AuditGitHubClient,
  options: GitHubAuditCollectorOptions = {}
): Promise<AuditEvidenceCollectionResult> {
  const context: SnapshotCollectionContext = {};
  const snapshot = await collectRepositoryAuditSnapshotInternal(
    owner,
    repo,
    client,
    options,
    context
  );
  const requestedBaseSha = snapshot.baseRevision.sha;
  if (
    !validSha(requestedBaseSha) ||
    !snapshot.baseRevision.policyLoadedFromBase ||
    snapshot.baseRevision.policyRevisionSha !== requestedBaseSha ||
    snapshot.completeness.missing.some(
      (code) => code === "base-revision-changed" || code === "repository-identity-changed"
    )
  ) {
    throw failure(evidenceFailureCode(snapshot));
  }
  const arguments_ = { owner, repo };
  const repository = validateRepositoryMetadata(
    await client.getRepository(arguments_),
    owner,
    repo
  );
  const initialRepository = context.repository;
  if (
    initialRepository === undefined ||
    repository.owner.toLowerCase() !== snapshot.repository.owner.toLowerCase() ||
    repository.name.toLowerCase() !== snapshot.repository.name.toLowerCase() ||
    repository.defaultBranch !== snapshot.repository.defaultBranch ||
    repository.id !== initialRepository.id ||
    repository.ownerType !== initialRepository.ownerType ||
    repository.visibility !== initialRepository.visibility
  ) {
    throw failure("evidence-repository-mismatch");
  }
  const policySource = await client.getFileAtRevision({
    ...arguments_,
    path: snapshot.baseRevision.policyPath,
    ref: requestedBaseSha
  });
  if (
    typeof policySource !== "string" ||
    Buffer.byteLength(policySource, "utf8") > MAX_AUDIT_SOURCE_BYTES ||
    sha256Hex(policySource) !== snapshot.baseRevision.policySha256
  ) {
    throw failure("evidence-policy-mismatch");
  }
  const policy = policyFacts(policySource);
  if (JSON.stringify(policy.requiredChecks) !== JSON.stringify(snapshot.policy.requiredChecks)) {
    throw failure("evidence-policy-mismatch");
  }
  const endingBranch = validateBranch(
    await client.getBranch({ ...arguments_, branch: repository.defaultBranch }),
    repository.defaultBranch
  );
  if (endingBranch.sha !== requestedBaseSha) {
    throw failure("evidence-revision-not-stable");
  }
  const metrics = client.getRequestMetrics?.();
  if (metrics === undefined) {
    throw failure("request-metrics-unavailable");
  }
  if (
    !Number.isSafeInteger(metrics.requestAttempts) ||
    metrics.requestAttempts < 1 ||
    metrics.requestAttempts > 768 ||
    !Number.isSafeInteger(metrics.retryAttempts) ||
    metrics.retryAttempts < 0 ||
    metrics.retryAttempts > metrics.requestAttempts
  ) {
    throw failure("request-metrics-invalid");
  }
  return {
    snapshot,
    repository,
    policySource,
    initialBranchSha: requestedBaseSha,
    endingBranchSha: endingBranch.sha,
    ...metrics
  };
}

export async function collectRepositoryAuditSnapshot(
  owner: string,
  repo: string,
  client: AuditGitHubClient,
  options: GitHubAuditCollectorOptions = {}
): Promise<AuditSnapshot> {
  return collectRepositoryAuditSnapshotInternal(owner, repo, client, options);
}

async function collectRepositoryAuditSnapshotInternal(
  owner: string,
  repo: string,
  client: AuditGitHubClient,
  options: GitHubAuditCollectorOptions = {},
  context?: SnapshotCollectionContext
): Promise<AuditSnapshot> {
  const normalizedOwner = safeRepositoryName(owner, "unknown");
  const normalizedRepo = safeRepositoryName(repo, "unknown");
  let policyPath = ".reviewready.yml";
  let defaultBranch = "unknown";
  let baseSha = "0".repeat(40);

  try {
    if (normalizedOwner === "unknown" || normalizedRepo === "unknown") {
      throw failure("repository-identity-invalid");
    }
    policyPath = safePolicyPath(options.policyPath);
    const protectedWorkflowOptions = options.protectedWorkflowPaths ?? [];
    const trustedWorkflowOptions = options.trustedWorkflowPaths ?? [];
    if (
      protectedWorkflowOptions.length > MAX_AUDIT_WORKFLOW_ROOTS ||
      trustedWorkflowOptions.length > MAX_AUDIT_WORKFLOW_ROOTS
    ) {
      throw failure("workflow-root-limit");
    }
    const arguments_ = { owner: normalizedOwner, repo: normalizedRepo };
    const repository = validateRepositoryMetadata(
      await client.getRepository(arguments_),
      normalizedOwner,
      normalizedRepo
    );
    if (context !== undefined) {
      context.repository = repository;
    }
    const requestedBranch = options.branch;
    if (
      requestedBranch !== undefined &&
      (requestedBranch.length === 0 ||
        requestedBranch.length > MAX_AUDIT_REPOSITORY_TEXT ||
        /[\p{Control}\p{Format}\u2028\u2029]/u.test(requestedBranch))
    ) {
      throw failure("default-branch-invalid");
    }
    defaultBranch = repository.defaultBranch;
    if (
      defaultBranch.length === 0 ||
      defaultBranch.length > MAX_AUDIT_REPOSITORY_TEXT ||
      /[\p{Control}\p{Format}\u2028\u2029]/u.test(defaultBranch)
    ) {
      throw failure("default-branch-invalid");
    }
    if (requestedBranch !== undefined && requestedBranch !== repository.defaultBranch) {
      throw failure("non-default-branch");
    }

    const initialBranch = validateBranch(
      await client.getBranch({ ...arguments_, branch: defaultBranch }),
      defaultBranch
    );
    baseSha = initialBranch.sha;
    if (
      options.revision !== undefined &&
      (!validSha(options.revision) || options.revision.toLowerCase() !== baseSha)
    ) {
      throw failure("requested-revision-mismatch");
    }
    const firstSettings = await collectMutableSettings(
      client,
      arguments_,
      defaultBranch,
      repository.ownerType,
      repository.id
    );
    const [workflowEntries, policySource] = await Promise.all([
      client.listWorkflowFiles({ ...arguments_, ref: baseSha }),
      client.getFileAtRevision({ ...arguments_, path: policyPath, ref: baseSha })
    ]);

    if (
      typeof policySource !== "string" ||
      Buffer.byteLength(policySource, "utf8") > MAX_AUDIT_SOURCE_BYTES
    ) {
      throw failure("policy-source-limit");
    }
    if (workflowEntries.length > MAX_AUDIT_WORKFLOW_SOURCES) {
      throw failure("workflow-count-limit");
    }
    if (firstSettings.rulesets.length > MAX_AUDIT_RULESETS) {
      throw failure("ruleset-count-limit");
    }
    const rulesetIds = new Set<number>();
    for (const ruleset of firstSettings.rulesets) {
      if (!Number.isSafeInteger(ruleset.id) || ruleset.id < 1 || rulesetIds.has(ruleset.id)) {
        throw failure("ruleset-duplicate");
      }
      rulesetIds.add(ruleset.id);
    }
    const workflowEntryPaths = new Set<string>();
    const workflowPaths = uniqueSorted(
      workflowEntries.map((entry) => {
        if (entry.type !== "file") {
          throw failure("workflow-entry-not-file");
        }
        const path = safeWorkflowPath(entry.path);
        if (workflowEntryPaths.has(path)) {
          throw failure("workflow-entry-duplicate");
        }
        workflowEntryPaths.add(path);
        return path;
      }),
      (path) => path
    );
    const protectedPaths = new Set(protectedWorkflowOptions.map((path) => safeWorkflowPath(path)));
    const trustedPaths = new Set(trustedWorkflowOptions.map((path) => safeWorkflowPath(path)));
    const sources = await mapWithConcurrency(
      workflowPaths,
      MAX_AUDIT_COLLECTION_CONCURRENCY,
      async (path) => {
        const source = await client.getFileAtRevision({ ...arguments_, path, ref: baseSha });
        if (
          typeof source !== "string" ||
          Buffer.byteLength(source, "utf8") > MAX_AUDIT_SOURCE_BYTES
        ) {
          throw failure("workflow-source-limit");
        }
        return {
          path,
          revisionSha: baseSha,
          protectedFromPullRequest: false,
          trustedRoot: false,
          source
        };
      }
    );
    const policy = policyFacts(policySource);
    const secondSettings = await collectMutableSettings(
      client,
      arguments_,
      defaultBranch,
      repository.ownerType,
      repository.id
    );
    const settingsMismatch =
      canonicalMutableSettings(firstSettings) !== canonicalMutableSettings(secondSettings);
    const missing = new Set<string>();
    const observedWorkflowPaths = new Set(workflowPaths);
    for (const root of [...protectedPaths, ...trustedPaths]) {
      if (!observedWorkflowPaths.has(root)) {
        missing.add("workflow-root-not-observed");
      }
    }
    if (workflowPaths.length > 0 && protectedPaths.size === 0) {
      missing.add("workflow-protection-root");
    }
    if (workflowPaths.length > 0 && trustedPaths.size === 0) {
      missing.add("trusted-workflow-root");
    }
    if (settingsMismatch) {
      missing.add("settings-observation-mismatch");
    } else if (hasUnknownMutableAuthority(firstSettings)) {
      missing.add("settings-authority-incomplete");
    }

    const endingRepository = validateRepositoryMetadata(
      await client.getRepository(arguments_),
      normalizedOwner,
      normalizedRepo
    );
    const endingBranch = validateBranch(
      await client.getBranch({ ...arguments_, branch: defaultBranch }),
      defaultBranch
    );
    if (
      endingRepository.owner.toLowerCase() !== repository.owner.toLowerCase() ||
      endingRepository.name.toLowerCase() !== repository.name.toLowerCase() ||
      endingRepository.defaultBranch !== repository.defaultBranch ||
      endingBranch.sha !== baseSha ||
      endingRepository.ownerType !== repository.ownerType ||
      endingRepository.visibility !== repository.visibility
    ) {
      missing.add("base-revision-changed");
    }
    if (endingRepository.id !== repository.id) {
      missing.add("repository-identity-changed");
    }
    return {
      version: 1,
      repository: {
        owner: repository.owner,
        name: repository.name,
        defaultBranch
      },
      baseRevision: {
        sha: baseSha,
        policyPath,
        policyRevisionSha: baseSha,
        policySha256: sha256Hex(policySource),
        policyLoadedFromBase: true
      },
      policy: { requiredChecks: policy.requiredChecks, workflowPaths },
      completeness: { complete: missing.size === 0, missing: [...missing].sort() },
      branchProtection: settingsMismatch ? null : firstSettings.branchProtection,
      rulesets: settingsMismatch
        ? []
        : [...firstSettings.rulesets].sort((left, right) => left.id - right.id),
      tagProtection: settingsMismatch
        ? { known: false, allowsDeletion: true, allowsUpdate: true }
        : firstSettings.tagProtection,
      workflows: sources.sort((left, right) => compareText(left.path, right.path))
    };
  } catch (error) {
    return incompleteSnapshot(normalizedOwner, normalizedRepo, defaultBranch, baseSha, policyPath, [
      isCollectionFailure(error) ? error.code : "collector-error"
    ]);
  }
}
