import { describe, expect, it, vi } from "vitest";

import { auditRepository, type AuditSnapshot } from "../src/audit.js";
import {
  collectRepositoryAuditEvidenceData,
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
  const repository = {
    owner: "octocat",
    name: "demo",
    defaultBranch: "main",
    id: 123,
    ownerType: "organization" as const,
    visibility: "public" as const
  };
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
          bypassActors: [],
          bypassActorsKnown: true
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
          bypassActorsKnown: true,
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
  it("returns exact-revision evidence inputs and bounded request metrics", async () => {
    const api = client({
      getRequestMetrics: () => ({ requestAttempts: 12, retryAttempts: 1 })
    });

    const result = await collectRepositoryAuditEvidenceData("octocat", "demo", api, {
      revision: baseSha,
      protectedWorkflowPaths: [workflowPath],
      trustedWorkflowPaths: [workflowPath]
    });

    expect(result.repository).toMatchObject({
      id: 123,
      owner: "octocat",
      name: "demo",
      visibility: "public"
    });
    expect(result.policySource).toBe(policySource);
    expect(result.initialBranchSha).toBe(baseSha);
    expect(result.endingBranchSha).toBe(baseSha);
    expect(result.requestAttempts).toBe(12);
    expect(result.retryAttempts).toBe(1);
  });

  it("waits for the first settings observation before collecting immutable artifacts", async () => {
    let activeRequests = 0;
    let peakRequests = 0;
    let settingsCompletions = 0;
    let firstSettingsComplete = false;
    let artifactStartedEarly = false;

    const observed = async <T>(value: T): Promise<T> => {
      activeRequests += 1;
      peakRequests = Math.max(peakRequests, activeRequests);
      await Promise.resolve();
      activeRequests -= 1;
      return value;
    };
    const observedSetting = async <T>(value: T): Promise<T> => {
      const result = await observed(value);
      settingsCompletions += 1;
      if (settingsCompletions === 3) {
        firstSettingsComplete = true;
      }
      return result;
    };
    const settings = {
      branchProtection: {
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
          bypassActors: [],
          bypassActorsKnown: true
        }
      },
      rulesets: [
        {
          id: 1,
          name: "main",
          target: "branch" as const,
          refPatterns: ["~DEFAULT_BRANCH"],
          enforcement: "active" as const,
          bypassActors: [],
          bypassActorsKnown: true,
          allowForcePushes: false,
          allowDeletions: false,
          requiredChecks: [{ name: "ReviewReady", appSlug: "github-actions" }]
        }
      ],
      tagProtection: { known: true, allowsDeletion: false, allowsUpdate: false }
    };
    const api = client({
      getBranchProtection: vi.fn(() => observedSetting(settings.branchProtection)),
      listRulesets: vi.fn(() => observedSetting(settings.rulesets)),
      getTagProtection: vi.fn(() => observedSetting(settings.tagProtection)),
      listWorkflowFiles: vi.fn(() => {
        if (!firstSettingsComplete) {
          artifactStartedEarly = true;
        }
        return observed([{ path: workflowPath, type: "file" as const }]);
      }),
      getFileAtRevision: vi.fn(({ path }: AuditRepositoryArguments & { path: string }) => {
        if (!firstSettingsComplete) {
          artifactStartedEarly = true;
        }
        return observed(path === ".reviewready.yml" ? policySource : "on: pull_request\njobs: {}");
      }),
      getRequestMetrics: () => ({ requestAttempts: 1, retryAttempts: 0 })
    });

    await collectRepositoryAuditEvidenceData("octocat", "demo", api, {
      revision: baseSha,
      protectedWorkflowPaths: [workflowPath],
      trustedWorkflowPaths: [workflowPath]
    });

    expect(artifactStartedEarly).toBe(false);
    expect(peakRequests).toBeLessThanOrEqual(4);
  });

  it("never exceeds four concurrent mutable reads when ruleset details fan out", async () => {
    let activeRequests = 0;
    let peakRequests = 0;
    const observed = async <T>(value: T): Promise<T> => {
      activeRequests += 1;
      peakRequests = Math.max(peakRequests, activeRequests);
      await Promise.resolve();
      activeRequests -= 1;
      return value;
    };
    const branchProtection = {
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
        bypassActors: [],
        bypassActorsKnown: true
      }
    };
    const rulesets = Array.from({ length: 4 }, (_, index) => ({
      id: index + 1,
      name: `ruleset-${String(index + 1)}`,
      target: "branch" as const,
      refPatterns: ["~DEFAULT_BRANCH"],
      enforcement: "active" as const,
      bypassActors: [],
      bypassActorsKnown: true,
      allowForcePushes: false,
      allowDeletions: false,
      requiredChecks: []
    }));
    const api = client({
      getBranchProtection: vi.fn(() => observed(branchProtection)),
      listRulesets: vi.fn(() => Promise.all(rulesets.map((ruleset) => observed(ruleset)))),
      getTagProtection: vi.fn(() =>
        observed({ known: true, allowsDeletion: false, allowsUpdate: false })
      ),
      getRequestMetrics: () => ({ requestAttempts: 1, retryAttempts: 0 })
    });

    await collectRepositoryAuditEvidenceData("octocat", "demo", api, {
      revision: baseSha,
      protectedWorkflowPaths: [workflowPath],
      trustedWorkflowPaths: [workflowPath]
    });

    expect(peakRequests).toBeLessThanOrEqual(4);
  });

  it("rejects evidence when the final repository observation changes immutable metadata", async () => {
    const repository = {
      owner: "octocat",
      name: "demo",
      defaultBranch: "main",
      id: 123,
      ownerType: "organization" as const,
      visibility: "public" as const
    };
    const api = client({
      getRepository: vi
        .fn()
        .mockResolvedValueOnce(repository)
        .mockResolvedValueOnce(repository)
        .mockResolvedValueOnce({ ...repository, visibility: "private" as const }),
      getRequestMetrics: () => ({ requestAttempts: 1, retryAttempts: 0 })
    });

    await expect(
      collectRepositoryAuditEvidenceData("octocat", "demo", api, { revision: baseSha })
    ).rejects.toThrow("evidence-repository-mismatch");
  });

  it("rejects evidence when the requested revision is not the default-branch head", async () => {
    const api = client({
      getRequestMetrics: () => ({ requestAttempts: 1, retryAttempts: 0 })
    });

    await expect(
      collectRepositoryAuditEvidenceData("octocat", "demo", api, { revision: nextSha })
    ).rejects.toThrow("evidence-revision-not-stable");
  });

  it("requires real API request metrics before evidence output", async () => {
    await expect(
      collectRepositoryAuditEvidenceData("octocat", "demo", client(), { revision: baseSha })
    ).rejects.toThrow("request-metrics-unavailable");
  });

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
      protectedFromPullRequest: false,
      trustedRoot: false
    });
    expect(auditRepository(snapshot)).toMatchObject({ auditVersion: 1, status: "fail" });
    expect(api.getFileAtRevision).toHaveBeenCalledWith(
      expect.objectContaining({ path: ".reviewready.yml", ref: baseSha })
    );
    expect(api.getFileAtRevision).toHaveBeenCalledWith(
      expect.objectContaining({ path: workflowPath, ref: baseSha })
    );
  });

  it("accepts GitHub's canonical casing for an equivalent repository identity", async () => {
    const snapshot = await collectRepositoryAuditSnapshot("Octocat", "Demo", client(), {
      protectedWorkflowPaths: [workflowPath],
      trustedWorkflowPaths: [workflowPath]
    });

    expect(snapshot.completeness.complete).toBe(true);
    expect(auditRepository(snapshot)).toMatchObject({ auditVersion: 1, status: "fail" });
  });

  it("fails closed with a conservative projection when mutable settings change between rounds", async () => {
    const initialBranchProtection = {
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
    };
    const changedBranchProtection = {
      ...initialBranchProtection,
      allowDeletions: true
    };
    const api = client({
      getBranchProtection: vi
        .fn()
        .mockResolvedValueOnce(initialBranchProtection)
        .mockResolvedValueOnce(changedBranchProtection)
    });

    const snapshot = await collectRepositoryAuditSnapshot("octocat", "demo", api, {
      protectedWorkflowPaths: [workflowPath],
      trustedWorkflowPaths: [workflowPath]
    });

    expect(snapshot.completeness).toEqual({
      complete: false,
      missing: ["settings-observation-mismatch"]
    });
    expect(snapshot.branchProtection).toBeNull();
    expect(snapshot.rulesets).toEqual([]);
    expect(snapshot.tagProtection).toEqual({
      known: false,
      allowsDeletion: true,
      allowsUpdate: true
    });
    expect(auditRepository(snapshot).status).toBe("incomplete");
  });

  it("fails closed when an audit requests a non-default branch", async () => {
    const api = client({
      getBranch: vi.fn(({ branch }: AuditRepositoryArguments & { branch: string }) =>
        Promise.resolve({ name: branch, sha: baseSha })
      )
    });

    const snapshot = await collectRepositoryAuditSnapshot("octocat", "demo", api, {
      branch: "feature"
    });

    expect(snapshot.completeness.missing).toContain("non-default-branch");
    expect(snapshot.repository.defaultBranch).toBe("main");
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

  it("does not turn caller workflow-root assertions into authoritative facts", async () => {
    const snapshot = await collectRepositoryAuditSnapshot("octocat", "demo", client(), {
      protectedWorkflowPaths: [workflowPath],
      trustedWorkflowPaths: [workflowPath]
    });

    expect(snapshot.workflows[0]).toMatchObject({
      path: workflowPath,
      protectedFromPullRequest: false,
      trustedRoot: false
    });
    expect(auditRepository(snapshot).findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "AUDIT_WORKFLOW_NOT_PROTECTED" }),
        expect.objectContaining({ code: "AUDIT_TRUSTED_ROOT_MISSING" })
      ])
    );
  });

  it("fails closed for unbounded or unobserved workflow roots", async () => {
    const tooManyRoots = await collectRepositoryAuditSnapshot("octocat", "demo", client(), {
      trustedWorkflowPaths: Array.from(
        { length: 101 },
        (_, index) => ".github/workflows/trusted-" + String(index) + ".yml"
      )
    });
    expect(tooManyRoots.completeness.missing).toContain("workflow-root-limit");

    const tooManyProtectedRoots = await collectRepositoryAuditSnapshot(
      "octocat",
      "demo",
      client(),
      {
        protectedWorkflowPaths: Array.from(
          { length: 101 },
          (_, index) => ".github/workflows/protected-" + String(index) + ".yml"
        )
      }
    );
    expect(tooManyProtectedRoots.completeness.missing).toContain("workflow-root-limit");

    const unobservedRoot = await collectRepositoryAuditSnapshot("octocat", "demo", client(), {
      protectedWorkflowPaths: [workflowPath, ".github/workflows/other.yml"],
      trustedWorkflowPaths: [workflowPath, ".github/workflows/other.yml"]
    });
    expect(unobservedRoot.completeness.missing).toContain("workflow-root-not-observed");
  });

  it("keeps invalid branch input out of the incomplete snapshot", async () => {
    const snapshot = await collectRepositoryAuditSnapshot("octocat", "demo", client(), {
      branch: "b".repeat(513)
    });

    expect(snapshot.completeness.complete).toBe(false);
    expect(snapshot.repository.defaultBranch).toBe("unknown");
  });

  it("fails closed when the API changes repository identity", async () => {
    const snapshot = await collectRepositoryAuditSnapshot(
      "octocat",
      "demo",
      client({
        getRepository: vi.fn(() =>
          Promise.resolve({
            owner: "attacker",
            name: "demo",
            defaultBranch: "main",
            id: 123,
            ownerType: "organization" as const,
            visibility: "public" as const
          })
        )
      })
    );

    expect(snapshot.completeness.missing).toContain("repository-identity-mismatch");
  });

  it("fails closed when the immutable repository ID changes during collection", async () => {
    const api = client({
      getRepository: vi
        .fn()
        .mockResolvedValueOnce({
          owner: "octocat",
          name: "demo",
          defaultBranch: "main",
          id: 123,
          ownerType: "organization" as const,
          visibility: "public" as const
        })
        .mockResolvedValueOnce({
          owner: "octocat",
          name: "demo",
          defaultBranch: "main",
          id: 456,
          ownerType: "organization" as const,
          visibility: "public" as const
        })
    });

    const snapshot = await collectRepositoryAuditSnapshot("octocat", "demo", api, {
      protectedWorkflowPaths: [workflowPath],
      trustedWorkflowPaths: [workflowPath]
    });

    expect(snapshot.completeness.missing).toContain("repository-identity-changed");
  });

  it("fails closed when the collector receives duplicate ruleset identities", async () => {
    const api = client({
      listRulesets: vi.fn(() =>
        Promise.resolve([
          {
            id: 7,
            name: "main",
            target: "branch" as const,
            refPatterns: ["~DEFAULT_BRANCH"],
            enforcement: "active" as const,
            bypassActors: [],
            allowForcePushes: false,
            allowDeletions: false,
            requiredChecks: []
          },
          {
            id: 7,
            name: "main-copy",
            target: "branch" as const,
            refPatterns: ["~DEFAULT_BRANCH"],
            enforcement: "active" as const,
            bypassActors: [],
            allowForcePushes: false,
            allowDeletions: false,
            requiredChecks: []
          }
        ])
      )
    });

    const snapshot = await collectRepositoryAuditSnapshot("octocat", "demo", api);

    expect(snapshot.completeness.missing).toContain("ruleset-duplicate");
  });

  it("sorts canonically equivalent workflow paths without locale collation", async () => {
    const composed = ".github/workflows/ä.yml";
    const decomposed = ".github/workflows/a\u0308.yml";
    const collect = (paths: readonly string[]) =>
      collectRepositoryAuditSnapshot(
        "octocat",
        "demo",
        client({
          listWorkflowFiles: vi.fn(() =>
            Promise.resolve(paths.map((path) => ({ path, type: "file" as const })))
          )
        })
      );

    const first = await collect([decomposed, composed]);
    const second = await collect([composed, decomposed]);

    expect(first.policy.workflowPaths).toEqual(second.policy.workflowPaths);
  });

  it("does not treat equivalent ruleset pattern order as a settings change", async () => {
    const firstRuleset = {
      id: 1,
      name: "main",
      target: "branch" as const,
      refPatterns: ["b", "a"],
      enforcement: "active" as const,
      bypassActors: [],
      allowForcePushes: false,
      allowDeletions: false,
      requiredChecks: []
    };
    const secondRuleset = { ...firstRuleset, refPatterns: ["a", "b"] };
    const api = client({
      listRulesets: vi
        .fn()
        .mockResolvedValueOnce([firstRuleset])
        .mockResolvedValueOnce([secondRuleset])
    });

    const snapshot = await collectRepositoryAuditSnapshot("octocat", "demo", api, {
      protectedWorkflowPaths: [workflowPath],
      trustedWorkflowPaths: [workflowPath]
    });

    expect(snapshot.completeness.missing).not.toContain("settings-observation-mismatch");
  });

  it("does not treat equivalent nested object key order as a settings change", async () => {
    const firstProtection = {
      branch: "main",
      exists: true,
      enforceAdmins: true,
      allowForcePushes: false,
      allowDeletions: false,
      requiredStatusChecks: {
        strict: true,
        checks: [{ appSlug: "github-actions", name: "ReviewReady" }]
      },
      requiredPullRequestReviews: {
        requiredApprovingReviewCount: 1,
        bypassActors: [],
        bypassActorsKnown: true
      }
    } as const;
    const secondProtection = {
      ...firstProtection,
      requiredStatusChecks: {
        strict: true,
        checks: [{ name: "ReviewReady", appSlug: "github-actions" }]
      }
    } as const;
    const api = client({
      getBranchProtection: vi
        .fn()
        .mockResolvedValueOnce(firstProtection)
        .mockResolvedValueOnce(secondProtection)
    });

    const snapshot = await collectRepositoryAuditSnapshot("octocat", "demo", api);

    expect(snapshot.completeness.missing).not.toContain("settings-observation-mismatch");
  });

  it("bounds the number of rulesets accepted by the collector", async () => {
    const ruleset = {
      id: 1,
      name: "main",
      target: "branch" as const,
      refPatterns: ["~DEFAULT_BRANCH"],
      enforcement: "active" as const,
      bypassActors: [],
      allowForcePushes: false,
      allowDeletions: false,
      requiredChecks: []
    };
    const snapshot = await collectRepositoryAuditSnapshot(
      "octocat",
      "demo",
      client({
        listRulesets: vi.fn(() => Promise.resolve(Array.from({ length: 101 }, () => ruleset)))
      })
    );

    expect(snapshot.completeness.missing).toContain("ruleset-count-limit");
  });

  it("rejects workflow source beyond the static analyzer limit", async () => {
    const snapshot = await collectRepositoryAuditSnapshot(
      "octocat",
      "demo",
      client({
        getFileAtRevision: vi.fn(({ path }: AuditRepositoryArguments & { path: string }) =>
          Promise.resolve(path === ".reviewready.yml" ? policySource : "x".repeat(256 * 1024 + 1))
        )
      }),
      { protectedWorkflowPaths: [workflowPath], trustedWorkflowPaths: [workflowPath] }
    );

    expect(snapshot.completeness.missing).toContain("workflow-source-limit");
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
            Promise.resolve({
              owner: "octocat",
              name: "demo",
              defaultBranch: "",
              id: 123,
              ownerType: "organization" as const,
              visibility: "public" as const
            })
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

    const duplicateWorkflowEntry = await collectRepositoryAuditSnapshot(
      "octocat",
      "demo",
      client({
        listWorkflowFiles: vi.fn(() =>
          Promise.resolve([
            { path: workflowPath, type: "file" as const },
            { path: workflowPath, type: "file" as const }
          ])
        )
      })
    );
    expect(duplicateWorkflowEntry.completeness.missing).toContain("workflow-entry-duplicate");

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

    const invalidWorkflowFormatPath = await collectRepositoryAuditSnapshot(
      "octocat",
      "demo",
      client({
        listWorkflowFiles: vi.fn(() =>
          Promise.resolve([{ path: ".github/workflows/bad\u2028.yml", type: "file" as const }])
        )
      })
    );
    expect(invalidWorkflowFormatPath.completeness.missing).toContain("workflow-path-invalid");

    const unicodeFoldedWorkflowPath = await collectRepositoryAuditSnapshot(
      "octocat",
      "demo",
      client({
        listWorkflowFiles: vi.fn(() =>
          Promise.resolve([{ path: ".github/wor\u212Aflows/ci.yml", type: "file" as const }])
        )
      })
    );
    expect(unicodeFoldedWorkflowPath.completeness.missing).toContain("workflow-path-invalid");

    const uppercaseWorkflowPath = await collectRepositoryAuditSnapshot(
      "octocat",
      "demo",
      client({
        listWorkflowFiles: vi.fn(() =>
          Promise.resolve([{ path: ".GITHUB/WORKFLOWS/ci.YML", type: "file" as const }])
        )
      })
    );
    expect(uppercaseWorkflowPath.completeness.missing).not.toContain("workflow-path-invalid");

    const invalidPolicyFormatPath = await collectRepositoryAuditSnapshot(
      "octocat",
      "demo",
      client(),
      { policyPath: ".reviewready\u2028.yml" }
    );
    expect(invalidPolicyFormatPath.completeness.missing).toContain("policy-path-invalid");

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
        .mockResolvedValueOnce({
          owner: "octocat",
          name: "demo",
          defaultBranch: "main",
          id: 123,
          ownerType: "organization" as const,
          visibility: "public" as const
        })
        .mockResolvedValueOnce({
          owner: "octocat",
          name: "demo",
          defaultBranch: "trunk",
          id: 123,
          ownerType: "organization" as const,
          visibility: "public" as const
        })
    });

    const snapshot = await collectRepositoryAuditSnapshot("octocat", "demo", api, {
      protectedWorkflowPaths: [workflowPath],
      trustedWorkflowPaths: [workflowPath]
    });

    expect(snapshot.completeness.missing).toContain("base-revision-changed");
  });
});

void ({} as AuditSnapshot);
