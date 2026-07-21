import { z } from "zod";

import {
  checkConclusions,
  type CheckConclusion,
  type Policy,
  type PullRequestInput,
  type ReviewState
} from "./domain.js";
import { PlatformError, ReviewReadyError } from "./errors.js";
import { normalizeInput, normalizeRepositoryPath } from "./input.js";
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

export interface GitHubReview {
  readonly login: string | null;
  readonly state: string;
}

interface RepositoryArguments {
  readonly owner: string;
  readonly repo: string;
}

interface PullRequestArguments extends RepositoryArguments {
  readonly pullNumber: number;
}

export interface GitHubGateway {
  getFileAtRevision(
    arguments_: RepositoryArguments & { readonly path: string; readonly ref: string }
  ): Promise<string>;
  listPullRequestFiles(arguments_: PullRequestArguments): Promise<readonly string[]>;
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
    const [policySource, changedFiles, checkRuns, rawReviews, linkedIssues] = await Promise.all([
      gateway.getFileAtRevision({
        owner,
        repo,
        path: policyPath,
        ref: pullRequest.base.sha
      }),
      gateway.listPullRequestFiles(common),
      gateway.listCheckRuns({ owner, repo, ref: pullRequest.head.sha }),
      gateway.listPullRequestReviews(common),
      gateway.listClosingIssueNumbers(common)
    ]);

    const reviewsWithState = rawReviews.flatMap((review) => {
      const state = reviewState(review.state);
      return review.login === null || state === undefined ? [] : [{ login: review.login, state }];
    });
    const logins = [...new Set(reviewsWithState.map((review) => review.login))];
    const permissions = new Map(
      await Promise.all(
        logins.map(
          async (login) =>
            [login, await gateway.getRepositoryPermission({ owner, repo, login })] as const
        )
      )
    );

    const input = normalizeInput({
      version: 1,
      changedFiles,
      body: pullRequest.body ?? "",
      labels: pullRequest.labels.map((label) => label.name),
      linkedIssues,
      checks: checkRuns.flatMap((check) =>
        isConclusion(check.conclusion)
          ? [
              {
                name: check.name,
                conclusion: check.conclusion,
                ...(check.app === undefined ? {} : { app: check.app })
              }
            ]
          : []
      ),
      reviews: reviewsWithState.map((review) => ({
        ...review,
        maintainer: isMaintainerPermission(permissions.get(review.login) ?? "none")
      }))
    });

    return {
      policy: parsePolicy(policySource),
      input,
      context: {
        owner,
        repo,
        pullNumber: pullRequest.number,
        baseSha: pullRequest.base.sha,
        headSha: pullRequest.head.sha
      }
    };
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
