import { describe, expect, it, vi } from "vitest";

import { loadGitHubPullRequest, type GitHubGateway, type GitHubPermission } from "../src/github.js";

const baseSha = "a".repeat(40);
const headSha = "b".repeat(40);

const event = {
  repository: {
    name: "demo",
    owner: { login: "octocat" }
  },
  pull_request: {
    number: 42,
    body: "Fixes #7",
    labels: [{ name: "bug" }],
    base: { sha: baseSha },
    head: { sha: headSha }
  }
};

function gateway(overrides: Partial<GitHubGateway> = {}): GitHubGateway {
  return {
    getFileAtRevision: vi.fn(() =>
      Promise.resolve(
        "version: 1\nrules:\n  - id: source\n    when:\n      paths:\n        any: [src/**]\n    require:\n      - type: linked_issue\n"
      )
    ),
    listPullRequestFiles: vi.fn(() => Promise.resolve(["src/index.ts"])),
    listCheckRuns: vi.fn(() =>
      Promise.resolve([
        { name: "test", conclusion: "success", app: "github-actions" },
        { name: "pending", conclusion: null, app: "github-actions" }
      ])
    ),
    listPullRequestReviews: vi.fn(() =>
      Promise.resolve([
        { login: "maintainer", state: "APPROVED" },
        { login: "reader", state: "COMMENTED" },
        { login: "ghost", state: "PENDING" },
        { login: null, state: "APPROVED" },
        { login: "maintainer", state: "CHANGES_REQUESTED" }
      ])
    ),
    getRepositoryPermission: vi.fn(({ login }) =>
      Promise.resolve<GitHubPermission>(login === "maintainer" ? "write" : "read")
    ),
    listClosingIssueNumbers: vi.fn(() => Promise.resolve([7])),
    ...overrides
  };
}

describe("loadGitHubPullRequest", () => {
  it("loads policy from the immutable base SHA and evidence from the PR", async () => {
    const getFileAtRevision = vi.fn(() =>
      Promise.resolve(
        "version: 1\nrules:\n  - id: source\n    when:\n      paths:\n        any: [src/**]\n    require:\n      - type: linked_issue\n"
      )
    );
    const listCheckRuns = vi.fn(() =>
      Promise.resolve([{ name: "test", conclusion: "success", app: "github-actions" }])
    );
    const api = gateway({ getFileAtRevision, listCheckRuns });
    const loaded = await loadGitHubPullRequest(event, ".reviewready.yml", api);

    expect(getFileAtRevision).toHaveBeenCalledWith({
      owner: "octocat",
      repo: "demo",
      path: ".reviewready.yml",
      ref: baseSha
    });
    expect(listCheckRuns).toHaveBeenCalledWith({
      owner: "octocat",
      repo: "demo",
      ref: headSha
    });
    expect(loaded.input).toEqual({
      version: 1,
      changedFiles: ["src/index.ts"],
      body: "Fixes #7",
      labels: ["bug"],
      linkedIssues: [7],
      checks: [{ name: "test", conclusion: "success", app: "github-actions" }],
      reviews: [
        { login: "maintainer", state: "approved", maintainer: true },
        { login: "reader", state: "commented", maintainer: false },
        { login: "maintainer", state: "changes_requested", maintainer: true }
      ]
    });
  });

  it("checks each reviewer's permission only once", async () => {
    const permission = vi.fn(() => Promise.resolve<GitHubPermission>("write"));
    const api = gateway({ getRepositoryPermission: permission });

    await loadGitHubPullRequest(event, ".reviewready.yml", api);

    expect(permission).toHaveBeenCalledTimes(2);
  });

  it("rejects non-pull-request payloads with a stable error", async () => {
    await expect(loadGitHubPullRequest({}, ".reviewready.yml", gateway())).rejects.toMatchObject({
      code: "GITHUB_EVENT_INVALID",
      kind: "platform"
    });
  });

  it("rejects a policy path that can escape the repository", async () => {
    await expect(loadGitHubPullRequest(event, "../policy.yml", gateway())).rejects.toMatchObject({
      code: "INPUT_UNSAFE_PATH"
    });
  });

  it("wraps unexpected API failures without exposing their details", async () => {
    const api = gateway({
      listPullRequestFiles: () => Promise.reject(new Error("sensitive upstream detail"))
    });

    await expect(loadGitHubPullRequest(event, ".reviewready.yml", api)).rejects.toMatchObject({
      code: "GITHUB_API_FAILED",
      message: "GitHub evidence could not be loaded with the provided token and permissions."
    });
  });
});
