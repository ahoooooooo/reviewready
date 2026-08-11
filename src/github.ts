import { z } from "zod";

import {
  checkConclusions,
  type CheckConclusion,
  type Policy,
  type PullRequestInput,
  type Requirement,
  type ReviewState
} from "./domain.js";
import { PlatformError, ReviewReadyError } from "./errors.js";
import { normalizeInput, normalizeRepositoryPath } from "./input.js";
import { matchesRule } from "./matcher.js";
import { parsePolicy } from "./policy.js";

const shaPattern = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;

const pullRequestEventSchema = z.object({
  repository: z.object({
    name: z.string().min(1).max(100),
    owner: z.object({
      login: z.string().min(1).max(100)
    })
  }),
  pull_request: z.object({
    number: z.number().int().positive(),
    body: z.string().nullable(),
    labels: z.array(z.object({ name: z.string().min(1).max(500) })).max(100),
    base: z.object({ sha: z.string().regex(shaPattern) }),
    head: z.object({ sha: z.string().regex(shaPattern) })
  })
});

export type GitHubPermission = "admin" | "maintain" | "write" | "triage" | "read" | "none";

export interface GitHubCheckRun {
  readonly name: string;
  readonly conclusion: string | null;
  readonly app?: string | undefined;
}

export interface GitHubChangedFile {
  readonly filename: string;
  readonly previousFilename?: string | undefined;
}

export interface GitHubReview {
  readonly login: string | null;
  readonly state: string;
  readonly submittedAt?: string | undefined;
}

export interface GitHubPullRequestSnapshot {
  readonly number: number;
  readonly baseSha: string;
  readonly headSha: string;
  readonly updatedAt: string;
  readonly body: string | null;
  readonly labels: readonly string[];
}

interface RepositoryArguments {
  readonly owner: string;
  readonly repo: string;
}

interface PullRequestArguments extends RepositoryArguments {
  readonly pullNumber: number;
}

export interface GitHubGateway {
  getPullRequestSnapshot(arguments_: PullRequestArguments): Promise<GitHubPullRequestSnapshot>;
  getFileAtRevision(
    arguments_: RepositoryArguments & { readonly path: string; readonly ref: string }
  ): Promise<string>;
  listPullRequestFiles(
    arguments_: PullRequestArguments
  ): Promise<readonly (string | GitHubChangedFile)[]>;
  listCheckRuns(
    arguments_: RepositoryArguments & { readonly ref: string }
  ): Promise<readonly GitHubCheckRun[]>;
  listPullRequestReviews(arguments_: PullRequestArguments): Promise<readonly GitHubReview[]>;
  getRepositoryPermission(
    arguments_: RepositoryArguments & { readonly login: string }
  ): Promise<GitHubPermission>;
  listClosingIssueNumbers(arguments_: PullRequestArguments): Promise<readonly number[]>;
}

export interface LoadedGitHubPullRequest {
  readonly policy: Policy;
  readonly input: PullRequestInput;
  readonly context: {
    readonly owner: string;
    readonly repo: string;
    readonly pullNumber: number;
    readonly baseSha: string;
    readonly headSha: string;
  };
}

function isConclusion(value: string | null): value is CheckConclusion {
  return value !== null && checkConclusions.some((conclusion) => conclusion === value);
}

function reviewState(value: string): ReviewState | undefined {
  switch (value.toLocaleUpperCase("en-US")) {
    case "APPROVED":
      return "approved";
    case "CHANGES_REQUESTED":
      return "changes_requested";
    case "COMMENTED":
      return "commented";
    case "DISMISSED":
      return "dismissed";
    default:
      return undefined;
  }
}

function isMaintainerPermission(permission: GitHubPermission): boolean {
  return permission === "admin" || permission === "maintain" || permission === "write";
}

function splitChangedFiles(files: readonly (string | GitHubChangedFile)[]): {
  readonly changedFiles: readonly string[];
  readonly previousChangedFiles: readonly string[];
} {
  const changedFiles: string[] = [];
  const previousChangedFiles: string[] = [];
  for (const file of files) {
    if (typeof file === "string") {
      changedFiles.push(file);
      continue;
    }
    changedFiles.push(file.filename);
    if (file.previousFilename !== undefined) {
      previousChangedFiles.push(file.previousFilename);
    }
  }
  return { changedFiles, previousChangedFiles };
}

const MAX_PERMISSION_LOOKUPS = 4;
const MAX_SNAPSHOT_ATTEMPTS = 2;

const pullRequestSnapshotSchema = z.object({
  number: z.number().int().positive(),
  baseSha: z.string().regex(shaPattern),
  headSha: z.string().regex(shaPattern),
  updatedAt: z.iso.datetime({ offset: true }),
  body: z.string().max(1_000_000).nullable(),
  labels: z.array(z.string().min(1).max(500)).max(100)
});

function parseSnapshot(
  value: GitHubPullRequestSnapshot,
  expectedPullNumber?: number
): GitHubPullRequestSnapshot {
  const parsed = pullRequestSnapshotSchema.safeParse(value);
  if (!parsed.success) {
    throw new PlatformError(
      "GITHUB_SNAPSHOT_INVALID",
      "GitHub returned an invalid pull request snapshot."
    );
  }
  if (expectedPullNumber !== undefined && parsed.data.number !== expectedPullNumber) {
    throw new PlatformError(
      "GITHUB_SNAPSHOT_INVALID",
      "GitHub returned a snapshot for a different pull request."
    );
  }
  return parsed.data;
}

function sameSnapshot(
  first: GitHubPullRequestSnapshot,
  second: GitHubPullRequestSnapshot
): boolean {
  const firstLabels = [...first.labels].sort((left, right) => left.localeCompare(right, "en-US"));
  const secondLabels = [...second.labels].sort((left, right) => left.localeCompare(right, "en-US"));
  return (
    first.number === second.number &&
    first.baseSha === second.baseSha &&
    first.headSha === second.headSha &&
    first.updatedAt === second.updatedAt &&
    first.body === second.body &&
    firstLabels.length === secondLabels.length &&
    firstLabels.every((label, index) => label === secondLabels[index])
  );
}

function requiredEvidenceTypes(policy: Policy, input: PullRequestInput): Set<Requirement["type"]> {
  const types = new Set<Requirement["type"]>();
  for (const rule of policy.rules) {
    if (matchesRule(rule, input)) {
      for (const requirement of rule.require) {
        types.add(requirement.type);
      }
    }
  }
  return types;
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  limit: number,
  mapper: (value: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = Array.from({ length: values.length });
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) {
        return;
      }
      results[index] = await mapper(values[index] as T);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()));
  return results;
}

export async function loadGitHubPullRequest(
  event: unknown,
  requestedPolicyPath: string,
  gateway: GitHubGateway
): Promise<LoadedGitHubPullRequest> {
  const parsedEvent = pullRequestEventSchema.safeParse(event);
  if (!parsedEvent.success) {
    throw new PlatformError(
      "GITHUB_EVENT_INVALID",
      "The action requires a valid pull_request event payload."
    );
  }

  const policyPath = normalizeRepositoryPath(requestedPolicyPath);
  const {
    repository: {
      name: repo,
      owner: { login: owner }
    },
    pull_request: pullRequest
  } = parsedEvent.data;
  const common = { owner, repo, pullNumber: pullRequest.number };

  try {
    for (let attempt = 0; attempt < MAX_SNAPSHOT_ATTEMPTS; attempt += 1) {
      const initialSnapshot = parseSnapshot(
        await gateway.getPullRequestSnapshot(common),
        pullRequest.number
      );
      const policy = parsePolicy(
        await gateway.getFileAtRevision({
          owner,
          repo,
          path: policyPath,
          ref: initialSnapshot.baseSha
        })
      );
      const filePaths = splitChangedFiles(await gateway.listPullRequestFiles(common));
      const preliminaryInput = normalizeInput({
        version: 1,
        changedFiles: filePaths.changedFiles,
        ...(filePaths.previousChangedFiles.length === 0
          ? {}
          : { previousChangedFiles: filePaths.previousChangedFiles }),
        body: initialSnapshot.body ?? "",
        labels: initialSnapshot.labels,
        linkedIssues: [],
        checks: [],
        reviews: []
      });
      const evidenceTypes = requiredEvidenceTypes(policy, preliminaryInput);
      const needsChecks = evidenceTypes.has("check");
      const needsReviews = evidenceTypes.has("maintainer_review");
      const needsLinkedIssues = evidenceTypes.has("linked_issue");

      const [checkRuns, rawReviews, linkedIssues] = await Promise.all([
        needsChecks
          ? gateway.listCheckRuns({ owner, repo, ref: initialSnapshot.headSha })
          : Promise.resolve<readonly GitHubCheckRun[]>([]),
        needsReviews
          ? gateway.listPullRequestReviews(common)
          : Promise.resolve<readonly GitHubReview[]>([]),
        needsLinkedIssues
          ? gateway.listClosingIssueNumbers(common)
          : Promise.resolve<readonly number[]>([])
      ]);

      const reviewsWithState = rawReviews.flatMap((review) => {
        const state = reviewState(review.state);
        return review.login === null || state === undefined
          ? []
          : [
              {
                login: review.login,
                state,
                ...(review.submittedAt === undefined ? {} : { submittedAt: review.submittedAt })
              }
            ];
      });
      const logins = [...new Set(reviewsWithState.map((review) => review.login))];
      const permissionEntries = await mapWithConcurrency(
        logins,
        MAX_PERMISSION_LOOKUPS,
        async (login) =>
          [login, await gateway.getRepositoryPermission({ owner, repo, login })] as const
      );
      const permissions = new Map(permissionEntries);

      const input = normalizeInput({
        ...preliminaryInput,
        linkedIssues,
        checks: checkRuns.map((check) => ({
          name: check.name,
          conclusion: isConclusion(check.conclusion) ? check.conclusion : null,
          ...(check.app === undefined ? {} : { app: check.app })
        })),
        reviews: reviewsWithState.map((review) => ({
          ...review,
          maintainer: isMaintainerPermission(permissions.get(review.login) ?? "none")
        }))
      });
      const finalSnapshot = parseSnapshot(
        await gateway.getPullRequestSnapshot(common),
        pullRequest.number
      );

      if (!sameSnapshot(initialSnapshot, finalSnapshot)) {
        if (attempt + 1 < MAX_SNAPSHOT_ATTEMPTS) {
          continue;
        }
        throw new PlatformError(
          "GITHUB_SNAPSHOT_CHANGED",
          "The pull request changed while evidence was collected; retry the evaluation."
        );
      }

      return {
        policy,
        input,
        context: {
          owner,
          repo,
          pullNumber: pullRequest.number,
          baseSha: initialSnapshot.baseSha,
          headSha: initialSnapshot.headSha
        }
      };
    }

    throw new PlatformError(
      "GITHUB_SNAPSHOT_CHANGED",
      "The pull request changed while evidence was collected; retry the evaluation."
    );
  } catch (error) {
    if (error instanceof ReviewReadyError) {
      throw error;
    }
    throw new PlatformError(
      "GITHUB_API_FAILED",
      "GitHub evidence could not be loaded with the provided token and permissions.",
      { cause: error }
    );
  }
}
