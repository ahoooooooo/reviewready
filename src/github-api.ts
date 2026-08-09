import { getOctokit } from "@actions/github";

import type { GitHubCheckRun, GitHubGateway, GitHubPermission, GitHubReview } from "./github.js";
import { PlatformError } from "./errors.js";

type Octokit = ReturnType<typeof getOctokit>;

const permissions = new Set<GitHubPermission>([
  "admin",
  "maintain",
  "write",
  "triage",
  "read",
  "none"
]);

const CHECK_RUN_PAGE_SIZE = 100;
const MAX_CHECK_RUNS = 1000;
const MAX_PULL_REQUEST_FILES = 3000;
const MAX_REVIEWS = 1000;
const MAX_CLOSING_ISSUES = 100;

function incompleteEvidence(kind: string, limit: number): PlatformError {
  return new PlatformError(
    "GITHUB_EVIDENCE_INCOMPLETE",
    `GitHub returned an incomplete or oversized ${kind} set; ReviewReady cannot evaluate it safely (limit: ${String(limit)}).`
  );
}

function permission(value: string): GitHubPermission {
  return permissions.has(value as GitHubPermission) ? (value as GitHubPermission) : "none";
}

export async function collectCheckRunPages(
  fetchPage: (page: number) => Promise<readonly GitHubCheckRun[]>
): Promise<GitHubCheckRun[]> {
  const result: GitHubCheckRun[] = [];
  for (let page = 1; page <= MAX_CHECK_RUNS / CHECK_RUN_PAGE_SIZE; page += 1) {
    const runs = await fetchPage(page);
    result.push(...runs);
    if (runs.length < CHECK_RUN_PAGE_SIZE) {
      return result;
    }
    if (page === MAX_CHECK_RUNS / CHECK_RUN_PAGE_SIZE) {
      const extraRuns = await fetchPage(page + 1);
      if (extraRuns.length > 0) {
        throw incompleteEvidence("check runs", MAX_CHECK_RUNS);
      }
      return result;
    }
  }
  return result;
}

async function allCheckRuns(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref: string
): Promise<GitHubCheckRun[]> {
  return collectCheckRunPages(async (page) => {
    const response = await octokit.rest.checks.listForRef({
      owner,
      repo,
      ref,
      filter: "latest",
      per_page: 100,
      page
    });
    if (response.data.total_count > MAX_CHECK_RUNS) {
      throw incompleteEvidence("check runs", MAX_CHECK_RUNS);
    }
    return response.data.check_runs.map((run) => ({
      name: run.name,
      conclusion: run.conclusion,
      ...(run.app?.slug === undefined ? {} : { app: run.app.slug })
    }));
  });
}

function commitStatusConclusion(value: string): "success" | "failure" | undefined {
  switch (value.toLocaleLowerCase("en-US")) {
    case "success":
      return "success";
    case "failure":
    case "error":
      return "failure";
    default:
      return undefined;
  }
}

async function allCheckEvidence(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref: string
): Promise<GitHubCheckRun[]> {
  const [checkRuns, statusResponse] = await Promise.all([
    allCheckRuns(octokit, owner, repo, ref),
    octokit.rest.repos.getCombinedStatusForRef({ owner, repo, ref })
  ]);
  const statuses = statusResponse.data.statuses.flatMap((status) => {
    const name = status.context;
    const conclusion = commitStatusConclusion(status.state);
    return typeof name !== "string" || conclusion === undefined ? [] : [{ name, conclusion }];
  });
  return [...checkRuns, ...statuses];
}

export function createGitHubGateway(token: string): GitHubGateway {
  const octokit = getOctokit(token);

  return {
    getFileAtRevision: async ({ owner, repo, path, ref }) => {
      const response = await octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
        owner,
        repo,
        path,
        ref,
        headers: { accept: "application/vnd.github.raw+json" }
      });
      if (typeof response.data !== "string") {
        throw new TypeError("GitHub did not return raw file content.");
      }
      return response.data;
    },
    listPullRequestFiles: async ({ owner, repo, pullNumber }) => {
      const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
        owner,
        repo,
        pull_number: pullNumber,
        per_page: 100
      });
      if (files.length >= MAX_PULL_REQUEST_FILES) {
        throw incompleteEvidence("pull-request files", MAX_PULL_REQUEST_FILES);
      }
      return files.map((file) => file.filename);
    },
    listCheckRuns: ({ owner, repo, ref }) => allCheckEvidence(octokit, owner, repo, ref),
    listPullRequestReviews: async ({ owner, repo, pullNumber }) => {
      const reviews = await octokit.paginate(octokit.rest.pulls.listReviews, {
        owner,
        repo,
        pull_number: pullNumber,
        per_page: 100
      });
      if (reviews.length >= MAX_REVIEWS) {
        throw incompleteEvidence("pull-request reviews", MAX_REVIEWS);
      }
      return reviews.map((review): GitHubReview => ({
        login: review.user?.login ?? null,
        state: review.state,
        ...(typeof review.submitted_at === "string" ? { submittedAt: review.submitted_at } : {})
      }));
    },
    getRepositoryPermission: async ({ owner, repo, login }) => {
      const response = await octokit.rest.repos.getCollaboratorPermissionLevel({
        owner,
        repo,
        username: login
      });
      return permission(response.data.permission);
    },
    listClosingIssueNumbers: async ({ owner, repo, pullNumber }) => {
      const response = await octokit.graphql<{
        repository: {
          pullRequest: {
            closingIssuesReferences: {
              nodes: readonly ({ readonly number: number } | null)[];
              pageInfo?: { readonly hasNextPage: boolean };
            };
          } | null;
        } | null;
      }>(
        `query ReviewReadyClosingIssues($owner: String!, $repo: String!, $pullNumber: Int!) {
          repository(owner: $owner, name: $repo) {
            pullRequest(number: $pullNumber) {
              closingIssuesReferences(first: 100) {
                nodes { number }
                pageInfo { hasNextPage }
              }
            }
          }
        }`,
        { owner, repo, pullNumber }
      );
      const references = response.repository?.pullRequest?.closingIssuesReferences;
      if (references === undefined) {
        throw new PlatformError(
          "GITHUB_EVIDENCE_UNAVAILABLE",
          "GitHub did not return the pull request's closing issue references."
        );
      }
      if (references.pageInfo?.hasNextPage !== false) {
        throw incompleteEvidence("closing issue references", MAX_CLOSING_ISSUES);
      }
      return references.nodes.flatMap((issue) => (issue === null ? [] : [issue.number]));
    }
  };
}
