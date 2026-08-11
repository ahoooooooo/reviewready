import { describe, expect, it, vi } from "vitest";

import { auditRepository, type AuditSnapshot } from "../src/audit.js";
import {
  collectRepositoryAuditSnapshot,
  type AuditGitHubClient,
  type AuditRepositoryArguments
} from "../src/github-audit.js";

const baseSha = "a".repeat(40);
const nextSha = "b".repeat(40);
const workflowPath = ".github/workflows/reviewready.yml";

const policySource = [
  "version: 1",
  "rules:",
  "  - id: source-change",
  "    when:",
  "      paths:",
  '        any: ["src/**"]',
  "    require:",
  "      - type: check",
  "        name: ReviewReady",
  "        conclusions: [success]",
  "        app: github-actions"
].join("\n");

function client(overrides: Partial<AuditGitHubClient> = {}): AuditGitHubClient {
  const repository = { owner: "octocat", name: "demo", defaultBranch: "main" };
  const branch = { name: "main", sha: baseSha };
  return {
    getRepository: vi.fn(() => Promise.resolve(repository)),
    getBranch: vi.fn(() => Promise.resolve(branch)),
    getBranchProtection: vi.fn(() =>
      Promise.resolve({
        branch: "main",
        exists: true,
        enforceAdmins: true,
        allowForcePushes: false,
        allowDeletions: false,
        requiredStatusChecks: {
          strict: true,
          checks: [{ name: "ReviewReady", appSlug: "github-actions" }]
        },
        requiredPullRequestReviews: {
          requiredApprovingReviewCount: 1,
          bypassActors: []
        }
      })
    ),
    listRulesets: vi.fn(() =>
      Promise.resolve([
        {
          id: 1,
          name: "main",
          target: "branch" as const,
          refPatterns: ["~DEFAULT_BRANCH"],
          enforcement: "active" as const,
          bypassActors: [],
          allowForcePushes: false,
          allowDeletions: false,
          requiredChecks: [{ name: "ReviewReady", appSlug: "github-actions" }]
        }
      ])
    ),
    listWorkflowFiles: vi.fn(() =>
      Promise.resolve([{ path: workflowPath, type: "file" as const }])
    ),
    getFileAtRevision: vi.fn(({ path }: AuditRepositoryArguments & { path: string }) =>
      Promise.resolve(path === ".reviewready.yml" ? policySource : "on: pull_request\njobs: {}")
    ),
    getTagProtection: vi.fn(() =>
      Promise.resolve({ known: true, allowsDeletion: false, allowsUpdate: false })
    ),
    ...overrides
  };
}

describe("GitHub repository audit collector", () => {
  it("collects policy and every workflow at one immutable base revision", async () => {
    const api = client();

    const snapshot = await collectRepositoryAuditSnapshot("octocat", "demo", api, {
      protectedWorkflowPaths: [workflowPath],
      trustedWorkflowPaths: [workflowPath]
    });

    expect(snapshot.baseRevision).toMatchObject({
      sha: baseSha,
      policyRevisionSha: baseSha,
      policyLoadedFromBase: true
    });
    expect(snapshot.baseRevision.policySha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(snapshot.workflows).toHaveLength(1);
    expect(snapshot.workflows[0]).toMatchObject({
      path: workflowPath,
      revisionSha: baseSha,
      protectedFromPullRequest: true,
      trustedRoot: true
    });
    expect(auditRepository(snapshot)).toMatchObject({ auditVersion: 1, status: "pass" });
    expect(api.getFileAtRevision).toHaveBeenCalledWith(
      expect.objectContaining({ path: ".reviewready.yml", ref: baseSha })
    );
    expect(api.getFileAtRevision).toHaveBeenCalledWith(
      expect.objectContaining({ path: workflowPath, ref: baseSha })
    );
  });

  it("fails closed when the evaluated branch changes during collection", async () => {
    const api = client({
      getBranch: vi
        .fn()
        .mockResolvedValueOnce({ name: "main", sha: baseSha })
        .mockResolvedValueOnce({ name: "main", sha: nextSha })
    });

    const snapshot = await collectRepositoryAuditSnapshot("octocat", "demo", api, {
      protectedWorkflowPaths: [workflowPath],
      trustedWorkflowPaths: [workflowPath]
    });

    expect(snapshot.completeness.complete).toBe(false);
    expect(snapshot.completeness.missing).toContain("base-revision-changed");
    expect(auditRepository(snapshot).status).toBe("incomplete");
  });

  it("does not infer a trusted workflow root from ordinary API access", async () => {
    const snapshot = await collectRepositoryAuditSnapshot("octocat", "demo", client());

    expect(snapshot.workflows[0]?.trustedRoot).toBe(false);
    expect(snapshot.completeness.complete).toBe(false);
    expect(snapshot.completeness.missing).toEqual(
      expect.arrayContaining(["trusted-workflow-root", "workflow-protection-root"])
    );
  });

  it("normalizes invalid repository and policy inputs into incomplete snapshots", async () => {
    const cases: Array<Promise<AuditSnapshot>> = [
      collectRepositoryAuditSnapshot("bad/owner", "demo", client()),
      collectRepositoryAuditSnapshot("octocat", "demo", client(), { policyPath: "../policy.yml" }),
      collectRepositoryAuditSnapshot(
        "octocat",
        "demo",
        client({
          getRepository: vi.fn(() =>
            Promise.resolve({ owner: "octocat", name: "demo", defaultBranch: "" })
          )
        })
      ),
      collectRepositoryAuditSnapshot(
        "octocat",
        "demo",
        client({
          getBranch: vi.fn(() => Promise.resolve({ name: "main", sha: "not-a-sha" }))
        })
      )
    ];

    for (const pending of cases) {
      const snapshot = await pending;
      expect(snapshot.completeness.complete).toBe(false);
      expect(snapshot.baseRevision.policyLoadedFromBase).toBe(false);
      expect(snapshot.completeness.missing).toHaveLength(1);
    }
  });

  it("fails closed for invalid workflow entries, source sizes, and trust-root paths", async () => {
    const invalidWorkflowEntry = await collectRepositoryAuditSnapshot(
      "octocat",
      "demo",
      client({
        listWorkflowFiles: vi.fn(() =>
          Promise.resolve([{ path: workflowPath, type: "dir" as const }])
        )
      })
    );
    expect(invalidWorkflowEntry.completeness.missing).toContain("workflow-entry-not-file");

    const invalidWorkflowPath = await collectRepositoryAuditSnapshot(
      "octocat",
      "demo",
      client({
        listWorkflowFiles: vi.fn(() =>
          Promise.resolve([{ path: "../workflow.yml", type: "file" as const }])
        )
      })
    );
    expect(invalidWorkflowPath.completeness.missing).toContain("workflow-path-invalid");

    const invalidProtectedRoot = await collectRepositoryAuditSnapshot("octocat", "demo", client(), {
      protectedWorkflowPaths: ["../root.yml"]
    });
    expect(invalidProtectedRoot.completeness.missing).toContain("workflow-path-invalid");

    const oversizedPolicy = await collectRepositoryAuditSnapshot(
      "octocat",
      "demo",
      client({
        getFileAtRevision: vi.fn(({ path }: AuditRepositoryArguments & { path: string }) =>
          Promise.resolve(path === ".reviewready.yml" ? "x".repeat(512 * 1024 + 1) : "workflow")
        )
      })
    );
    expect(oversizedPolicy.completeness.missing).toContain("policy-source-limit");

    const invalidWorkflowSource = await collectRepositoryAuditSnapshot(
      "octocat",
      "demo",
      client({
        getFileAtRevision: vi.fn(({ path }: AuditRepositoryArguments & { path: string }) =>
          Promise.resolve(path === ".reviewready.yml" ? policySource : { source: "not-text" })
        )
      })
    );
    expect(invalidWorkflowSource.completeness.missing).toContain("workflow-source-limit");
  });

  it("bounds workflow enumeration and validates option and policy shapes", async () => {
    const tooManyWorkflows = await collectRepositoryAuditSnapshot(
      "octocat",
      "demo",
      client({
        listWorkflowFiles: vi.fn(() =>
          Promise.resolve(
            Array.from({ length: 101 }, (_, index) => ({
              path: ".github/workflows/workflow-" + String(index) + ".yml",
              type: "file" as const
            }))
          )
        )
      })
    );
    expect(tooManyWorkflows.completeness.missing).toContain("workflow-count-limit");

    const invalidTrustedRoot = await collectRepositoryAuditSnapshot("octocat", "demo", client(), {
      trustedWorkflowPaths: ["not-a-workflow.txt"]
    });
    expect(invalidTrustedRoot.completeness.missing).toContain("workflow-path-invalid");

    const invalidPolicy = await collectRepositoryAuditSnapshot(
      "octocat",
      "demo",
      client({
        getFileAtRevision: vi.fn(({ path }: AuditRepositoryArguments & { path: string }) =>
          Promise.resolve(path === ".reviewready.yml" ? "not: [valid policy" : "workflow")
        )
      })
    );
    expect(invalidPolicy.completeness.missing).toContain("collector-error");
  });

  it("detects a repository default-branch change during the immutable reread", async () => {
    const api = client({
      getRepository: vi
        .fn()
        .mockResolvedValueOnce({ owner: "octocat", name: "demo", defaultBranch: "main" })
        .mockResolvedValueOnce({ owner: "octocat", name: "demo", defaultBranch: "trunk" })
    });

    const snapshot = await collectRepositoryAuditSnapshot("octocat", "demo", api, {
      protectedWorkflowPaths: [workflowPath],
      trustedWorkflowPaths: [workflowPath]
    });

    expect(snapshot.completeness.missing).toContain("base-revision-changed");
  });
});

void ({} as AuditSnapshot);
