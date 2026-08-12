import { getOctokit } from "@actions/github";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { policyLimits } from "../src/domain.js";
import { collectCheckRunPages, createGitHubGateway } from "../src/github-api.js";
import type { GitHubCheckRun } from "../src/github.js";

vi.mock("@actions/github", () => ({ getOctokit: vi.fn() }));

const completed = (name: string): GitHubCheckRun => ({
  name,
  conclusion: "success"
});

const listFiles = vi.fn();
const listReviews = vi.fn((arguments_: unknown) => {
  const page = (arguments_ as { readonly page?: number }).page ?? 1;
  return Promise.resolve({
    data:
      page === 1
        ? [
            {
              user: { login: "maintainer" },
              state: "APPROVED",
              submitted_at: "2026-08-10T10:00:00Z"
            },
            { user: null, state: "COMMENTED" }
          ]
        : []
  });
});

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
        listForRef: vi.fn((arguments_) => {
          const page = (arguments_ as { readonly page?: number }).page ?? 1;
          return Promise.resolve({
            data: {
              total_count: 2,
              check_runs:
                page === 1
                  ? [
                      {
                        name: "test",
                        status: "completed",
                        conclusion: "success",
                        completed_at: "2026-08-11T00:00:00Z",
                        app: { slug: "github-actions" }
                      },
                      {
                        name: "without-app",
                        status: "completed",
                        conclusion: null,
                        completed_at: "2026-08-11T00:00:00Z",
                        app: null
                      }
                    ]
                  : []
            }
          });
        })
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
        listFiles: vi.fn((arguments_) => {
          const page = (arguments_ as { readonly page?: number }).page ?? 1;
          return Promise.resolve({
            data: page === 1 ? [{ filename: "src/index.ts" }] : []
          });
        }),
        listReviews
      },
      repos: {
        listCommitStatusesForRef: vi.fn((arguments_) => {
          const page = (arguments_ as { readonly page?: number }).page ?? 1;
          return Promise.resolve({ data: page === 1 ? [] : [] });
        }),
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

  it("fails closed at the exact Check Run collection boundary", async () => {
    const fetchPage = vi.fn((page: number) =>
      Promise.resolve(page <= 10 ? Array.from({ length: 100 }, () => completed("check")) : [])
    );

    await expect(collectCheckRunPages(fetchPage)).rejects.toMatchObject({
      code: "GITHUB_EVIDENCE_INCOMPLETE"
    });
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

  it("fails closed when Check Runs and legacy statuses exceed the normalized evidence bound", async () => {
    const client = fakeOctokit();
    vi.mocked(client.rest.checks.listForRef).mockImplementation((arguments_) => {
      const page = (arguments_ as { readonly page?: number }).page ?? 1;
      const count = page <= 5 ? 100 : page === 6 ? 1 : 0;
      return Promise.resolve({
        data: {
          total_count: 501,
          check_runs: Array.from({ length: count }, (_, index) => ({
            id: page * 100 + index,
            name: `check-${String(page * 100 + index)}`,
            status: "completed",
            conclusion: "success",
            completed_at: "2026-08-11T10:00:00Z",
            app: { slug: "github-actions" }
          }))
        },
        headers: {}
      }) as never;
    });
    vi.mocked(client.rest.repos.listCommitStatusesForRef).mockImplementation((arguments_) => {
      const page = (arguments_ as { readonly page?: number }).page ?? 1;
      const count = page <= 5 ? 100 : page === 6 ? 1 : 0;
      return Promise.resolve({
        data: Array.from({ length: count }, (_, index) => ({
          id: page * 100 + index,
          context: `status-${String(page * 100 + index)}`,
          state: "success",
          updated_at: "2026-08-11T10:00:00Z"
        })),
        headers: {}
      }) as never;
    });
    vi.mocked(getOctokit).mockReturnValue(client);
    const api = createGitHubGateway("secret");

    await expect(
      api.listCheckRuns({ owner: "octocat", repo: "demo", ref: "head" })
    ).rejects.toMatchObject({ code: "GITHUB_EVIDENCE_INCOMPLETE" });
  });

  it("retries one rate-limited evidence page using the bounded Retry-After delay", async () => {
    const client = fakeOctokit();
    let calls = 0;
    vi.mocked(client.rest.checks.listForRef).mockImplementation(() => {
      calls += 1;
      if (calls === 1) {
        const error = Object.assign(new Error("rate limited"), {
          status: 429,
          response: { headers: { "retry-after": "0" } }
        });
        return Promise.reject(error);
      }
      return Promise.resolve({ data: { total_count: 0, check_runs: [] }, headers: {} }) as never;
    });
    vi.mocked(getOctokit).mockReturnValue(client);
    const api = createGitHubGateway("secret");

    await expect(
      api.listCheckRuns({ owner: "octocat", repo: "demo", ref: "head" })
    ).resolves.toEqual([]);
    expect(calls).toBe(3);
  });
});

describe("createGitHubGateway", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("configures a bounded request abort signal for the GitHub client", () => {
    vi.mocked(getOctokit).mockReturnValue(fakeOctokit());

    createGitHubGateway("secret");

    const options = vi.mocked(getOctokit).mock.calls[0]?.[1] as
      { request?: { signal?: AbortSignal } } | undefined;
    expect(options?.request?.signal).toBeInstanceOf(AbortSignal);
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
    vi.mocked(client.rest.checks.listForRef).mockResolvedValueOnce({
      data: { total_count: 4, check_runs: [] }
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

  it("does not accept a success conclusion from a non-completed Check Run", async () => {
    const client = fakeOctokit();
    vi.mocked(client.rest.checks.listForRef).mockResolvedValueOnce({
      data: {
        total_count: 1,
        check_runs: [
          {
            name: "build",
            status: "in_progress",
            conclusion: "success",
            started_at: "2026-08-11T10:00:00Z",
            app: { slug: "github-actions" }
          }
        ]
      }
    } as never);
    vi.mocked(client.rest.checks.listForRef).mockResolvedValueOnce({
      data: { total_count: 1, check_runs: [] }
    } as never);
    vi.mocked(client.rest.repos.listCommitStatusesForRef).mockResolvedValueOnce({
      data: []
    } as never);
    vi.mocked(getOctokit).mockReturnValue(client);
    const api = createGitHubGateway("secret");

    await expect(
      api.listCheckRuns({ owner: "octocat", repo: "demo", ref: "head" })
    ).resolves.toEqual([{ name: "build", conclusion: null, app: "github-actions" }]);
  });

  it("treats GitHub-nullable in-progress timestamps as pending evidence", async () => {
    const client = fakeOctokit();
    vi.mocked(client.rest.checks.listForRef).mockResolvedValueOnce({
      data: {
        total_count: 1,
        check_runs: [
          {
            name: "build",
            status: "queued",
            conclusion: null,
            started_at: null,
            completed_at: null,
            app: { slug: "github-actions" }
          }
        ]
      }
    } as never);
    vi.mocked(client.rest.checks.listForRef).mockResolvedValueOnce({
      data: { total_count: 1, check_runs: [] }
    } as never);
    vi.mocked(client.rest.repos.listCommitStatusesForRef).mockResolvedValueOnce({
      data: []
    } as never);
    vi.mocked(getOctokit).mockReturnValue(client);
    const api = createGitHubGateway("secret");

    await expect(
      api.listCheckRuns({ owner: "octocat", repo: "demo", ref: "head" })
    ).resolves.toEqual([{ name: "build", conclusion: null, app: "github-actions" }]);
  });

  it("does not accept a success conclusion with an invalid Check Run timestamp", async () => {
    const client = fakeOctokit();
    vi.mocked(client.rest.checks.listForRef).mockResolvedValueOnce({
      data: {
        total_count: 1,
        check_runs: [
          {
            name: "build",
            status: "completed",
            conclusion: "success",
            completed_at: "not-a-timestamp",
            app: { slug: "github-actions" }
          }
        ]
      }
    } as never);
    vi.mocked(client.rest.checks.listForRef).mockResolvedValueOnce({
      data: { total_count: 1, check_runs: [] }
    } as never);
    vi.mocked(client.rest.repos.listCommitStatusesForRef).mockResolvedValueOnce({
      data: []
    } as never);
    vi.mocked(getOctokit).mockReturnValue(client);
    const api = createGitHubGateway("secret");

    await expect(
      api.listCheckRuns({ owner: "octocat", repo: "demo", ref: "head" })
    ).resolves.toEqual([{ name: "build", conclusion: null, app: "github-actions" }]);
  });

  it("does not treat a non-ISO Check Run timestamp as ordering evidence", async () => {
    const client = fakeOctokit();
    vi.mocked(client.rest.checks.listForRef).mockResolvedValueOnce({
      data: {
        total_count: 1,
        check_runs: [
          {
            name: "build",
            status: "completed",
            conclusion: "success",
            completed_at: "0",
            app: { slug: "github-actions" }
          }
        ]
      }
    } as never);
    vi.mocked(client.rest.checks.listForRef).mockResolvedValueOnce({
      data: { total_count: 1, check_runs: [] }
    } as never);
    vi.mocked(client.rest.repos.listCommitStatusesForRef).mockResolvedValueOnce({
      data: []
    } as never);
    vi.mocked(getOctokit).mockReturnValue(client);
    const api = createGitHubGateway("secret");

    await expect(
      api.listCheckRuns({ owner: "octocat", repo: "demo", ref: "head" })
    ).resolves.toEqual([{ name: "build", conclusion: null, app: "github-actions" }]);
  });

  it("does not accept a Check Run with impossible start and completion ordering", async () => {
    const client = fakeOctokit();
    vi.mocked(client.rest.checks.listForRef).mockResolvedValueOnce({
      data: {
        total_count: 1,
        check_runs: [
          {
            name: "build",
            status: "completed",
            conclusion: "success",
            started_at: "2026-08-11T11:00:00Z",
            completed_at: "2026-08-11T10:00:00Z",
            app: { slug: "github-actions" }
          }
        ]
      }
    } as never);
    vi.mocked(client.rest.checks.listForRef).mockResolvedValueOnce({
      data: { total_count: 1, check_runs: [] }
    } as never);
    vi.mocked(client.rest.repos.listCommitStatusesForRef).mockResolvedValueOnce({
      data: []
    } as never);
    vi.mocked(getOctokit).mockReturnValue(client);
    const api = createGitHubGateway("secret");

    await expect(
      api.listCheckRuns({ owner: "octocat", repo: "demo", ref: "head" })
    ).resolves.toEqual([{ name: "build", conclusion: null, app: "github-actions" }]);
  });

  it("does not accept a success conclusion when Check Run status is missing", async () => {
    const client = fakeOctokit();
    vi.mocked(client.rest.checks.listForRef).mockResolvedValueOnce({
      data: {
        total_count: 1,
        check_runs: [{ name: "build", conclusion: "success", app: { slug: "github-actions" } }]
      }
    } as never);
    vi.mocked(client.rest.checks.listForRef).mockResolvedValueOnce({
      data: { total_count: 1, check_runs: [] }
    } as never);
    vi.mocked(client.rest.repos.listCommitStatusesForRef).mockResolvedValueOnce({
      data: []
    } as never);
    vi.mocked(getOctokit).mockReturnValue(client);
    const api = createGitHubGateway("secret");

    await expect(
      api.listCheckRuns({ owner: "octocat", repo: "demo", ref: "head" })
    ).resolves.toEqual([{ name: "build", conclusion: null, app: "github-actions" }]);
  });

  it("rejects a non-string Check Run timestamp field", async () => {
    const client = fakeOctokit();
    vi.mocked(client.rest.checks.listForRef).mockResolvedValueOnce({
      data: {
        total_count: 1,
        check_runs: [
          {
            name: "build",
            status: "completed",
            conclusion: "success",
            completed_at: 42,
            app: { slug: "github-actions" }
          }
        ]
      }
    } as never);
    vi.mocked(client.rest.checks.listForRef).mockResolvedValueOnce({
      data: { total_count: 1, check_runs: [] }
    } as never);
    vi.mocked(client.rest.repos.listCommitStatusesForRef).mockResolvedValueOnce({
      data: []
    } as never);
    vi.mocked(getOctokit).mockReturnValue(client);
    const api = createGitHubGateway("secret");

    await expect(
      api.listCheckRuns({ owner: "octocat", repo: "demo", ref: "head" })
    ).rejects.toThrow("timestamp");
  });

  it("rejects a non-string Check Run status field", async () => {
    const client = fakeOctokit();
    vi.mocked(client.rest.checks.listForRef).mockResolvedValueOnce({
      data: {
        total_count: 1,
        check_runs: [
          {
            name: "build",
            status: null,
            conclusion: "success",
            app: { slug: "github-actions" }
          }
        ]
      }
    } as never);
    vi.mocked(client.rest.checks.listForRef).mockResolvedValueOnce({
      data: { total_count: 1, check_runs: [] }
    } as never);
    vi.mocked(client.rest.repos.listCommitStatusesForRef).mockResolvedValueOnce({
      data: []
    } as never);
    vi.mocked(getOctokit).mockReturnValue(client);
    const api = createGitHubGateway("secret");

    await expect(
      api.listCheckRuns({ owner: "octocat", repo: "demo", ref: "head" })
    ).rejects.toThrow("status");
  });

  it("rejects a Check Run explicitly bound to a different commit", async () => {
    const client = fakeOctokit();
    vi.mocked(client.rest.checks.listForRef).mockResolvedValueOnce({
      data: {
        total_count: 1,
        check_runs: [
          {
            name: "build",
            status: "completed",
            conclusion: "success",
            head_sha: "c".repeat(40),
            completed_at: "2026-08-11T10:00:00Z",
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
      api.listCheckRuns({ owner: "octocat", repo: "demo", ref: "b".repeat(40) })
    ).rejects.toMatchObject({ code: "GITHUB_EVIDENCE_INCOMPLETE" });
  });

  it("rejects a successful Check Run without a head SHA", async () => {
    const client = fakeOctokit();
    vi.mocked(client.rest.checks.listForRef).mockResolvedValueOnce({
      data: {
        total_count: 1,
        check_runs: [
          {
            name: "build",
            status: "completed",
            conclusion: "success",
            completed_at: "2026-08-11T10:00:00Z",
            app: { slug: "github-actions" }
          }
        ]
      }
    } as never);
    vi.mocked(client.rest.checks.listForRef).mockResolvedValueOnce({
      data: { total_count: 1, check_runs: [] }
    } as never);
    vi.mocked(client.rest.repos.listCommitStatusesForRef).mockResolvedValueOnce({
      data: []
    } as never);
    vi.mocked(getOctokit).mockReturnValue(client);
    const api = createGitHubGateway("secret");

    await expect(
      api.listCheckRuns({ owner: "octocat", repo: "demo", ref: "b".repeat(40) })
    ).rejects.toMatchObject({ code: "GITHUB_EVIDENCE_INCOMPLETE" });
  });

  it("fails closed when one provider returns same-name runs without ordering metadata", async () => {
    const client = fakeOctokit();
    vi.mocked(client.rest.checks.listForRef).mockResolvedValueOnce({
      data: {
        total_count: 2,
        check_runs: [
          {
            name: "build",
            conclusion: "success",
            app: { slug: "github-actions" }
          },
          {
            name: "build",
            conclusion: "failure",
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
    ).resolves.toEqual([{ name: "build", conclusion: null, app: "github-actions" }]);
  });

  it("does not let an old successful commit status mask a newer pending status", async () => {
    const client = fakeOctokit();
    vi.mocked(client.rest.checks.listForRef).mockResolvedValueOnce({
      data: { total_count: 0, check_runs: [] }
    } as never);
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

  it("fails closed when duplicate commit statuses contain an invalid ordering timestamp", async () => {
    const client = fakeOctokit();
    vi.mocked(client.rest.checks.listForRef).mockResolvedValueOnce({
      data: { total_count: 0, check_runs: [] }
    } as never);
    vi.mocked(client.rest.checks.listForRef).mockResolvedValueOnce({
      data: { total_count: 0, check_runs: [] }
    } as never);
    vi.mocked(client.rest.repos.listCommitStatusesForRef).mockResolvedValueOnce({
      data: [
        {
          context: "build",
          state: "failure",
          updated_at: "not-a-timestamp"
        },
        {
          context: "build",
          state: "success",
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

  it("does not accept a single successful commit status with an invalid timestamp", async () => {
    const client = fakeOctokit();
    vi.mocked(client.rest.checks.listForRef).mockResolvedValueOnce({
      data: { total_count: 0, check_runs: [] }
    } as never);
    vi.mocked(client.rest.checks.listForRef).mockResolvedValueOnce({
      data: { total_count: 0, check_runs: [] }
    } as never);
    vi.mocked(client.rest.repos.listCommitStatusesForRef).mockResolvedValueOnce({
      data: [{ context: "build", state: "success", updated_at: "not-a-timestamp" }]
    } as never);
    vi.mocked(getOctokit).mockReturnValue(client);
    const api = createGitHubGateway("secret");

    await expect(
      api.listCheckRuns({ owner: "octocat", repo: "demo", ref: "head" })
    ).resolves.toEqual([{ name: "build", conclusion: null }]);
  });

  it("does not accept a commit status with impossible creation ordering", async () => {
    const client = fakeOctokit();
    vi.mocked(client.rest.checks.listForRef).mockResolvedValueOnce({
      data: { total_count: 0, check_runs: [] }
    } as never);
    vi.mocked(client.rest.checks.listForRef).mockResolvedValueOnce({
      data: { total_count: 0, check_runs: [] }
    } as never);
    vi.mocked(client.rest.repos.listCommitStatusesForRef).mockResolvedValueOnce({
      data: [
        {
          context: "build",
          state: "success",
          created_at: "2026-08-11T11:00:00Z",
          updated_at: "2026-08-11T10:00:00Z"
        }
      ]
    } as never);
    vi.mocked(getOctokit).mockReturnValue(client);
    const api = createGitHubGateway("secret");

    await expect(
      api.listCheckRuns({ owner: "octocat", repo: "demo", ref: "head" })
    ).resolves.toEqual([{ name: "build", conclusion: null }]);
  });

  it("does not use a malformed status timestamp to win cross-provider aggregation", async () => {
    const client = fakeOctokit();
    vi.mocked(client.rest.checks.listForRef).mockResolvedValueOnce({
      data: {
        total_count: 1,
        check_runs: [
          {
            name: "build",
            status: "completed",
            conclusion: "failure",
            completed_at: "2026-08-11T10:00:00Z",
            app: { slug: "trusted-app" }
          }
        ]
      }
    } as never);
    vi.mocked(client.rest.checks.listForRef).mockResolvedValueOnce({
      data: { total_count: 1, check_runs: [] }
    } as never);
    vi.mocked(client.rest.repos.listCommitStatusesForRef).mockResolvedValueOnce({
      data: [
        {
          context: "build",
          state: "success",
          created_at: "2026-08-11T11:00:00Z",
          updated_at: "not-a-timestamp"
        }
      ]
    } as never);
    vi.mocked(getOctokit).mockReturnValue(client);
    const api = createGitHubGateway("secret");

    await expect(
      api.listCheckRuns({ owner: "octocat", repo: "demo", ref: "head" })
    ).resolves.toEqual([
      { name: "build", conclusion: "failure", app: "trusted-app" },
      { name: "build", conclusion: null }
    ]);
  });

  it("does not let a malformed pending Check Run ordering expose a status success", async () => {
    const client = fakeOctokit();
    vi.mocked(client.rest.checks.listForRef).mockResolvedValueOnce({
      data: {
        total_count: 1,
        check_runs: [
          {
            name: "build",
            status: "completed",
            conclusion: null,
            started_at: "2026-08-11T11:00:00Z",
            completed_at: "2026-08-11T10:00:00Z",
            app: { slug: "trusted-app" }
          }
        ]
      }
    } as never);
    vi.mocked(client.rest.checks.listForRef).mockResolvedValueOnce({
      data: { total_count: 1, check_runs: [] }
    } as never);
    vi.mocked(client.rest.repos.listCommitStatusesForRef).mockResolvedValueOnce({
      data: [
        {
          context: "build",
          state: "success",
          updated_at: "2026-08-11T10:30:00Z"
        }
      ]
    } as never);
    vi.mocked(getOctokit).mockReturnValue(client);
    const api = createGitHubGateway("secret");

    await expect(
      api.listCheckRuns({ owner: "octocat", repo: "demo", ref: "head" })
    ).resolves.toEqual([
      { name: "build", conclusion: null, app: "trusted-app" },
      { name: "build", conclusion: null }
    ]);
  });

  it("does not let malformed pending status ordering expose a Check Run success", async () => {
    const client = fakeOctokit();
    vi.mocked(client.rest.checks.listForRef).mockResolvedValueOnce({
      data: {
        total_count: 1,
        check_runs: [
          {
            name: "build",
            status: "completed",
            conclusion: "success",
            completed_at: "2026-08-11T10:30:00Z",
            app: { slug: "trusted-app" }
          }
        ]
      }
    } as never);
    vi.mocked(client.rest.checks.listForRef).mockResolvedValueOnce({
      data: { total_count: 1, check_runs: [] }
    } as never);
    vi.mocked(client.rest.repos.listCommitStatusesForRef).mockResolvedValueOnce({
      data: [
        {
          context: "build",
          state: "pending",
          created_at: "2026-08-11T11:00:00Z",
          updated_at: "2026-08-11T10:00:00Z"
        }
      ]
    } as never);
    vi.mocked(getOctokit).mockReturnValue(client);
    const api = createGitHubGateway("secret");

    await expect(
      api.listCheckRuns({ owner: "octocat", repo: "demo", ref: "head" })
    ).resolves.toEqual([
      { name: "build", conclusion: "success", app: "trusted-app" },
      { name: "build", conclusion: null }
    ]);
  });

  it("does not let an incomplete Check Run conclusion win a cross-provider aggregate", async () => {
    const client = fakeOctokit();
    vi.mocked(client.rest.checks.listForRef).mockResolvedValueOnce({
      data: {
        total_count: 1,
        check_runs: [
          {
            name: "build",
            conclusion: "success",
            completed_at: "2026-08-11T11:00:00Z",
            app: { slug: "trusted-app" }
          }
        ]
      }
    } as never);
    vi.mocked(client.rest.checks.listForRef).mockResolvedValueOnce({
      data: { total_count: 1, check_runs: [] }
    } as never);
    vi.mocked(client.rest.repos.listCommitStatusesForRef).mockResolvedValueOnce({
      data: [
        {
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
      { name: "build", conclusion: null, app: "trusted-app" },
      { name: "build", conclusion: null }
    ]);
  });

  it("rejects a non-string commit-status timestamp field", async () => {
    const client = fakeOctokit();
    vi.mocked(client.rest.checks.listForRef).mockResolvedValueOnce({
      data: { total_count: 0, check_runs: [] }
    } as never);
    vi.mocked(client.rest.checks.listForRef).mockResolvedValueOnce({
      data: { total_count: 0, check_runs: [] }
    } as never);
    vi.mocked(client.rest.repos.listCommitStatusesForRef).mockResolvedValueOnce({
      data: [{ context: "build", state: "success", updated_at: 42 }]
    } as never);
    vi.mocked(getOctokit).mockReturnValue(client);
    const api = createGitHubGateway("secret");

    await expect(
      api.listCheckRuns({ owner: "octocat", repo: "demo", ref: "head" })
    ).rejects.toThrow("timestamp");
  });

  it("treats an unknown same-name commit-status state as ambiguous evidence", async () => {
    const client = fakeOctokit();
    vi.mocked(client.rest.checks.listForRef).mockResolvedValueOnce({
      data: {
        total_count: 1,
        check_runs: [
          {
            id: 1,
            name: "build",
            status: "completed",
            conclusion: "success",
            completed_at: "2026-08-11T10:00:00Z",
            app: { slug: "trusted-app" }
          }
        ]
      }
    } as never);
    vi.mocked(client.rest.checks.listForRef).mockResolvedValueOnce({
      data: { total_count: 1, check_runs: [] }
    } as never);
    vi.mocked(client.rest.repos.listCommitStatusesForRef).mockResolvedValueOnce({
      data: [
        {
          id: 2,
          context: "build",
          state: "future-terminal-state",
          updated_at: "2026-08-11T11:00:00Z"
        }
      ]
    } as never);
    vi.mocked(getOctokit).mockReturnValue(client);
    const api = createGitHubGateway("secret");

    await expect(
      api.listCheckRuns({ owner: "octocat", repo: "demo", ref: "head" })
    ).resolves.toEqual([
      { name: "build", conclusion: "success", app: "trusted-app" },
      { name: "build", conclusion: null }
    ]);
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
    vi.mocked(client.rest.checks.listForRef).mockResolvedValueOnce({
      data: { total_count: 1, check_runs: [] }
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

  it("fails closed when same-name providers cannot be ordered by reliable timestamps", async () => {
    const client = fakeOctokit();
    vi.mocked(client.rest.checks.listForRef).mockResolvedValueOnce({
      data: {
        total_count: 1,
        check_runs: [
          {
            id: 1,
            name: "build",
            status: "completed",
            conclusion: "success",
            app: { slug: "trusted-app" }
          }
        ]
      }
    } as never);
    vi.mocked(client.rest.checks.listForRef).mockResolvedValueOnce({
      data: { total_count: 1, check_runs: [] }
    } as never);
    vi.mocked(client.rest.repos.listCommitStatusesForRef).mockResolvedValueOnce({
      data: [{ id: 2, context: "build", state: "failure" }]
    } as never);
    vi.mocked(getOctokit).mockReturnValue(client);
    const api = createGitHubGateway("secret");

    await expect(
      api.listCheckRuns({ owner: "octocat", repo: "demo", ref: "head" })
    ).resolves.toEqual([
      { name: "build", conclusion: null, app: "trusted-app" },
      { name: "build", conclusion: null }
    ]);
  });

  it("rejects a non-null Check Run provider without a stable slug", async () => {
    const client = fakeOctokit();
    vi.mocked(client.rest.checks.listForRef).mockResolvedValueOnce({
      data: {
        total_count: 1,
        check_runs: [
          {
            name: "build",
            conclusion: "success",
            app: { name: "untrusted display name" }
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
    ).rejects.toThrow("provider");
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

  it("rejects a malformed previous filename instead of dropping rename evidence", async () => {
    const client = fakeOctokit();
    vi.mocked(client.rest.pulls.listFiles).mockResolvedValueOnce({
      data: [{ filename: "src/new.ts", previous_filename: 42 }]
    } as never);
    vi.mocked(getOctokit).mockReturnValue(client);
    const api = createGitHubGateway("secret");

    await expect(
      api.listPullRequestFiles({ owner: "octocat", repo: "demo", pullNumber: 42 })
    ).rejects.toThrow("previous filename");
  });

  it("rejects a review with a malformed reviewer login", async () => {
    const client = fakeOctokit();
    vi.mocked(client.rest.pulls.listReviews).mockResolvedValueOnce({
      data: [
        {
          user: { login: 42 },
          state: "CHANGES_REQUESTED",
          submitted_at: "2026-08-11T11:00:00Z"
        }
      ]
    } as never);
    vi.mocked(getOctokit).mockReturnValue(client);
    const api = createGitHubGateway("secret");

    await expect(
      api.listPullRequestReviews({ owner: "octocat", repo: "demo", pullNumber: 42 })
    ).rejects.toThrow("reviewer login");
  });

  it("rejects a review with a malformed submission timestamp", async () => {
    const client = fakeOctokit();
    vi.mocked(client.rest.pulls.listReviews).mockResolvedValueOnce({
      data: [
        {
          user: { login: "maintainer" },
          state: "APPROVED",
          submitted_at: "not-a-timestamp"
        }
      ]
    } as never);
    vi.mocked(getOctokit).mockReturnValue(client);
    const api = createGitHubGateway("secret");

    await expect(
      api.listPullRequestReviews({ owner: "octocat", repo: "demo", pullNumber: 42 })
    ).rejects.toThrow("submitted_at timestamp");
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

  it("rejects a Check Run response whose total count contradicts its page", async () => {
    const client = fakeOctokit();
    vi.mocked(client.rest.checks.listForRef).mockResolvedValueOnce({
      data: {
        total_count: 0,
        check_runs: [{ name: "build", conclusion: "success", app: { slug: "github-actions" } }]
      }
    } as never);
    vi.mocked(getOctokit).mockReturnValue(client);
    const api = createGitHubGateway("secret");

    await expect(
      api.listCheckRuns({ owner: "octocat", repo: "demo", ref: "head" })
    ).rejects.toMatchObject({ code: "GITHUB_EVIDENCE_INCOMPLETE" });
  });

  it("rejects a partial Check Run page that does not satisfy its reported total", async () => {
    const client = fakeOctokit();
    vi.mocked(client.rest.checks.listForRef).mockResolvedValue({
      data: {
        total_count: 2,
        check_runs: [{ name: "build", conclusion: "success", app: { slug: "github-actions" } }]
      }
    } as never);
    vi.mocked(getOctokit).mockReturnValue(client);
    const api = createGitHubGateway("secret");

    await expect(
      api.listCheckRuns({ owner: "octocat", repo: "demo", ref: "head" })
    ).rejects.toMatchObject({ code: "GITHUB_EVIDENCE_INCOMPLETE" });
  });

  it("rejects a Check Run page whose total count hides an unlinked next page", async () => {
    const client = fakeOctokit();
    vi.mocked(client.rest.checks.listForRef).mockImplementation((arguments_) => {
      const page = (arguments_ as { readonly page?: number }).page ?? 1;
      return Promise.resolve({
        data: {
          total_count: 1,
          check_runs:
            page === 1
              ? [{ name: "build", conclusion: "success", app: { slug: "github-actions" } }]
              : [{ name: "hidden", conclusion: "success", app: { slug: "github-actions" } }]
        },
        headers: {}
      }) as never;
    });
    vi.mocked(getOctokit).mockReturnValue(client);
    const api = createGitHubGateway("secret");

    await expect(
      api.listCheckRuns({ owner: "octocat", repo: "demo", ref: "head" })
    ).rejects.toMatchObject({ code: "GITHUB_EVIDENCE_INCOMPLETE" });
  });

  it("follows a next-link after a partial pull-request review page", async () => {
    const client = fakeOctokit();
    vi.mocked(client.rest.pulls.listReviews).mockImplementation((arguments_) => {
      const page = (arguments_ as { readonly page?: number }).page ?? 1;
      return Promise.resolve(
        page === 1
          ? {
              data: [{ user: { login: "first" }, state: "APPROVED" }],
              headers: { link: '<https://api.github.test?page=2>; rel="next"' }
            }
          : page === 2
            ? { data: [{ user: { login: "second" }, state: "COMMENTED" }], headers: {} }
            : { data: [], headers: {} }
      ) as never;
    });
    vi.mocked(getOctokit).mockReturnValue(client);
    const api = createGitHubGateway("secret");

    await expect(
      api.listPullRequestReviews({ owner: "octocat", repo: "demo", pullNumber: 42 })
    ).resolves.toEqual([
      { login: "first", state: "APPROVED" },
      { login: "second", state: "COMMENTED" }
    ]);
  });

  it("fails closed when a next-link skips a pagination page", async () => {
    const client = fakeOctokit();
    vi.mocked(client.rest.pulls.listReviews).mockImplementation((arguments_) => {
      const page = (arguments_ as { readonly page?: number }).page ?? 1;
      return Promise.resolve(
        page === 1
          ? {
              data: [{ user: { login: "first" }, state: "APPROVED" }],
              headers: { link: '<https://api.github.test?page=5>; rel="next"' }
            }
          : { data: [], headers: {} }
      ) as never;
    });
    vi.mocked(getOctokit).mockReturnValue(client);
    const api = createGitHubGateway("secret");

    await expect(
      api.listPullRequestReviews({ owner: "octocat", repo: "demo", pullNumber: 42 })
    ).rejects.toMatchObject({ code: "GITHUB_EVIDENCE_INCOMPLETE" });
  });

  it("rejects a partial review page when a hidden next page is not linked", async () => {
    const client = fakeOctokit();
    vi.mocked(client.rest.pulls.listReviews).mockImplementation((arguments_) => {
      const page = (arguments_ as { readonly page?: number }).page ?? 1;
      return Promise.resolve(
        page === 1
          ? { data: [{ user: { login: "first" }, state: "APPROVED" }], headers: {} }
          : { data: [{ user: { login: "hidden" }, state: "APPROVED" }], headers: {} }
      ) as never;
    });
    vi.mocked(getOctokit).mockReturnValue(client);
    const api = createGitHubGateway("secret");

    await expect(
      api.listPullRequestReviews({ owner: "octocat", repo: "demo", pullNumber: 42 })
    ).rejects.toMatchObject({ code: "GITHUB_EVIDENCE_INCOMPLETE" });
  });

  it.each([
    ["unquoted next relation", "<https://api.github.test?page=2>; rel=next"],
    ["trailing next-link text", '<https://api.github.test?page=2>; rel="next" trailing']
  ])("rejects malformed Link metadata (%s)", async (_label, link) => {
    const client = fakeOctokit();
    vi.mocked(client.rest.pulls.listReviews).mockImplementation((arguments_) => {
      const page = (arguments_ as { readonly page?: number }).page ?? 1;
      return Promise.resolve(
        page === 1
          ? {
              data: Array.from({ length: 100 }, () => ({
                user: { login: "reviewer" },
                state: "COMMENTED"
              })),
              headers: { link }
            }
          : { data: [], headers: {} }
      ) as never;
    });
    vi.mocked(getOctokit).mockReturnValue(client);
    const api = createGitHubGateway("secret");

    await expect(
      api.listPullRequestReviews({ owner: "octocat", repo: "demo", pullNumber: 42 })
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

  it("rejects oversized raw policy content at the API boundary", async () => {
    const client = fakeOctokit();
    vi.mocked(client.request).mockResolvedValueOnce({
      data: "x".repeat(policyLimits.maxPolicyBytes + 1)
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

  it("rejects an oversized closing-issue node list at the API boundary", async () => {
    const client = fakeOctokit();
    vi.mocked(client.graphql).mockResolvedValueOnce({
      repository: {
        pullRequest: {
          closingIssuesReferences: {
            nodes: Array.from({ length: 101 }, (_, index) => ({ number: index + 1 })),
            pageInfo: { hasNextPage: false }
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
