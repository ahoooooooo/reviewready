import { getOctokit } from "@actions/github";

import type { GitHubCheckRun, GitHubGateway, GitHubPermission, GitHubReview } from "./github.js";

type Octokit = ReturnType<typeof getOctokit>;

const permissions = new Set<GitHubPermission>([
  "admin",
  "maintain",
  "write",
  "triage",
  "read",
  "none"
]);

function permission(value: string): GitHubPermission {
  return permissions.has(value as GitHubPermission) ? (value as GitHubPermission) : "none";
}

export async function collectCheckRunPages(
  fetchPage: (page: number) => Promise<readonly GitHubCheckRun[]>
): Promise<GitHubCheckRun[]> {
  const result: GitHubCheckRun[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const runs = await fetchPage(page);
    result.push(...runs);
    if (runs.length < 100) {
      break;
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
    return response.data.check_runs.map((run) => ({
      name: run.name,
      conclusion: run.conclusion,
      ...(run.app?.slug === undefined ? {} : { app: run.app.slug })
    }));
  });
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
      return files.map((file) => file.filename);
    },
    listCheckRuns: ({ owner, repo, ref }) => allCheckRuns(octokit, owner, repo, ref),
    listPullRequestReviews: async ({ owner, repo, pullNumber }) => {
      const reviews = await octokit.paginate(octokit.rest.pulls.listReviews, {
        owner,
        repo,
        pull_number: pullNumber,
        per_page: 100
      });
      return reviews.map((review): GitHubReview => ({
        login: review.user?.login ?? null,
        state: review.state
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
            };
          } | null;
        } | null;
      }>(
        `query ReviewReadyClosingIssues($owner: String!, $repo: String!, $pullNumber: Int!) {
          repository(owner: $owner, name: $repo) {
            pullRequest(number: $pullNumber) {
              closingIssuesReferences(first: 100) {
                nodes { number }
              }
            }
          }
        }`,
        { owner, repo, pullNumber }
      );
      return (
        response.repository?.pullRequest?.closingIssuesReferences.nodes.flatMap((issue) =>
          issue === null ? [] : [issue.number]
        ) ?? []
      );
    }
  };
}
