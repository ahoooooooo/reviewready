import { getOctokit } from "@actions/github";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { collectCheckRunPages, createGitHubGateway } from "../src/github-api.js";
import type { GitHubCheckRun } from "../src/github.js";

vi.mock("@actions/github", () => ({ getOctokit: vi.fn() }));

const completed = (name: string): GitHubCheckRun => ({
  name,
  conclusion: "success"
});

const listFiles = vi.fn();
const listReviews = vi.fn();

function fakeOctokit(overrides: Record<string, unknown> = {}): ReturnType<typeof getOctokit> {
  const client = {
    request: vi.fn(() => Promise.resolve({ data: "base policy" })),
    paginate: vi.fn((method: unknown) =>
      Promise.resolve(
        method === listFiles
          ? [{ filename: "src/index.ts" }]
          : [
              {
                user: { login: "maintainer" },
                state: "APPROVED",
                submitted_at: "2026-08-10T10:00:00Z"
              },
              {
                user: null,
                state: "COMMENTED"
              }
            ]
      )
    ),
    graphql: vi.fn(() =>
      Promise.resolve({
        repository: {
          pullRequest: {
            closingIssuesReferences: {
              nodes: [{ number: 7 }, null],
              pageInfo: { hasNextPage: false }
            }
          }
        }
      })
    ),
    rest: {
      checks: {
        listForRef: vi.fn(() =>
          Promise.resolve({
            data: {
              total_count: 2,
              check_runs: [
                {
                  name: "test",
                  conclusion: "success",
                  app: { slug: "github-actions" }
                },
                {
                  name: "without-app",
                  conclusion: null,
                  app: null
                }
              ]
            }
          })
        )
      },
      pulls: { listFiles, listReviews },
      repos: {
        getCombinedStatusForRef: vi.fn(() =>
          Promise.resolve({
            data: { statuses: [] }
          })
        ),
        getCollaboratorPermissionLevel: vi.fn(() =>
          Promise.resolve({ data: { permission: "write" } })
        )
      }
    },
    ...overrides
  };
  return client as unknown as ReturnType<typeof getOctokit>;
}

describe("collectCheckRunPages", () => {
  it("continues after a full page and stops at the first partial page", async () => {
    const fetchPage = vi.fn((page: number) =>
      Promise.resolve(
        page === 1
          ? Array.from({ length: 100 }, (_, index) => completed(`check-${String(index)}`))
          : [completed("last")]
      )
    );

    const runs = await collectCheckRunPages(fetchPage);

    expect(runs).toHaveLength(101);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage).toHaveBeenNthCalledWith(1, 1);
    expect(fetchPage).toHaveBeenNthCalledWith(2, 2);
  });

  it("accepts exactly 1,000 runs only after confirming there is no next page", async () => {
    const fetchPage = vi.fn((page: number) =>
      Promise.resolve(page <= 10 ? Array.from({ length: 100 }, () => completed("check")) : [])
    );

    const runs = await collectCheckRunPages(fetchPage);

    expect(runs).toHaveLength(1000);
    expect(fetchPage).toHaveBeenCalledTimes(11);
  });

  it("fails closed when a check-run page exists beyond the safe boundary", async () => {
    const fetchPage = vi.fn(() =>
      Promise.resolve(Array.from({ length: 100 }, () => completed("check")))
    );

    await expect(collectCheckRunPages(fetchPage)).rejects.toMatchObject({
      code: "GITHUB_EVIDENCE_INCOMPLETE"
    });
  });
});

describe("createGitHubGateway", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps every read-only GitHub API response into the gateway contract", async () => {
    const client = fakeOctokit();
    vi.mocked(getOctokit).mockReturnValue(client);
    const api = createGitHubGateway("secret");

    await expect(
      api.getFileAtRevision({
        owner: "octocat",
        repo: "demo",
        path: ".reviewready.yml",
        ref: "base"
      })
    ).resolves.toBe("base policy");
    await expect(
      api.listPullRequestFiles({ owner: "octocat", repo: "demo", pullNumber: 42 })
    ).resolves.toEqual(["src/index.ts"]);
    await expect(
      api.listCheckRuns({ owner: "octocat", repo: "demo", ref: "head" })
    ).resolves.toEqual([
      { name: "test", conclusion: "success", app: "github-actions" },
      { name: "without-app", conclusion: null }
    ]);
    await expect(
      api.listPullRequestReviews({
        owner: "octocat",
        repo: "demo",
        pullNumber: 42
      })
    ).resolves.toEqual([
      { login: "maintainer", state: "APPROVED", submittedAt: "2026-08-10T10:00:00Z" },
      { login: null, state: "COMMENTED" }
    ]);
    await expect(
      api.getRepositoryPermission({
        owner: "octocat",
        repo: "demo",
        login: "maintainer"
      })
    ).resolves.toBe("write");
    await expect(
      api.listClosingIssueNumbers({
        owner: "octocat",
        repo: "demo",
        pullNumber: 42
      })
    ).resolves.toEqual([7]);
  });

  it("maps successful and failed commit statuses into check evidence", async () => {
    const client = fakeOctokit();
    vi.mocked(client.rest.repos.getCombinedStatusForRef).mockResolvedValueOnce({
      data: {
        statuses: [
          { context: "lint/status", state: "success" },
          { context: "deploy/status", state: "failure" },
          { context: "pending/status", state: "pending" }
        ]
      }
    } as never);
    vi.mocked(getOctokit).mockReturnValue(client);
    const api = createGitHubGateway("secret");

    await expect(
      api.listCheckRuns({ owner: "octocat", repo: "demo", ref: "head" })
    ).resolves.toEqual([
      { name: "test", conclusion: "success", app: "github-actions" },
      { name: "without-app", conclusion: null },
      { name: "lint/status", conclusion: "success" },
      { name: "deploy/status", conclusion: "failure" }
    ]);
  });

  it("rejects a check-run response that reports more than the safe limit", async () => {
    const client = fakeOctokit();
    vi.mocked(client.rest.checks.listForRef).mockResolvedValueOnce({
      data: { total_count: 1001, check_runs: [] }
    } as never);
    vi.mocked(getOctokit).mockReturnValue(client);
    const api = createGitHubGateway("secret");

    await expect(
      api.listCheckRuns({ owner: "octocat", repo: "demo", ref: "head" })
    ).rejects.toMatchObject({ code: "GITHUB_EVIDENCE_INCOMPLETE" });
  });

  it("rejects a pull request file response at the API boundary", async () => {
    const client = fakeOctokit();
    vi.mocked(client.paginate).mockResolvedValueOnce(
      Array.from({ length: 3000 }, () => ({ filename: "src/index.ts" }))
    );
    vi.mocked(getOctokit).mockReturnValue(client);
    const api = createGitHubGateway("secret");

    await expect(
      api.listPullRequestFiles({ owner: "octocat", repo: "demo", pullNumber: 42 })
    ).rejects.toMatchObject({ code: "GITHUB_EVIDENCE_INCOMPLETE" });
  });

  it("rejects a pull request review response at the normalized-input boundary", async () => {
    const client = fakeOctokit();
    vi.mocked(client.paginate).mockResolvedValueOnce(
      Array.from({ length: 1000 }, () => ({
        user: { login: "maintainer" },
        state: "APPROVED"
      }))
    );
    vi.mocked(getOctokit).mockReturnValue(client);
    const api = createGitHubGateway("secret");

    await expect(
      api.listPullRequestReviews({ owner: "octocat", repo: "demo", pullNumber: 42 })
    ).rejects.toMatchObject({ code: "GITHUB_EVIDENCE_INCOMPLETE" });
  });

  it("rejects closing-issue pagination instead of evaluating a partial list", async () => {
    const client = fakeOctokit();
    vi.mocked(client.graphql).mockResolvedValueOnce({
      repository: {
        pullRequest: {
          closingIssuesReferences: {
            nodes: Array.from({ length: 100 }, (_, index) => ({ number: index + 1 })),
            pageInfo: { hasNextPage: true }
          }
        }
      }
    });
    vi.mocked(getOctokit).mockReturnValue(client);
    const api = createGitHubGateway("secret");

    await expect(
      api.listClosingIssueNumbers({ owner: "octocat", repo: "demo", pullNumber: 42 })
    ).rejects.toMatchObject({ code: "GITHUB_EVIDENCE_INCOMPLETE" });
  });

  it("rejects non-raw content and maps unknown repository roles to none", async () => {
    const client = fakeOctokit();
    vi.mocked(client.request).mockResolvedValueOnce({ data: [] } as never);
    vi.mocked(client.rest.repos.getCollaboratorPermissionLevel).mockResolvedValueOnce({
      data: { permission: "custom-role" }
    } as never);
    vi.mocked(getOctokit).mockReturnValue(client);
    const api = createGitHubGateway("secret");

    await expect(
      api.getFileAtRevision({
        owner: "octocat",
        repo: "demo",
        path: ".reviewready.yml",
        ref: "base"
      })
    ).rejects.toThrow("raw file content");
    await expect(
      api.getRepositoryPermission({
        owner: "octocat",
        repo: "demo",
        login: "reader"
      })
    ).resolves.toBe("none");
  });
});
