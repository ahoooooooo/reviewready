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
const listReviews = vi.fn(() =>
  Promise.resolve({
    data: [
      {
        user: { login: "maintainer" },
        state: "APPROVED",
        submitted_at: "2026-08-10T10:00:00Z"
      },
      { user: null, state: "COMMENTED" }
    ]
  })
);

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
      pulls: {
        get: vi.fn(() =>
          Promise.resolve({
            data: {
              number: 42,
              body: "Fixes #7",
              updated_at: "2026-08-11T00:00:00Z",
              base: { sha: "a".repeat(40) },
              head: { sha: "b".repeat(40) },
              labels: [{ name: "bug" }]
            }
          })
        ),
        listFiles: vi.fn(() => Promise.resolve({ data: [{ filename: "src/index.ts" }] })),
        listReviews
      },
      repos: {
        listCommitStatusesForRef: vi.fn(() =>
          Promise.resolve({
            data: []
          })
        ),
        getCombinedStatusForRef: vi.fn(() => Promise.resolve({ data: { statuses: [] } })),
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

  it("fails closed when a provider returns more items than its requested page size", async () => {
    const fetchPage = vi.fn((page: number) =>
      Promise.resolve(page === 1 ? Array.from({ length: 101 }, () => completed("check")) : [])
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
      api.getPullRequestSnapshot({ owner: "octocat", repo: "demo", pullNumber: 42 })
    ).resolves.toEqual({
      number: 42,
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
      updatedAt: "2026-08-11T00:00:00Z",
      body: "Fixes #7",
      labels: ["bug"]
    });
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
    vi.mocked(client.rest.repos.listCommitStatusesForRef).mockResolvedValueOnce({
      data: [
        { context: "lint/status", state: "success" },
        { context: "deploy/status", state: "failure" },
        { context: "pending/status", state: "pending" }
      ]
    } as never);
    vi.mocked(getOctokit).mockReturnValue(client);
    const api = createGitHubGateway("secret");

    await expect(
      api.listCheckRuns({ owner: "octocat", repo: "demo", ref: "head" })
    ).resolves.toEqual([
      { name: "test", conclusion: "success", app: "github-actions" },
      { name: "without-app", conclusion: null },
      { name: "deploy/status", conclusion: "failure" },
      { name: "lint/status", conclusion: "success" },
      { name: "pending/status", conclusion: null }
    ]);
  });

  it("keeps only the latest logical check-run result", async () => {
    const client = fakeOctokit();
    vi.mocked(client.rest.checks.listForRef).mockResolvedValueOnce({
      data: {
        total_count: 4,
        check_runs: [
          {
            id: 1,
            name: "build",
            status: "completed",
            conclusion: "success",
            completed_at: "2026-08-11T10:00:00Z",
            app: { slug: "github-actions" }
          },
          {
            id: 2,
            name: "build",
            status: "completed",
            conclusion: "failure",
            completed_at: "2026-08-11T11:00:00Z",
            app: { slug: "github-actions" }
          },
          {
            id: 3,
            name: "deploy",
            status: "completed",
            conclusion: "success",
            completed_at: "2026-08-11T12:00:00Z",
            app: { slug: "github-actions" }
          },
          {
            id: 4,
            name: "deploy",
            status: "in_progress",
            conclusion: null,
            started_at: "2026-08-11T13:00:00Z",
            app: { slug: "github-actions" }
          }
        ]
      }
    } as never);
    vi.mocked(client.rest.repos.listCommitStatusesForRef).mockResolvedValueOnce({
      data: []
    } as never);
    vi.mocked(getOctokit).mockReturnValue(client);
    const api = createGitHubGateway("secret");

    await expect(
      api.listCheckRuns({ owner: "octocat", repo: "demo", ref: "head" })
    ).resolves.toEqual([
      { name: "build", conclusion: "failure", app: "github-actions" },
      { name: "deploy", conclusion: null, app: "github-actions" }
    ]);
  });

  it("does not let an old successful commit status mask a newer pending status", async () => {
    const client = fakeOctokit();
    vi.mocked(client.rest.checks.listForRef).mockResolvedValueOnce({
      data: { total_count: 0, check_runs: [] }
    } as never);
    vi.mocked(client.rest.repos.listCommitStatusesForRef).mockResolvedValueOnce({
      data: [
        {
          id: 1,
          context: "build",
          state: "success",
          updated_at: "2026-08-11T10:00:00Z"
        },
        {
          id: 2,
          context: "build",
          state: "pending",
          updated_at: "2026-08-11T11:00:00Z"
        }
      ]
    } as never);
    vi.mocked(getOctokit).mockReturnValue(client);
    const api = createGitHubGateway("secret");

    await expect(
      api.listCheckRuns({ owner: "octocat", repo: "demo", ref: "head" })
    ).resolves.toEqual([{ name: "build", conclusion: null }]);
  });

  it("does not let a legacy success mask a failed Check Run with the same name", async () => {
    const client = fakeOctokit();
    vi.mocked(client.rest.checks.listForRef).mockResolvedValueOnce({
      data: {
        total_count: 1,
        check_runs: [
          {
            id: 2,
            name: "build",
            status: "completed",
            conclusion: "failure",
            completed_at: "2026-08-11T11:00:00Z",
            app: { slug: "github-actions" }
          }
        ]
      }
    } as never);
    vi.mocked(client.rest.repos.listCommitStatusesForRef).mockResolvedValueOnce({
      data: [
        {
          id: 1,
          context: "build",
          state: "success",
          updated_at: "2026-08-11T10:00:00Z"
        }
      ]
    } as never);
    vi.mocked(getOctokit).mockReturnValue(client);
    const api = createGitHubGateway("secret");

    await expect(
      api.listCheckRuns({ owner: "octocat", repo: "demo", ref: "head" })
    ).resolves.toEqual([
      { name: "build", conclusion: "failure", app: "github-actions" },
      { name: "build", conclusion: "failure" }
    ]);
  });

  it("emits a conservative aggregate for same-name Check Runs from different apps", async () => {
    const client = fakeOctokit();
    vi.mocked(client.rest.checks.listForRef).mockResolvedValueOnce({
      data: {
        total_count: 2,
        check_runs: [
          {
            id: 1,
            name: "build",
            status: "completed",
            conclusion: "success",
            completed_at: "2026-08-11T10:00:00Z",
            app: { slug: "trusted-app" }
          },
          {
            id: 2,
            name: "build",
            status: "completed",
            conclusion: "failure",
            completed_at: "2026-08-11T11:00:00Z",
            app: { slug: "other-app" }
          }
        ]
      }
    } as never);
    vi.mocked(client.rest.repos.listCommitStatusesForRef).mockResolvedValueOnce({
      data: []
    } as never);
    vi.mocked(getOctokit).mockReturnValue(client);
    const api = createGitHubGateway("secret");

    await expect(
      api.listCheckRuns({ owner: "octocat", repo: "demo", ref: "head" })
    ).resolves.toEqual(
      expect.arrayContaining([
        { name: "build", conclusion: "success", app: "trusted-app" },
        { name: "build", conclusion: "failure", app: "other-app" },
        { name: "build", conclusion: "failure" }
      ])
    );
  });

  it("preserves the previous filename for renamed files", async () => {
    const client = fakeOctokit();
    vi.mocked(client.rest.pulls.listFiles).mockResolvedValueOnce({
      data: [{ filename: "src/new.ts", previous_filename: "vendor/old.ts" }]
    } as never);
    vi.mocked(getOctokit).mockReturnValue(client);
    const api = createGitHubGateway("secret");

    await expect(
      api.listPullRequestFiles({ owner: "octocat", repo: "demo", pullNumber: 42 })
    ).resolves.toEqual([{ filename: "src/new.ts", previousFilename: "vendor/old.ts" }]);
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
    vi.mocked(client.rest.pulls.listFiles).mockResolvedValueOnce({
      data: Array.from({ length: 3000 }, () => ({ filename: "src/index.ts" }))
    } as never);
    vi.mocked(getOctokit).mockReturnValue(client);
    const api = createGitHubGateway("secret");

    await expect(
      api.listPullRequestFiles({ owner: "octocat", repo: "demo", pullNumber: 42 })
    ).rejects.toMatchObject({ code: "GITHUB_EVIDENCE_INCOMPLETE" });
  });

  it("rejects a pull request review response at the normalized-input boundary", async () => {
    const client = fakeOctokit();
    vi.mocked(client.rest.pulls.listReviews).mockImplementation((arguments_) => {
      const page = (arguments_ as { readonly page?: number }).page ?? 1;
      return Promise.resolve({
        data:
          page <= 10
            ? Array.from({ length: 100 }, () => ({
                user: { login: "maintainer" },
                state: "APPROVED"
              }))
            : []
      }) as never;
    });
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

  it("maps only collaborator-not-found to a non-maintainer permission", async () => {
    const client = fakeOctokit();
    const notFound = Object.assign(new Error("not found"), { status: 404 });
    vi.mocked(client.rest.repos.getCollaboratorPermissionLevel).mockRejectedValueOnce(notFound);
    vi.mocked(getOctokit).mockReturnValue(client);
    const api = createGitHubGateway("secret");

    await expect(
      api.getRepositoryPermission({
        owner: "octocat",
        repo: "demo",
        login: "external"
      })
    ).resolves.toBe("none");

    const forbidden = Object.assign(new Error("forbidden"), { status: 403 });
    vi.mocked(client.rest.repos.getCollaboratorPermissionLevel).mockRejectedValueOnce(forbidden);
    await expect(
      api.getRepositoryPermission({
        owner: "octocat",
        repo: "demo",
        login: "external"
      })
    ).rejects.toMatchObject({ status: 403 });
  });
});
