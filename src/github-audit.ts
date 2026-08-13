import { createHash } from "node:crypto";

import { MAX_AUDIT_RULESETS, type AuditSnapshot } from "./audit.js";
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
  listRulesets: (arguments_: AuditRepositoryArguments) => Promise<readonly AuditRuleset[]>;
  listWorkflowFiles: (
    arguments_: AuditRepositoryArguments & { readonly ref: string }
  ) => Promise<readonly AuditWorkflowFile[]>;
  getFileAtRevision: (
    arguments_: AuditRepositoryArguments & { readonly path: string; readonly ref: string }
  ) => Promise<unknown>;
  getTagProtection: (arguments_: AuditRepositoryArguments) => Promise<AuditTagProtection>;
}

export interface GitHubAuditCollectorOptions {
  readonly branch?: string | undefined;
  readonly policyPath?: string | undefined;
  readonly protectedWorkflowPaths?: readonly string[] | undefined;
  readonly trustedWorkflowPaths?: readonly string[] | undefined;
}

interface CollectionFailure {
  readonly code: string;
}

class CollectionFailureError extends Error implements CollectionFailure {
  public constructor(public readonly code: string) {
    super(code);
    this.name = "CollectionFailureError";
  }
}

const SHA = /^[0-9a-f]{40}$/iu;
const REPOSITORY_NAME = /^[A-Za-z0-9._-]{1,100}$/u;
const WORKFLOW_PATH = /^\.github\/workflows\/[^/]+\.(?:yml|yaml)$/iu;

function failure(code: string): CollectionFailureError {
  return new CollectionFailureError(code);
}

function isCollectionFailure(value: unknown): value is CollectionFailure {
  return value instanceof CollectionFailureError;
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
    typeof (value as { readonly defaultBranch?: unknown }).defaultBranch !== "string"
  ) {
    throw failure("repository-metadata-invalid");
  }
  const owner = (value as { readonly owner: string }).owner;
  const name = (value as { readonly name: string }).name;
  const defaultBranch = (value as { readonly defaultBranch: string }).defaultBranch;
  const id = (value as { readonly id?: unknown }).id;
  if (
    !REPOSITORY_NAME.test(owner) ||
    !REPOSITORY_NAME.test(name) ||
    defaultBranch.length === 0 ||
    defaultBranch.length > MAX_AUDIT_REPOSITORY_TEXT ||
    /[\p{Control}\p{Format}\u2028\u2029]/u.test(defaultBranch) ||
    !Number.isSafeInteger(id) ||
    (id as number) < 1
  ) {
    throw failure("repository-metadata-invalid");
  }
  if (
    (expectedOwner !== undefined && owner.toLowerCase() !== expectedOwner.toLowerCase()) ||
    (expectedName !== undefined && name.toLowerCase() !== expectedName.toLowerCase())
  ) {
    throw failure("repository-identity-mismatch");
  }
  return { owner, name, defaultBranch, id: id as number };
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
  return { name, sha };
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

export async function collectRepositoryAuditSnapshot(
  owner: string,
  repo: string,
  client: AuditGitHubClient,
  options: GitHubAuditCollectorOptions = {}
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
    const [branchProtection, rulesets, workflowEntries, tagProtection, policySource] =
      await Promise.all([
        client.getBranchProtection({ ...arguments_, branch: defaultBranch }),
        client.listRulesets(arguments_),
        client.listWorkflowFiles({ ...arguments_, ref: baseSha }),
        client.getTagProtection(arguments_),
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
    if (rulesets.length > MAX_AUDIT_RULESETS) {
      throw failure("ruleset-count-limit");
    }
    const rulesetIds = new Set<number>();
    for (const ruleset of rulesets) {
      if (!Number.isSafeInteger(ruleset.id) || ruleset.id < 0 || rulesetIds.has(ruleset.id)) {
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
          protectedFromPullRequest: protectedPaths.has(path),
          trustedRoot: trustedPaths.has(path),
          source
        };
      }
    );
    const policy = policyFacts(policySource);
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
      endingRepository.defaultBranch !== repository.defaultBranch ||
      endingBranch.sha !== baseSha
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
      branchProtection,
      rulesets: [...rulesets].sort((left, right) => left.id - right.id),
      tagProtection,
      workflows: sources.sort((left, right) => compareText(left.path, right.path))
    };
  } catch (error) {
    return incompleteSnapshot(normalizedOwner, normalizedRepo, defaultBranch, baseSha, policyPath, [
      isCollectionFailure(error) ? error.code : "collector-error"
    ]);
  }
}
