import { describe, expect, it, vi } from "vitest";

import { evaluate } from "../src/engine.js";
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
    getPullRequestSnapshot: vi.fn(() =>
      Promise.resolve({
        number: 42,
        baseSha,
        headSha,
        updatedAt: "2026-08-11T00:00:00Z",
        body: event.pull_request.body,
        labels: event.pull_request.labels.map((label) => label.name)
      })
    ),
    getFileAtRevision: vi.fn(() =>
      Promise.resolve(
        "version: 1\nrules:\n  - id: source\n    when:\n      paths:\n        any: [src/**]\n    require:\n      - type: linked_issue\n      - type: check\n        name: test\n        conclusions: [success]\n      - type: maintainer_review\n        minimum: 1\n"
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
        "version: 1\nrules:\n  - id: source\n    when:\n      paths:\n        any: [src/**]\n    require:\n      - type: linked_issue\n      - type: check\n        name: test\n        conclusions: [success]\n      - type: maintainer_review\n        minimum: 1\n"
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

  it("only collects evidence types required by the triggered policy", async () => {
    const listCheckRuns = vi.fn(() =>
      Promise.resolve([{ name: "test", conclusion: "success", app: "github-actions" }])
    );
    const listPullRequestReviews = vi.fn(() =>
      Promise.resolve([{ login: "maintainer", state: "APPROVED" }])
    );
    const listClosingIssueNumbers = vi.fn(() => Promise.resolve([7]));
    const getRepositoryPermission = vi.fn(() => Promise.resolve<GitHubPermission>("read"));
    const api = gateway({
      getFileAtRevision: vi.fn(() =>
        Promise.resolve(
          "version: 1\nrules:\n  - id: linked\n    when:\n      labels:\n        any: [bug]\n    require:\n      - type: linked_issue\n"
        )
      ),
      listCheckRuns,
      listPullRequestReviews,
      listClosingIssueNumbers,
      getRepositoryPermission
    });

    await loadGitHubPullRequest(event, ".reviewready.yml", api);

    expect(listCheckRuns).not.toHaveBeenCalled();
    expect(listPullRequestReviews).not.toHaveBeenCalled();
    expect(listClosingIssueNumbers).toHaveBeenCalledTimes(1);
    expect(getRepositoryPermission).not.toHaveBeenCalled();
  });

  it("retries once when the PR snapshot changes during evidence collection", async () => {
    const getPullRequestSnapshot = vi
      .fn()
      .mockResolvedValueOnce({
        number: 42,
        baseSha,
        headSha,
        updatedAt: "2026-08-11T00:00:00Z",
        body: event.pull_request.body,
        labels: ["bug"]
      })
      .mockResolvedValueOnce({
        number: 42,
        baseSha,
        headSha,
        updatedAt: "2026-08-11T00:01:00Z",
        body: event.pull_request.body,
        labels: ["bug"]
      })
      .mockResolvedValue({
        number: 42,
        baseSha,
        headSha,
        updatedAt: "2026-08-11T00:01:00Z",
        body: event.pull_request.body,
        labels: ["bug"]
      });
    const api = gateway({ getPullRequestSnapshot });

    const loaded = await loadGitHubPullRequest(event, ".reviewready.yml", api);

    expect(loaded.context.baseSha).toBe(baseSha);
    expect(loaded.context.headSha).toBe(headSha);
    expect(getPullRequestSnapshot).toHaveBeenCalledTimes(4);
  });

  it("retries when the evaluated PR body or labels change", async () => {
    const getPullRequestSnapshot = vi
      .fn()
      .mockResolvedValueOnce({
        number: 42,
        baseSha,
        headSha,
        updatedAt: "2026-08-11T00:00:00Z",
        body: event.pull_request.body,
        labels: ["bug"]
      })
      .mockResolvedValueOnce({
        number: 42,
        baseSha,
        headSha,
        updatedAt: "2026-08-11T00:00:00Z",
        body: "Updated body",
        labels: ["urgent"]
      })
      .mockResolvedValue({
        number: 42,
        baseSha,
        headSha,
        updatedAt: "2026-08-11T00:00:00Z",
        body: "Updated body",
        labels: ["urgent"]
      });
    const api = gateway({ getPullRequestSnapshot });

    const loaded = await loadGitHubPullRequest(event, ".reviewready.yml", api);

    expect(loaded.input.body).toBe("Updated body");
    expect(loaded.input.labels).toEqual(["urgent"]);
    expect(getPullRequestSnapshot).toHaveBeenCalledTimes(4);
  });

  it("rejects a snapshot for a different pull request", async () => {
    const getPullRequestSnapshot = vi.fn(() =>
      Promise.resolve({
        number: 43,
        baseSha,
        headSha,
        updatedAt: "2026-08-11T00:00:00Z",
        body: event.pull_request.body,
        labels: ["bug"]
      })
    );

    await expect(
      loadGitHubPullRequest(event, ".reviewready.yml", gateway({ getPullRequestSnapshot }))
    ).rejects.toMatchObject({ code: "GITHUB_SNAPSHOT_INVALID" });
  });

  it("fails closed when the PR keeps changing across bounded retries", async () => {
    const getPullRequestSnapshot = vi.fn(
      (() => {
        let sequence = 0;
        return () =>
          Promise.resolve({
            number: 42,
            baseSha,
            headSha,
            updatedAt: `2026-08-11T00:0${String(sequence++)}:00Z`,
            body: event.pull_request.body,
            labels: ["bug"]
          });
      })()
    );
    const api = gateway({ getPullRequestSnapshot });

    await expect(loadGitHubPullRequest(event, ".reviewready.yml", api)).rejects.toMatchObject({
      code: "GITHUB_SNAPSHOT_CHANGED"
    });
    expect(getPullRequestSnapshot).toHaveBeenCalledTimes(4);
  });

  it("normalizes renamed files into new and previous Git paths", async () => {
    const api = gateway({
      getFileAtRevision: vi.fn(() =>
        Promise.resolve(
          "version: 1\nrules:\n  - id: source\n    when:\n      paths:\n        any: [src/**]\n    require:\n      - type: linked_issue\n"
        )
      ),
      listPullRequestFiles: vi.fn(() =>
        Promise.resolve([{ filename: "src/new.ts", previousFilename: "vendor/old.ts" }])
      )
    });

    const loaded = await loadGitHubPullRequest(event, ".reviewready.yml", api);

    expect(loaded.input.changedFiles).toEqual(["src/new.ts"]);
    expect(loaded.input.previousChangedFiles).toEqual(["vendor/old.ts"]);
  });

  it("does not fall back to a provider success when a same-name check is pending", async () => {
    const api = gateway({
      getFileAtRevision: vi.fn(() =>
        Promise.resolve(
          "version: 1\nrules:\n  - id: source\n    when:\n      paths:\n        any: [src/**]\n    require:\n      - type: check\n        name: test\n        conclusions: [success]\n"
        )
      ),
      listCheckRuns: vi.fn(() =>
        Promise.resolve([
          { name: "test", conclusion: "success", app: "trusted-app" },
          { name: "test", conclusion: null }
        ])
      )
    });

    const loaded = await loadGitHubPullRequest(event, ".reviewready.yml", api);

    expect(loaded.input.checks).toContainEqual({ name: "test", conclusion: null });
    expect(evaluate(loaded.policy, loaded.input).status).toBe("not_ready");
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
