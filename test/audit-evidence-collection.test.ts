import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  buildAuditEvidenceBundle,
  createAuditEvidenceSnapshot,
  hashSerializedAuditEvidenceBundle,
  serializeAuditEvidenceBundle
} from "../src/audit-evidence-collection.js";
import { parseCanonicalJsonBytes } from "../src/audit-evidence.js";
import type { JsonValue } from "../src/audit-evidence.js";
import {
  hydrateAuditEvidenceBundle,
  validateAuditEvidenceBundle
} from "../src/audit-evidence-bundle.js";
import type { AuditSnapshot } from "../src/audit.js";

const sha = "a".repeat(40);
const policySource =
  'version: 1\nrules:\n  - id: attestation\n    when:\n      paths:\n        any: ["**"]\n    require:\n      - type: human_attestation\n        text: I understand and take responsibility for this change.\n';
const policySha256 = createHash("sha256").update(policySource, "utf8").digest("hex");

function snapshot(): AuditSnapshot {
  return {
    version: 1,
    repository: { owner: "ahoooooooo", name: "reviewready", defaultBranch: "main" },
    baseRevision: {
      sha,
      policyPath: ".reviewready.yml",
      policyRevisionSha: sha,
      policySha256,
      policyLoadedFromBase: true
    },
    policy: { requiredChecks: [], workflowPaths: [] },
    completeness: { complete: true, missing: [] },
    branchProtection: {
      branch: "main",
      exists: true,
      enforceAdmins: true,
      allowForcePushes: false,
      allowDeletions: false,
      requiredStatusChecks: { strict: true, checks: [] },
      requiredPullRequestReviews: {
        requiredApprovingReviewCount: 1,
        bypassActors: [],
        bypassActorsKnown: true
      }
    },
    rulesets: [],
    tagProtection: { known: true, allowsDeletion: false, allowsUpdate: false },
    workflows: []
  };
}

function buildInput(
  value: AuditSnapshot = snapshot(),
  source = policySource
): Parameters<typeof buildAuditEvidenceBundle>[0] {
  return {
    repository: {
      id: 1,
      owner: "ahoooooooo",
      name: "reviewready",
      ownerType: "organization",
      visibility: "public",
      defaultBranch: "main"
    },
    initialBranchSha: sha,
    endingBranchSha: sha,
    snapshot: createAuditEvidenceSnapshot(value),
    policySource: source,
    workflowSources: [],
    protectedWorkflowPaths: [],
    trustedWorkflowPaths: [],
    observedAt: "2026-08-13T10:20:30.000Z",
    durationMs: 5,
    requestAttempts: 10,
    retryAttempts: 1
  };
}

function expectCode(action: () => unknown, code: string): void {
  expect(action).toThrow(expect.objectContaining({ code }));
}

describe("audit evidence collection projection", () => {
  it("builds a canonical, replayable bundle from a complete collection", () => {
    const bundle = buildAuditEvidenceBundle(buildInput());

    validateAuditEvidenceBundle(bundle);
    const object = bundle as Record<string, JsonValue>;
    expect((object.collection as Record<string, JsonValue>).status).toBe("complete");
    expect((object.report as Record<string, JsonValue>).status).toBe("pass");

    const bytes = serializeAuditEvidenceBundle(bundle);
    expect(new TextDecoder().decode(bytes)).not.toMatch(/\n$/u);
    expect(parseCanonicalJsonBytes(bytes)).toEqual(bundle);
  });

  it("rejects source text containing an unpaired UTF-16 surrogate", () => {
    const path = ".github/workflows/ci.yml";
    const source = "on: pull_request\njobs: {}\uD800";
    const value: AuditSnapshot = {
      ...snapshot(),
      policy: { ...snapshot().policy, workflowPaths: [path] },
      workflows: [
        {
          path,
          revisionSha: sha,
          protectedFromPullRequest: false,
          trustedRoot: false,
          source
        }
      ]
    };

    expect(() => createAuditEvidenceSnapshot(value)).toThrow("evidence-source-invalid");
  });

  it("rejects a complete collection whose derived audit report is incomplete", () => {
    const base = snapshot();
    if (base.branchProtection === null) {
      throw new Error("fixture branch protection is required");
    }
    const value: AuditSnapshot = {
      ...base,
      branchProtection: { ...base.branchProtection, exists: false }
    };

    expect(() => buildAuditEvidenceBundle(buildInput(value))).toThrow("bundle-report-status");
  });

  it("uses the replay comparator for mixed-provider check projections", () => {
    const base = snapshot();
    if (base.branchProtection === null) {
      throw new Error("fixture branch protection is required");
    }
    const value: AuditSnapshot = {
      ...base,
      branchProtection: {
        ...base.branchProtection,
        requiredStatusChecks: {
          strict: true,
          checks: [{ name: "z", appId: 1 }, { name: "a" }]
        }
      }
    };

    const bundle = buildAuditEvidenceBundle(buildInput(value));
    const snapshotValue = (bundle as Record<string, JsonValue>).snapshot as Record<
      string,
      JsonValue
    >;
    const branch = snapshotValue.branchProtection as Record<string, JsonValue>;
    const checks = branch.requiredStatusChecks as Record<string, JsonValue>;
    expect(checks.checks).toEqual([{ name: "a" }, { name: "z", appId: 1 }]);
  });

  it("rejects duplicate branch bypass identities before redaction", () => {
    const base = snapshot();
    if (base.branchProtection === null) {
      throw new Error("fixture branch protection is required");
    }
    const value: AuditSnapshot = {
      ...base,
      branchProtection: {
        ...base.branchProtection,
        requiredPullRequestReviews: {
          requiredApprovingReviewCount: 1,
          bypassActors: [
            { id: "1", type: "user" },
            { id: "1", type: "user" }
          ],
          bypassActorsKnown: true
        }
      }
    };

    expect(() => buildAuditEvidenceBundle(buildInput(value))).toThrow(
      "evidence-branch-actor-duplicate"
    );
  });

  it("rejects the same ruleset bypass identity in different modes", () => {
    const base = snapshot();
    const value: AuditSnapshot = {
      ...base,
      rulesets: [
        {
          id: 1,
          name: "main",
          target: "branch",
          refPatterns: ["~DEFAULT_BRANCH"],
          enforcement: "active",
          bypassActorsKnown: true,
          bypassActors: [
            { id: "1", type: "user", actorType: "user", bypassMode: "always" },
            { id: "1", type: "user", actorType: "user", bypassMode: "exempt" }
          ],
          allowForcePushes: false,
          allowDeletions: false,
          requiredChecks: []
        }
      ]
    };

    expect(() => buildAuditEvidenceBundle(buildInput(value))).toThrow(
      "evidence-ruleset-actor-duplicate"
    );
  });

  it("does not turn an omitted bypass authority fact into known", () => {
    const base = snapshot();
    if (base.branchProtection === null) {
      throw new Error("fixture branch protection is required");
    }
    const value: AuditSnapshot = {
      ...base,
      branchProtection: {
        ...base.branchProtection,
        requiredPullRequestReviews: {
          requiredApprovingReviewCount: 1,
          bypassActors: []
        }
      }
    };

    expect(() => buildAuditEvidenceBundle(buildInput(value))).toThrow(
      "evidence-authority-incomplete"
    );
  });

  it("rejects an authority-incomplete projection without an unknown authority fact", () => {
    const value: AuditSnapshot = {
      ...snapshot(),
      completeness: {
        complete: false,
        missing: ["settings-authority-incomplete"]
      }
    };

    expect(() => buildAuditEvidenceBundle(buildInput(value))).toThrow(
      "evidence-authority-mismatch"
    );
  });

  it("rejects mutually exclusive settings completeness causes", () => {
    const value: AuditSnapshot = {
      ...snapshot(),
      completeness: {
        complete: false,
        missing: ["settings-authority-incomplete", "settings-observation-mismatch"]
      }
    };

    expect(() => buildAuditEvidenceBundle(buildInput(value))).toThrow("evidence-completeness");
  });

  it("rejects a complete collection when review authority is absent", () => {
    const base = snapshot();
    if (base.branchProtection === null) {
      throw new Error("fixture branch protection is required");
    }
    const value: AuditSnapshot = {
      ...base,
      branchProtection: {
        ...base.branchProtection,
        requiredPullRequestReviews: null
      }
    };

    expect(() => buildAuditEvidenceBundle(buildInput(value))).toThrow(
      "evidence-authority-incomplete"
    );
  });

  it("keeps workflow-root report findings separate from settings evidence completeness", () => {
    const path = ".github/workflows/reviewready.yml";
    const source = "on: pull_request\njobs: {}";
    const base = snapshot();
    const value: AuditSnapshot = {
      ...base,
      policy: { ...base.policy, workflowPaths: [path] },
      completeness: {
        complete: false,
        missing: ["trusted-workflow-root", "workflow-protection-root"]
      },
      workflows: [
        {
          path,
          revisionSha: sha,
          protectedFromPullRequest: false,
          trustedRoot: false,
          source
        }
      ]
    };

    const bundle = buildAuditEvidenceBundle({
      ...buildInput(value),
      workflowSources: [{ path, source }]
    });
    const object = bundle as Record<string, JsonValue>;
    expect((object.collection as Record<string, JsonValue>).status).toBe("complete");
    expect((object.report as Record<string, JsonValue>).status).toBe("fail");
  });

  it("replays semantically duplicate policy checks without changing the projection", () => {
    const duplicatePolicySource = [
      "version: 1",
      "rules:",
      "  - id: first",
      "    when:",
      '      paths: { any: ["**"] }',
      "    require:",
      "      - type: check",
      "        name: ReviewReady",
      "        conclusions: [success]",
      "        app: github-actions",
      "  - id: second",
      "    when:",
      '      paths: { any: ["**"] }',
      "    require:",
      "      - type: check",
      "        name: ReviewReady",
      "        conclusions: [success]",
      "        app: github-actions"
    ].join("\n");
    const base = snapshot();
    if (base.branchProtection === null) {
      throw new Error("fixture branch protection is required");
    }
    const value: AuditSnapshot = {
      ...base,
      baseRevision: {
        ...base.baseRevision,
        policySha256: createHash("sha256").update(duplicatePolicySource, "utf8").digest("hex")
      },
      policy: {
        requiredChecks: [{ name: "ReviewReady", appSlug: "github-actions" }],
        workflowPaths: []
      },
      branchProtection: {
        ...base.branchProtection,
        requiredStatusChecks: {
          strict: true,
          checks: [{ name: "ReviewReady", appSlug: "github-actions" }]
        }
      }
    };

    expect(() => buildAuditEvidenceBundle(buildInput(value, duplicatePolicySource))).not.toThrow();
  });

  it("accepts uppercase SHA ingress and persists lowercase values", () => {
    const upperSha = sha.toUpperCase();
    const upperPolicyHash = policySha256.toUpperCase();
    const value: AuditSnapshot = {
      ...snapshot(),
      baseRevision: {
        ...snapshot().baseRevision,
        sha: upperSha,
        policyRevisionSha: upperSha,
        policySha256: upperPolicyHash
      }
    };
    const bundle = buildAuditEvidenceBundle({
      ...buildInput(value),
      initialBranchSha: upperSha,
      endingBranchSha: upperSha
    });
    const object = bundle as Record<string, JsonValue>;
    const subject = object.subject as Record<string, JsonValue>;
    expect(subject.requestedBaseSha).toBe(sha);
  });

  it("projects checks, bypass authorities, rulesets, workflows, and the bundle digest", () => {
    const workflowPath = ".github/workflows/ci.yml";
    const workflowSource = "on: pull_request\njobs: {}";
    const checkSource = [
      "version: 1",
      "rules:",
      "  - id: checks",
      "    when:",
      '      paths: { any: ["**"] }',
      "    require:",
      "      - type: check",
      "        name: Deploy",
      "        app: GitHub-Actions"
    ].join("\n");
    const base = snapshot();
    if (
      base.branchProtection === null ||
      base.branchProtection.requiredPullRequestReviews === null
    ) {
      throw new Error("fixture branch protection is required");
    }
    const rich: AuditSnapshot = {
      ...base,
      baseRevision: {
        ...base.baseRevision,
        policySha256: createHash("sha256").update(checkSource, "utf8").digest("hex")
      },
      policy: {
        requiredChecks: [{ name: "Deploy", appSlug: "github-actions" }],
        workflowPaths: [workflowPath]
      },
      branchProtection: {
        ...base.branchProtection,
        requiredStatusChecks: {
          strict: false,
          checks: [
            { name: "Deploy", appId: 7 },
            { name: "Deploy", appSlug: "GitHub-Actions" }
          ]
        },
        requiredPullRequestReviews: {
          requiredApprovingReviewCount: 2,
          bypassActors: [
            { id: "1", type: "app" },
            { id: "2", type: "team" },
            { id: "3", type: "user" }
          ],
          bypassActorsKnown: true
        }
      },
      rulesets: [
        {
          id: 1,
          name: "main",
          target: "branch",
          refPatterns: ["~DEFAULT_BRANCH"],
          enforcement: "active",
          bypassActorsKnown: true,
          bypassActors: [
            { id: "deploykey", type: "app", actorType: "deploy_key", bypassMode: "always" },
            { id: "1", type: "integration", actorType: "integration", bypassMode: "exempt" },
            {
              id: "organizationadmin",
              type: "user",
              actorType: "organization_admin",
              bypassMode: "always"
            },
            { id: "2", type: "user", actorType: "repository_role", bypassMode: "exempt" },
            { id: "3", type: "team", actorType: "team", bypassMode: "pull_request" },
            { id: "4", type: "user", actorType: "user", bypassMode: "always" }
          ],
          allowForcePushes: false,
          allowDeletions: false,
          requiredChecks: [{ name: "Deploy", appId: 7 }]
        },
        {
          id: 2,
          name: "repository-scope",
          target: "repository",
          refPatterns: [],
          repositoryPatterns: ["ahoooooooo/*"],
          enforcement: "active",
          bypassActorsKnown: true,
          bypassActors: [{ id: "5", type: "user", actorType: "user", bypassMode: "always" }],
          requiredChecks: []
        }
      ],
      workflows: [
        {
          path: workflowPath,
          revisionSha: sha,
          protectedFromPullRequest: false,
          trustedRoot: false,
          source: workflowSource
        }
      ]
    };

    const bundle = buildAuditEvidenceBundle({
      ...buildInput(rich, checkSource),
      workflowSources: [{ path: workflowPath, source: workflowSource }],
      protectedWorkflowPaths: [workflowPath],
      trustedWorkflowPaths: [workflowPath]
    });

    expect(hashSerializedAuditEvidenceBundle(bundle)).toMatch(/^[0-9a-f]{64}$/u);
    expect((bundle as Record<string, JsonValue>).snapshot).toBeDefined();
    expect(() => {
      validateAuditEvidenceBundle(bundle);
    }).not.toThrow();
  });

  it("emits a versioned evidence bundle when ruleset review semantics are present", () => {
    const value: AuditSnapshot = {
      ...snapshot(),
      rulesets: [
        {
          id: 1,
          name: "main-protection",
          target: "branch",
          refPatterns: ["~DEFAULT_BRANCH"],
          enforcement: "active",
          bypassActorsKnown: true,
          bypassActors: [],
          allowForcePushes: false,
          allowDeletions: false,
          requiredChecks: [{ name: "check", appId: 15368 }],
          pullRequest: {
            allowedMergeMethods: ["merge", "rebase", "squash"],
            dismissStaleReviewsOnPush: false,
            requireCodeOwnerReview: false,
            requireLastPushApproval: false,
            requiredApprovingReviewCount: 0,
            requiredReviewThreadResolution: true,
            requiredReviewers: []
          },
          requiredStatusChecksPolicy: {
            doNotEnforceOnCreate: false,
            strictRequiredStatusChecksPolicy: true
          }
        }
      ]
    };

    const bundle = buildAuditEvidenceBundle(buildInput(value));
    const object = bundle as Record<string, JsonValue>;
    const projectedSnapshot = object.snapshot as Record<string, JsonValue>;
    expect(object.bundleVersion).toBe(2);
    expect(projectedSnapshot.snapshotVersion).toBe(2);
    expect(() => {
      validateAuditEvidenceBundle(bundle);
    }).not.toThrow();
    const hydrated = hydrateAuditEvidenceBundle(bundle);
    expect(hydrated.snapshot.rulesets[0]?.pullRequest).toEqual(value.rulesets[0]?.pullRequest);
    expect(hydrated.snapshot.rulesets[0]?.requiredStatusChecksPolicy).toEqual(
      value.rulesets[0]?.requiredStatusChecksPolicy
    );
  });

  it("fails closed on collection bounds, revision, policy, workflow, and authority violations", () => {
    expectCode(
      () =>
        buildAuditEvidenceBundle({
          ...buildInput(),
          repository: { ...buildInput().repository, id: 0 }
        }),
      "evidence-repository"
    );
    expectCode(
      () => buildAuditEvidenceBundle({ ...buildInput(), observedAt: "2026-08-13T10:20:30Z" }),
      "evidence-time"
    );
    expectCode(
      () => buildAuditEvidenceBundle({ ...buildInput(), durationMs: -1 }),
      "evidence-collection-bounds"
    );
    expectCode(
      () => buildAuditEvidenceBundle({ ...buildInput(), requestAttempts: 1, retryAttempts: 2 }),
      "evidence-collection-bounds"
    );
    expectCode(
      () => buildAuditEvidenceBundle({ ...buildInput(), initialBranchSha: "b".repeat(40) }),
      "evidence-revision-mismatch"
    );
    const missingPolicyHash = {
      ...snapshot(),
      baseRevision: { ...snapshot().baseRevision, policySha256: undefined }
    };
    expectCode(
      () => buildAuditEvidenceBundle(buildInput(missingPolicyHash)),
      "evidence-policy-hash"
    );
    expectCode(
      () => buildAuditEvidenceBundle(buildInput(snapshot(), "not: [valid")),
      "evidence-policy-hash"
    );
    const invalidPolicy = {
      ...snapshot(),
      baseRevision: {
        ...snapshot().baseRevision,
        policySha256: createHash("sha256").update("not: [valid", "utf8").digest("hex")
      }
    };
    expectCode(
      () => buildAuditEvidenceBundle(buildInput(invalidPolicy, "not: [valid")),
      "evidence-policy-invalid"
    );
    const workflowPath = ".github/workflows/ci.yml";
    const withWorkflowPath = {
      ...snapshot(),
      policy: { ...snapshot().policy, workflowPaths: [workflowPath] }
    };
    expectCode(
      () =>
        buildAuditEvidenceBundle({
          ...buildInput(withWorkflowPath),
          workflowSources: [
            { path: workflowPath, source: "x" },
            { path: workflowPath, source: "x" }
          ]
        }),
      "evidence-workflow-duplicate"
    );
    expectCode(
      () => buildAuditEvidenceBundle(buildInput(withWorkflowPath)),
      "evidence-workflow-artifact-binding"
    );
    expectCode(
      () =>
        buildAuditEvidenceBundle({
          ...buildInput(),
          workflowSources: [{ path: workflowPath, source: "x" }]
        }),
      "evidence-workflow-artifact-binding"
    );
  });

  it("fails closed with stable codes for malformed base revision runtime values", () => {
    const malformedSha = buildInput();
    (
      malformedSha.snapshot.baseRevision as unknown as { policyRevisionSha: unknown }
    ).policyRevisionSha = null;
    expectCode(() => buildAuditEvidenceBundle(malformedSha), "evidence-sha-invalid");

    const nonBooleanPolicyFlag = buildInput();
    (
      nonBooleanPolicyFlag.snapshot.baseRevision as unknown as { policyLoadedFromBase: unknown }
    ).policyLoadedFromBase = "false";
    expectCode(() => buildAuditEvidenceBundle(nonBooleanPolicyFlag), "evidence-revision-mismatch");
  });

  it("rejects unsafe projected text, paths, providers, and workflow authority", () => {
    expectCode(
      () =>
        buildAuditEvidenceBundle({
          ...buildInput(),
          repository: { ...buildInput().repository, owner: "" }
        }),
      "evidence-text-invalid"
    );
    expectCode(
      () =>
        buildAuditEvidenceBundle({ ...buildInput(), protectedWorkflowPaths: ["../workflow.yml"] }),
      "evidence-workflow-path-invalid"
    );
    const invalidChecks = {
      ...snapshot(),
      policy: {
        requiredChecks: [{ name: "check", appId: 1, appSlug: "actions" }],
        workflowPaths: []
      }
    };
    expectCode(
      () => buildAuditEvidenceBundle(buildInput(invalidChecks)),
      "evidence-check-provider"
    );
    const branchProtection = snapshot().branchProtection;
    if (branchProtection === null) {
      throw new Error("fixture branch protection is required");
    }
    const invalidActor: AuditSnapshot = {
      ...snapshot(),
      branchProtection: {
        ...branchProtection,
        requiredPullRequestReviews: {
          requiredApprovingReviewCount: 1,
          bypassActors: [{ id: "0", type: "user" }],
          bypassActorsKnown: true
        }
      }
    };
    expectCode(() => buildAuditEvidenceBundle(buildInput(invalidActor)), "evidence-branch-actor");
    const protectedWorkflow = {
      ...snapshot(),
      policy: { ...snapshot().policy, workflowPaths: [".github/workflows/ci.yml"] },
      workflows: [
        {
          path: ".github/workflows/ci.yml",
          revisionSha: sha,
          protectedFromPullRequest: true,
          trustedRoot: false,
          source: "x"
        }
      ]
    };
    expectCode(
      () =>
        buildAuditEvidenceBundle({
          ...buildInput(protectedWorkflow),
          workflowSources: [{ path: ".github/workflows/ci.yml", source: "x" }]
        }),
      "evidence-workflow-authority"
    );
  });

  it("covers remaining source, provider, duplicate, and completeness guards", () => {
    const workflowPath = ".github/workflows/ci.yml";
    const validWorkflow = {
      path: workflowPath,
      revisionSha: sha,
      protectedFromPullRequest: false,
      trustedRoot: false,
      source: "😀"
    };
    expect(() =>
      createAuditEvidenceSnapshot({ ...snapshot(), workflows: [validWorkflow] })
    ).not.toThrow();

    expectCode(
      () =>
        createAuditEvidenceSnapshot({
          ...snapshot(),
          workflows: [{ ...validWorkflow, source: "\uDC00" }]
        }),
      "evidence-source-invalid"
    );
    expectCode(
      () =>
        createAuditEvidenceSnapshot({
          ...snapshot(),
          baseRevision: { ...snapshot().baseRevision, sha: "invalid" }
        }),
      "evidence-sha-invalid"
    );
    expectCode(
      () =>
        buildAuditEvidenceBundle(
          buildInput({
            ...snapshot(),
            baseRevision: { ...snapshot().baseRevision, policySha256: "invalid" }
          })
        ),
      "evidence-sha256-invalid"
    );
    expectCode(
      () =>
        buildAuditEvidenceBundle({
          ...buildInput(),
          protectedWorkflowPaths: [workflowPath, workflowPath]
        }),
      "evidence-array-duplicate"
    );

    const invalidProvider = {
      ...snapshot(),
      policy: { requiredChecks: [{ name: "check", appId: 0 }], workflowPaths: [] }
    };
    expectCode(
      () => buildAuditEvidenceBundle(buildInput(invalidProvider)),
      "evidence-check-provider"
    );

    const duplicateChecks = snapshot();
    if (duplicateChecks.branchProtection === null) {
      throw new Error("fixture branch protection is required");
    }
    const duplicateCheckSnapshot: AuditSnapshot = {
      ...duplicateChecks,
      branchProtection: {
        ...duplicateChecks.branchProtection,
        requiredStatusChecks: {
          strict: true,
          checks: [{ name: "duplicate" }, { name: "duplicate" }]
        }
      }
    };
    expectCode(
      () => buildAuditEvidenceBundle(buildInput(duplicateCheckSnapshot)),
      "evidence-check-duplicate"
    );

    const invalidActor = snapshot();
    if (invalidActor.branchProtection === null) {
      throw new Error("fixture branch protection is required");
    }
    const invalidActorSnapshot: AuditSnapshot = {
      ...invalidActor,
      branchProtection: {
        ...invalidActor.branchProtection,
        requiredPullRequestReviews: {
          requiredApprovingReviewCount: 1,
          bypassActors: [{ id: "1", type: "integration" }],
          bypassActorsKnown: true
        }
      }
    };
    expectCode(
      () => buildAuditEvidenceBundle(buildInput(invalidActorSnapshot)),
      "evidence-branch-actor"
    );

    expectCode(
      () =>
        buildAuditEvidenceBundle(
          buildInput({ ...snapshot(), completeness: { complete: false, missing: ["unknown"] } })
        ),
      "evidence-collection-failure"
    );
    expectCode(
      () =>
        buildAuditEvidenceBundle(
          buildInput({
            ...snapshot(),
            completeness: { complete: true, missing: ["trusted-workflow-root"] }
          })
        ),
      "evidence-completeness"
    );
  });
});
