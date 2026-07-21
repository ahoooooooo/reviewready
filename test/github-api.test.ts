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
                state: "APPROVED"
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
              nodes: [{ number: 7 }, null]
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

  it("caps collection at GitHub's documented 1,000-run boundary", async () => {
    const fetchPage = vi.fn(() =>
      Promise.resolve(Array.from({ length: 100 }, () => completed("check")))
    );

    const runs = await collectCheckRunPages(fetchPage);

    expect(runs).toHaveLength(1000);
    expect(fetchPage).toHaveBeenCalledTimes(10);
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
      { login: "maintainer", state: "APPROVED" },
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
