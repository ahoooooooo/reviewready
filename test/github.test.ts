import { describe, expect, it, vi } from "vitest";

import { evaluate } from "../src/engine.js";
import {
  fingerprintGitHubEvidence,
  loadGitHubPullRequest,
  type GitHubGateway,
  type GitHubPermission
} from "../src/github.js";
import { MATCHING_OPERATION_BUDGET } from "../src/matcher.js";

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

describe("GitHub evidence fingerprint", () => {
  it("returns a cryptographic digest for the canonical evidence set", () => {
    const digest = fingerprintGitHubEvidence(
      [
        { name: "test", conclusion: "success", app: "github-actions" },
        { name: "lint", conclusion: "success", app: "github-actions" }
      ],
      [
        { login: "maintainer", state: "APPROVED", submittedAt: "2026-08-11T00:00:00Z" },
        { login: "second", state: "COMMENTED" }
      ],
      [7, 8]
    );

    expect(digest).toMatch(/^[0-9a-f]{64}$/u);
    expect(
      fingerprintGitHubEvidence(
        [{ name: "test", conclusion: "failure", app: "github-actions" }],
        [{ login: "maintainer", state: "APPROVED", submittedAt: "2026-08-11T00:00:00Z" }],
        [7]
      )
    ).not.toBe(digest);
  });
});

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
        {
          login: "maintainer",
          state: "APPROVED",
          submittedAt: "2026-08-11T00:00:00Z"
        },
        { login: "reader", state: "COMMENTED" },
        { login: "ghost", state: "PENDING" },
        { login: null, state: "APPROVED" },
        {
          login: "maintainer",
          state: "CHANGES_REQUESTED",
          submittedAt: "2026-08-11T01:00:00Z"
        }
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
        {
          login: "maintainer",
          state: "approved",
          maintainer: true,
          submittedAt: "2026-08-11T00:00:00Z"
        },
        { login: "reader", state: "commented", maintainer: false },
        {
          login: "maintainer",
          state: "changes_requested",
          maintainer: true,
          submittedAt: "2026-08-11T01:00:00Z"
        }
      ]
    });
  });

  it("checks actionable reviewers once per coherent evidence read", async () => {
    const permission = vi.fn(() => Promise.resolve<GitHubPermission>("write"));
    const api = gateway({ getRepositoryPermission: permission });

    await loadGitHubPullRequest(event, ".reviewready.yml", api);

    expect(permission).toHaveBeenCalledTimes(2);
  });

  it("canonicalizes multiple reviewer permissions and snapshot labels", async () => {
    const getPullRequestSnapshot = vi.fn(() =>
      Promise.resolve({
        number: 42,
        baseSha,
        headSha,
        updatedAt: "2026-08-11T00:00:00Z",
        body: event.pull_request.body,
        labels: ["zeta", "alpha"]
      })
    );
    const listPullRequestReviews = vi.fn(() =>
      Promise.resolve([
        { login: "maintainer", state: "APPROVED", submittedAt: "2026-08-11T00:00:00Z" },
        { login: "second", state: "APPROVED", submittedAt: "2026-08-11T00:01:00Z" }
      ])
    );
    const api = gateway({ getPullRequestSnapshot, listPullRequestReviews });

    await expect(loadGitHubPullRequest(event, ".reviewready.yml", api)).resolves.toBeDefined();
  });

  it("fails closed when reviewer permission association exceeds its time bound", async () => {
    vi.useFakeTimers();
    try {
      const api = gateway({
        getRepositoryPermission: vi.fn(() => new Promise<GitHubPermission>(() => undefined))
      });
      const result = loadGitHubPullRequest(event, ".reviewready.yml", api);
      const assertion = expect(result).rejects.toMatchObject({
        code: "GITHUB_EVIDENCE_INCOMPLETE"
      });
      await vi.advanceTimersByTimeAsync(120_000);

      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed when reviewer permission changes between evidence reads", async () => {
    let lookup = 0;
    const permission = vi.fn(() => {
      const value: GitHubPermission = lookup++ % 2 === 0 ? "write" : "read";
      return Promise.resolve(value);
    });
    const api = gateway({
      listPullRequestReviews: vi.fn(() =>
        Promise.resolve([
          {
            login: "maintainer",
            state: "APPROVED",
            submittedAt: "2026-08-11T00:00:00Z"
          }
        ])
      ),
      getRepositoryPermission: permission
    });

    await expect(loadGitHubPullRequest(event, ".reviewready.yml", api)).rejects.toMatchObject({
      code: "GITHUB_SNAPSHOT_CHANGED"
    });
    expect(permission).toHaveBeenCalledTimes(4);
  });

  it("fails closed before permission lookups exceed the bounded reviewer limit", async () => {
    const reviews = Array.from({ length: 101 }, (_, index) => ({
      login: `reviewer-${String(index)}`,
      state: "APPROVED",
      submittedAt: "2026-08-11T00:00:00Z"
    }));
    const permission = vi.fn(() => Promise.resolve<GitHubPermission>("write"));
    const api = gateway({
      listPullRequestReviews: vi.fn(() => Promise.resolve(reviews)),
      getRepositoryPermission: permission
    });

    await expect(loadGitHubPullRequest(event, ".reviewready.yml", api)).rejects.toMatchObject({
      code: "GITHUB_EVIDENCE_INCOMPLETE"
    });
    expect(permission).not.toHaveBeenCalled();
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
    expect(listClosingIssueNumbers).toHaveBeenCalledTimes(2);
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
    expect(getPullRequestSnapshot).toHaveBeenCalledTimes(5);
  });

  it("rechecks the PR snapshot after the second evidence collection", async () => {
    const stableSnapshot = {
      number: 42,
      baseSha,
      headSha,
      updatedAt: "2026-08-11T00:00:00Z",
      body: event.pull_request.body,
      labels: ["bug"]
    };
    const changedSnapshot = {
      ...stableSnapshot,
      updatedAt: "2026-08-11T00:01:00Z",
      body: "Updated body",
      labels: ["urgent"]
    };
    const getPullRequestSnapshot = vi
      .fn()
      .mockResolvedValueOnce(stableSnapshot)
      .mockResolvedValueOnce(stableSnapshot)
      .mockResolvedValueOnce(changedSnapshot)
      .mockResolvedValue(changedSnapshot);
    const api = gateway({ getPullRequestSnapshot });

    const loaded = await loadGitHubPullRequest(event, ".reviewready.yml", api);

    expect(loaded.input.body).toBe("Updated body");
    expect(loaded.input.labels).toEqual(["urgent"]);
    expect(getPullRequestSnapshot).toHaveBeenCalledTimes(6);
  });

  it("does not keep stale success when required evidence changes during collection", async () => {
    const listCheckRuns = vi
      .fn()
      .mockResolvedValueOnce([{ name: "test", conclusion: "success", app: "github-actions" }])
      .mockResolvedValueOnce([{ name: "test", conclusion: "failure", app: "github-actions" }])
      .mockResolvedValue([{ name: "test", conclusion: "failure", app: "github-actions" }]);
    const api = gateway({
      getFileAtRevision: vi.fn(() =>
        Promise.resolve(
          "version: 1\nrules:\n  - id: check\n    when:\n      paths:\n        any: [src/**]\n    require:\n      - type: check\n        name: test\n        conclusions: [success]\n"
        )
      ),
      listCheckRuns
    });

    const loaded = await loadGitHubPullRequest(event, ".reviewready.yml", api);

    expect(loaded.input.checks).toEqual([
      { name: "test", conclusion: "failure", app: "github-actions" }
    ]);
    expect(evaluate(loaded.policy, loaded.input).status).toBe("not_ready");
    expect(listCheckRuns).toHaveBeenCalledTimes(4);
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
    expect(getPullRequestSnapshot).toHaveBeenCalledTimes(5);
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

  it("fails closed on an unsupported review state instead of dropping it", async () => {
    const api = gateway({
      listPullRequestReviews: vi.fn(() =>
        Promise.resolve([
          { login: "maintainer", state: "APPROVED" },
          { login: "maintainer", state: "UNRECOGNIZED_STATE" }
        ])
      )
    });

    await expect(loadGitHubPullRequest(event, ".reviewready.yml", api)).rejects.toMatchObject({
      code: "GITHUB_EVIDENCE_INCOMPLETE"
    });
  });

  it("fails closed when GitHub review ordering lacks timestamps", async () => {
    const api = gateway({
      listPullRequestReviews: vi.fn(() =>
        Promise.resolve([
          { login: "maintainer", state: "CHANGES_REQUESTED" },
          { login: "maintainer", state: "APPROVED" }
        ])
      )
    });

    await expect(loadGitHubPullRequest(event, ".reviewready.yml", api)).rejects.toMatchObject({
      code: "GITHUB_EVIDENCE_INCOMPLETE"
    });
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

  it("shares the matching budget while planning required GitHub evidence", async () => {
    const ruleCount = 2;
    const patternCount = 100;
    const pathCount = Math.ceil(MATCHING_OPERATION_BUDGET / (ruleCount * patternCount)) + 10;
    const policy = [
      "version: 1",
      "rules:",
      ...Array.from({ length: ruleCount }, (_, ruleIndex) => [
        "  - id: budget-" + String(ruleIndex),
        "    when:",
        "      paths:",
        "        none:",
        ...Array.from(
          { length: patternCount },
          (_, patternIndex) =>
            '          - "missing-' + String(ruleIndex) + "-" + String(patternIndex) + '/**"'
        ),
        "    require:",
        "      - type: linked_issue"
      ]).flat()
    ].join("\n");
    const listPullRequestFiles = vi.fn(() =>
      Promise.resolve(
        Array.from({ length: pathCount }, (_, pathIndex) => "changed/" + String(pathIndex) + ".ts")
      )
    );
    const api = gateway({
      getFileAtRevision: vi.fn(() => Promise.resolve(policy)),
      listPullRequestFiles
    });

    await expect(loadGitHubPullRequest(event, ".reviewready.yml", api)).rejects.toMatchObject({
      code: "POLICY_MATCHING_BUDGET_EXCEEDED",
      kind: "policy"
    });
    expect(listPullRequestFiles).toHaveBeenCalledTimes(1);
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
