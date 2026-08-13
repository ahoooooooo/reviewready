import { readFile } from "node:fs/promises";

import Ajv2020Module from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import {
  auditRepository,
  renderAuditJson,
  renderAuditSarif,
  type AuditSnapshot
} from "../src/audit.js";

type Draft2020Constructor = new (options?: { readonly allErrors?: boolean }) => {
  compile: (schema: object) => (data: unknown) => boolean;
};

const Ajv2020 = Ajv2020Module as unknown as Draft2020Constructor;

const shaA = "a".repeat(40);
const shaB = "b".repeat(40);

const pinnedWorkflow = [
  "on: pull_request",
  "permissions:",
  "  contents: read",
  "jobs:",
  "  review:",
  "    steps:",
  "      - uses: actions/checkout@0123456789abcdef0123456789abcdef01234567"
].join("\n");

function validSnapshot(): AuditSnapshot {
  const check = { name: "ReviewReady", appSlug: "github-actions" };
  return {
    version: 1,
    repository: { owner: "ahoooooooo", name: "reviewready", defaultBranch: "main" },
    baseRevision: {
      sha: shaA,
      policyPath: ".reviewready.yml",
      policyRevisionSha: shaA,
      policyLoadedFromBase: true
    },
    policy: { requiredChecks: [check], workflowPaths: [".github/workflows/reviewready.yml"] },
    completeness: { complete: true, missing: [] },
    branchProtection: {
      branch: "main",
      exists: true,
      enforceAdmins: true,
      allowForcePushes: false,
      allowDeletions: false,
      requiredStatusChecks: { strict: true, checks: [check] },
      requiredPullRequestReviews: { requiredApprovingReviewCount: 1, bypassActors: [] }
    },
    rulesets: [
      {
        id: 1,
        name: "main",
        target: "branch",
        refPatterns: ["refs/heads/main"],
        enforcement: "active",
        bypassActors: [],
        allowForcePushes: false,
        allowDeletions: false,
        requiredChecks: [check]
      }
    ],
    tagProtection: { known: true, allowsDeletion: false, allowsUpdate: false },
    workflows: [
      {
        path: ".github/workflows/reviewready.yml",
        revisionSha: shaA,
        protectedFromPullRequest: true,
        trustedRoot: true,
        source: pinnedWorkflow
      }
    ]
  };
}

describe("repository audit", () => {
  it("passes a complete, protected, provenance-bound snapshot", () => {
    const report = auditRepository(validSnapshot());

    expect(report).toMatchObject({ auditVersion: 1, status: "pass", findings: [] });
  });

  it("accepts a push ruleset without treating it as branch protection", () => {
    const rawSnapshot = validSnapshot() as unknown as {
      rulesets: Array<Record<string, unknown>>;
    };
    const ruleset = rawSnapshot.rulesets[0];
    if (ruleset === undefined) {
      throw new Error("fixture ruleset is required");
    }
    rawSnapshot.rulesets = [
      {
        ...ruleset,
        target: "push",
        refPatterns: [],
        allowForcePushes: undefined,
        allowDeletions: undefined,
        requiredChecks: []
      }
    ];

    const report = auditRepository(rawSnapshot);

    expect(report).toMatchObject({ auditVersion: 1, status: "pass", findings: [] });
  });

  it("does not audit a branch ruleset outside the evaluated default branch", () => {
    const snapshot = validSnapshot();
    const ruleset = snapshot.rulesets[0];
    if (ruleset === undefined) {
      throw new Error("fixture ruleset is required");
    }
    snapshot.rulesets = [
      {
        ...ruleset,
        refPatterns: ["refs/heads/release/*"],
        enforcement: "disabled",
        bypassActors: [{ id: "release-bypass", type: "user" }],
        allowForcePushes: true,
        allowDeletions: true,
        requiredChecks: []
      }
    ];

    const report = auditRepository(snapshot);

    expect(report).toMatchObject({ auditVersion: 1, status: "pass", findings: [] });
  });

  it("fails closed when a branch ruleset omits branch-control facts", () => {
    const rawSnapshot = validSnapshot() as unknown as {
      rulesets: Array<Record<string, unknown>>;
    };
    const ruleset = rawSnapshot.rulesets[0];
    if (ruleset === undefined) {
      throw new Error("fixture ruleset is required");
    }
    rawSnapshot.rulesets = [
      {
        ...ruleset,
        allowForcePushes: undefined,
        allowDeletions: undefined
      }
    ];

    const report = auditRepository(rawSnapshot);

    expect(report.status).toBe("incomplete");
    expect(report.findings.map((finding) => finding.code)).toContain("AUDIT_INPUT_INVALID");
  });

  it("fails closed for incomplete or unbound base policy data", () => {
    const snapshot = validSnapshot();
    snapshot.completeness = { complete: false, missing: ["rulesets"] };
    snapshot.baseRevision.policyLoadedFromBase = false;
    snapshot.baseRevision.policyRevisionSha = shaB;

    const report = auditRepository(snapshot);
    const codes = report.findings.map((finding) => finding.code);

    expect(report.status).toBe("incomplete");
    expect(codes).toContain("AUDIT_SNAPSHOT_INCOMPLETE");
    expect(codes).toContain("AUDIT_POLICY_NOT_FROM_BASE");
    expect(codes).toContain("AUDIT_POLICY_SHA_MISMATCH");
  });

  it("reports duplicate same-name check identities and unsafe controls", () => {
    const snapshot = validSnapshot();
    const branchProtection = snapshot.branchProtection;
    const ruleset = snapshot.rulesets[0];
    const workflow = snapshot.workflows[0];
    if (branchProtection === null || ruleset === undefined || workflow === undefined) {
      throw new Error("fixture protection, ruleset, and workflow are required");
    }
    branchProtection.requiredStatusChecks = {
      strict: true,
      checks: [
        { name: "ReviewReady", appSlug: "github-actions" },
        { name: "ReviewReady", appSlug: "other-provider" }
      ]
    };
    branchProtection.allowForcePushes = true;
    ruleset.allowDeletions = true;
    snapshot.tagProtection.allowsDeletion = true;
    workflow.protectedFromPullRequest = false;

    const report = auditRepository(snapshot);
    const codes = report.findings.map((finding) => finding.code);

    expect(report.status).toBe("fail");
    expect(codes).toEqual([...codes].sort());
    expect(codes).toEqual(
      expect.arrayContaining([
        "AUDIT_CHECK_NAME_AMBIGUOUS",
        "AUDIT_FORCE_PUSH_ALLOWED",
        "AUDIT_BRANCH_DELETION_ALLOWED",
        "AUDIT_TAG_DELETION_ALLOWED",
        "AUDIT_WORKFLOW_NOT_PROTECTED"
      ])
    );
  });

  it("does not satisfy a policy check with a different provider identity", () => {
    const snapshot = validSnapshot();
    const branchProtection = snapshot.branchProtection;
    const ruleset = snapshot.rulesets[0];
    if (branchProtection === null || ruleset === undefined) {
      throw new Error("fixture protection and ruleset are required");
    }
    snapshot.policy.requiredChecks = [{ name: "ReviewReady", appId: 1 }];
    branchProtection.requiredStatusChecks = {
      strict: true,
      checks: [{ name: "ReviewReady", appId: 2 }]
    };
    ruleset.requiredChecks = [{ name: "ReviewReady", appId: 2 }];

    const report = auditRepository(snapshot);

    expect(report.status).not.toBe("pass");
    expect(report.findings.map((finding) => finding.code)).toContain(
      "AUDIT_CHECK_PROVENANCE_MISMATCH"
    );
  });

  it("keeps hostile required-check names out of finding paths and SARIF URIs", () => {
    const snapshot = validSnapshot();
    const branchProtection = snapshot.branchProtection;
    if (branchProtection === null) {
      throw new Error("fixture protection is required");
    }
    const hostileName = "../required\\check?%";
    snapshot.policy.requiredChecks = [{ name: hostileName }];
    branchProtection.requiredStatusChecks = { strict: true, checks: [] };

    const report = auditRepository(snapshot);
    const finding = report.findings.find(
      (candidate) => candidate.code === "AUDIT_REQUIRED_CHECK_MISSING"
    );
    const sarif = JSON.parse(renderAuditSarif(report)) as {
      runs?: Array<{
        results?: Array<{
          ruleId?: string;
          locations?: Array<{ physicalLocation?: { artifactLocation?: { uri?: string } } }>;
        }>;
      }>;
    };
    const sarifFinding = sarif.runs?.[0]?.results?.find(
      (candidate) => candidate.ruleId === "AUDIT_REQUIRED_CHECK_MISSING"
    );

    expect(finding?.path).toBe("policy.requiredChecks[0]");
    expect(sarifFinding?.locations?.[0]?.physicalLocation?.artifactLocation?.uri).toBe(
      "policy.requiredChecks[0]"
    );
    expect(JSON.stringify(report)).not.toContain(hostileName);
  });

  it("does not use an active tag ruleset as default-branch protection", () => {
    const snapshot = validSnapshot();
    const branchProtection = snapshot.branchProtection;
    const ruleset = snapshot.rulesets[0];
    if (branchProtection === null || ruleset === undefined) {
      throw new Error("fixture protection and ruleset are required");
    }
    branchProtection.requiredStatusChecks = { strict: true, checks: [] };
    ruleset.target = "tag";

    const report = auditRepository(snapshot);

    expect(report.status).toBe("incomplete");
    expect(report.findings.map((finding) => finding.code)).toContain(
      "AUDIT_REQUIRED_CHECK_MISSING"
    );
  });

  it("does not use a branch ruleset scoped away from the default branch", () => {
    const snapshot = validSnapshot();
    const branchProtection = snapshot.branchProtection;
    const ruleset = snapshot.rulesets[0];
    if (branchProtection === null || ruleset === undefined) {
      throw new Error("fixture protection and ruleset are required");
    }
    branchProtection.requiredStatusChecks = { strict: true, checks: [] };
    ruleset.refPatterns = ["refs/heads/release/*"];

    const report = auditRepository(snapshot);

    expect(report.status).toBe("incomplete");
    expect(report.findings.map((finding) => finding.code)).toContain(
      "AUDIT_REQUIRED_CHECK_MISSING"
    );
  });

  it("applies GitHub's default-branch ruleset scope to the evaluated branch", () => {
    const snapshot = validSnapshot();
    const branchProtection = snapshot.branchProtection;
    const ruleset = snapshot.rulesets[0];
    if (branchProtection === null || ruleset === undefined) {
      throw new Error("fixture branch protection and ruleset are required");
    }
    branchProtection.requiredStatusChecks = { strict: true, checks: [] };
    ruleset.refPatterns = ["~DEFAULT_BRANCH"];

    const report = auditRepository(snapshot);

    expect(report.status).toBe("pass");
  });

  it("fails closed when an active ruleset scope cannot be evaluated", () => {
    const snapshot = validSnapshot();
    const ruleset = snapshot.rulesets[0];
    if (ruleset === undefined) {
      throw new Error("fixture ruleset is required");
    }
    ruleset.refPatterns = ["["];

    const report = auditRepository(snapshot);

    expect(report.status).toBe("incomplete");
    expect(report.findings.map((finding) => finding.code)).toContain("AUDIT_RULESET_SCOPE_INVALID");
  });

  it("fails closed when a ruleset bypass actor list was redacted by the API", () => {
    const snapshot = validSnapshot();
    const report = auditRepository({
      ...snapshot,
      rulesets: snapshot.rulesets.map((ruleset) => ({
        ...ruleset,
        bypassActorsKnown: false
      }))
    });

    expect(report.status).toBe("incomplete");
    expect(report.findings.map((finding) => finding.code)).toContain(
      "AUDIT_RULESET_BYPASS_UNKNOWN"
    );
  });

  it("fails closed when branch-review bypass actors are unknown", () => {
    const snapshot = validSnapshot();
    const branchProtection = snapshot.branchProtection;
    if (branchProtection === null) {
      throw new Error("fixture review rules are required");
    }
    const reviews = branchProtection.requiredPullRequestReviews;
    if (reviews === null) {
      throw new Error("fixture review rules are required");
    }
    branchProtection.requiredPullRequestReviews = {
      ...reviews,
      bypassActorsKnown: false
    };

    const report = auditRepository(snapshot);

    expect(report.status).toBe("incomplete");
    expect(report.findings.map((finding) => finding.code)).toContain("AUDIT_REVIEW_BYPASS_UNKNOWN");
  });

  it("does not apply a parent ruleset scoped to another repository", () => {
    const snapshot = validSnapshot();
    const ruleset = snapshot.rulesets[0];
    if (ruleset === undefined) {
      throw new Error("fixture ruleset is required");
    }
    ruleset.repositoryPatterns = ["other-owner/other-repository"];

    expect(auditRepository(snapshot)).toMatchObject({ auditVersion: 1, status: "pass" });
  });

  it("fails when branch protection does not require fresh checks or reviews", () => {
    const snapshot = validSnapshot();
    const branchProtection = snapshot.branchProtection;
    if (branchProtection === null || branchProtection.requiredPullRequestReviews === null) {
      throw new Error("fixture branch protection is required");
    }
    branchProtection.requiredStatusChecks = {
      strict: false,
      checks: [{ name: "ReviewReady", appSlug: "github-actions" }]
    };
    branchProtection.requiredPullRequestReviews.requiredApprovingReviewCount = 0;

    const report = auditRepository(snapshot);

    expect(report.status).toBe("fail");
    expect(report.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(["AUDIT_STATUS_CHECKS_NOT_STRICT", "AUDIT_REVIEWS_NOT_REQUIRED"])
    );
  });

  it("fails closed for unknown protection, bypass, scope, tag, and workflow facts", () => {
    const snapshot = validSnapshot();
    const branchProtection = snapshot.branchProtection;
    const baseRuleset = snapshot.rulesets[0];
    const workflow = snapshot.workflows[0];
    if (branchProtection === null || baseRuleset === undefined || workflow === undefined) {
      throw new Error("test fixture is incomplete");
    }

    snapshot.completeness = { complete: false, missing: ["api"] };
    snapshot.baseRevision.policyLoadedFromBase = false;
    snapshot.baseRevision.policyRevisionSha = shaB;
    snapshot.policy.workflowPaths = [workflow.path, ".github/workflows/missing.yml"];
    branchProtection.branch = "release";
    branchProtection.enforceAdmins = false;
    branchProtection.allowForcePushes = true;
    branchProtection.allowDeletions = true;
    branchProtection.requiredStatusChecks = null;
    branchProtection.requiredPullRequestReviews = {
      requiredApprovingReviewCount: 0,
      bypassActors: [{ id: "admin", type: "user" }],
      bypassActorsKnown: false
    };
    snapshot.rulesets = [
      {
        ...baseRuleset,
        id: 2,
        enforcement: "evaluate",
        refPatterns: ["~ALL"],
        bypassActors: [{ id: "bot", type: "app" }],
        bypassActorsKnown: false,
        allowForcePushes: true,
        allowDeletions: true,
        requiredChecks: [{ name: "ReviewReady" }]
      },
      {
        ...baseRuleset,
        id: 3,
        target: "branch",
        refPatterns: ["["],
        repositoryPatterns: ["["]
      },
      {
        ...baseRuleset,
        id: 4,
        target: "repository",
        refPatterns: [],
        repositoryPatterns: ["other-owner/*"]
      },
      {
        ...baseRuleset,
        id: 5,
        refPatterns: ["~ALL"],
        requiredChecks: [{ name: "ReviewReady" }]
      }
    ];
    snapshot.tagProtection = { known: true, allowsDeletion: true, allowsUpdate: true };
    snapshot.workflows = [
      { ...workflow, revisionSha: shaB },
      { ...workflow, revisionSha: shaA }
    ];

    const report = auditRepository(snapshot);
    const codes = report.findings.map((finding) => finding.code);

    expect(report.status).toBe("incomplete");
    expect(codes).toEqual(
      expect.arrayContaining([
        "AUDIT_SNAPSHOT_INCOMPLETE",
        "AUDIT_POLICY_NOT_FROM_BASE",
        "AUDIT_POLICY_SHA_MISMATCH",
        "AUDIT_BRANCH_PROTECTION_WRONG_BRANCH",
        "AUDIT_FORCE_PUSH_ALLOWED",
        "AUDIT_BRANCH_DELETION_ALLOWED",
        "AUDIT_ADMIN_BYPASS_ALLOWED",
        "AUDIT_REVIEWS_NOT_REQUIRED",
        "AUDIT_REVIEW_BYPASS_UNKNOWN",
        "AUDIT_BYPASS_ACTOR_ALLOWED",
        "AUDIT_REQUIRED_CHECKS_UNKNOWN",
        "AUDIT_CHECK_PROVENANCE_UNKNOWN",
        "AUDIT_RULESET_BYPASS_UNKNOWN",
        "AUDIT_RULESET_NOT_ACTIVE",
        "AUDIT_RULESET_SCOPE_INVALID",
        "AUDIT_BYPASS_ACTOR_ALLOWED",
        "AUDIT_TAG_DELETION_ALLOWED",
        "AUDIT_TAG_UPDATE_ALLOWED",
        "AUDIT_WORKFLOW_DUPLICATE",
        "AUDIT_WORKFLOW_MISSING",
        "AUDIT_WORKFLOW_NOT_FROM_BASE"
      ])
    );
  });

  it("reports unknown branch and tag protection rather than treating absence as safe", () => {
    const snapshot = validSnapshot();
    snapshot.branchProtection = null;
    snapshot.tagProtection = {
      known: false,
      allowsDeletion: true,
      allowsUpdate: true
    };

    const report = auditRepository(snapshot);

    expect(report.status).toBe("incomplete");
    expect(report.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(["AUDIT_BRANCH_PROTECTION_UNKNOWN", "AUDIT_TAG_PROTECTION_UNKNOWN"])
    );
  });

  it("checks every workflow for trusted-root protection against same-name spoofing", () => {
    const snapshot = validSnapshot();
    snapshot.workflows.push({
      path: ".github/workflows/attacker.yml",
      revisionSha: "a".repeat(40),
      protectedFromPullRequest: false,
      trustedRoot: false,
      source: "on: pull_request\njobs: {}"
    });

    const report = auditRepository(snapshot);

    expect(report.status).toBe("fail");
    expect(report.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(["AUDIT_WORKFLOW_NOT_PROTECTED", "AUDIT_TRUSTED_ROOT_MISSING"])
    );
  });

  it("requires every normalized workflow source to be read from the base revision", () => {
    const snapshot = validSnapshot();
    snapshot.workflows.push({
      path: ".github/workflows/extra.yml",
      revisionSha: shaB,
      protectedFromPullRequest: true,
      trustedRoot: true,
      source: pinnedWorkflow
    });

    const report = auditRepository(snapshot);

    expect(report.status).toBe("incomplete");
    expect(report.findings.map((finding) => finding.code)).toContain(
      "AUDIT_WORKFLOW_NOT_FROM_BASE"
    );
  });

  it("includes deterministic workflow findings without executing source", () => {
    const snapshot = validSnapshot();
    const workflow = snapshot.workflows[0];
    if (workflow === undefined) {
      throw new Error("fixture workflow is required");
    }
    workflow.source = "on: pull_request_target\n- uses: actions/checkout@v4";

    const report = auditRepository(snapshot);

    expect(report.status).toBe("fail");
    expect(report.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(["ACTION_REF_NOT_PINNED", "PULL_REQUEST_TARGET_WORKFLOW"])
    );
  });

  it("returns incomplete for malformed untrusted input and emits stable SARIF", () => {
    const report = auditRepository({ version: 1, repository: { owner: "x" } });
    const sarif = JSON.parse(renderAuditSarif(report)) as { version: string; runs: unknown[] };

    expect(report.status).toBe("incomplete");
    expect(report.findings[0]?.code).toBe("AUDIT_INPUT_INVALID");
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs).toHaveLength(1);
  });

  it("rejects control and format characters in public repository identity fields", () => {
    const snapshot = validSnapshot();
    snapshot.repository.owner = "octocat\u2028";

    const report = auditRepository(snapshot);

    expect(report.status).toBe("incomplete");
    expect(report.findings[0]?.code).toBe("AUDIT_INPUT_INVALID");
    expect(report.repository.owner).toBe("unknown");
  });

  it("keeps every audit status inside the published Draft 2020-12 schema", async () => {
    const schema = JSON.parse(await readFile("reviewready.audit.schema.json", "utf8")) as object;
    const validate = new Ajv2020({ allErrors: true }).compile(schema);

    const failedSnapshot = validSnapshot();
    const workflow = failedSnapshot.workflows[0];
    if (workflow === undefined) {
      throw new Error("fixture workflow is required");
    }
    workflow.trustedRoot = false;

    for (const report of [
      auditRepository(validSnapshot()),
      auditRepository(failedSnapshot),
      auditRepository({})
    ]) {
      expect(validate(JSON.parse(renderAuditJson(report)))).toBe(true);
    }
  });

  it("keeps the published schema aligned with runtime unsafe-text rejection", async () => {
    const schema = JSON.parse(await readFile("reviewready.audit.schema.json", "utf8")) as object;
    const validate = new Ajv2020({ allErrors: true }).compile(schema);
    const report = JSON.parse(renderAuditJson(auditRepository(validSnapshot()))) as {
      repository: { owner: string };
    };
    report.repository.owner = "octocat\u200b";

    expect(validate(report)).toBe(false);
  });

  it("keeps malformed audit JSON inside the public schema shape", () => {
    const report = auditRepository({});
    const json = JSON.parse(renderAuditJson(report)) as {
      repository?: { baseSha?: unknown };
    };

    expect(json.repository?.baseSha).toEqual(expect.stringMatching(/^[0-9a-f]{40}$/iu));
  });

  it("writes workflow line numbers to SARIF regions rather than URIs", () => {
    const snapshot = validSnapshot();
    const workflow = snapshot.workflows[0];
    if (workflow === undefined) {
      throw new Error("fixture workflow is required");
    }
    workflow.source = [
      ...Array.from({ length: 11 }, () => "# filler"),
      "on: pull_request_target",
      "- uses: actions/checkout@v4"
    ].join("\n");
    const report = auditRepository(snapshot);
    const sarif = JSON.parse(renderAuditSarif(report)) as {
      runs?: Array<{
        results?: Array<{
          ruleId?: string;
          locations?: Array<{
            physicalLocation?: {
              artifactLocation?: { uri?: string };
              region?: { startLine?: number };
            };
          }>;
        }>;
      }>;
    };
    const result = sarif.runs?.[0]?.results?.find(
      (candidate) => candidate.ruleId === "PULL_REQUEST_TARGET_WORKFLOW"
    );
    const location = result?.locations?.[0]?.physicalLocation;

    expect(location?.artifactLocation?.uri).toBe(".github/workflows/reviewready.yml");
    expect(location?.region?.startLine).toBe(12);
  });

  it("URI-encodes untrusted workflow path segments in SARIF", () => {
    const snapshot = validSnapshot();
    const path = ".github/workflows/a#b?c%.yml";
    const workflow = snapshot.workflows[0];
    if (workflow === undefined) {
      throw new Error("fixture workflow is required");
    }
    workflow.path = path;
    snapshot.policy.workflowPaths = [path];
    workflow.source = "on: pull_request_target";

    const report = auditRepository(snapshot);
    const sarif = JSON.parse(renderAuditSarif(report)) as {
      runs?: Array<{
        results?: Array<{
          ruleId?: string;
          locations?: Array<{ physicalLocation?: { artifactLocation?: { uri?: string } } }>;
        }>;
      }>;
    };
    const result = sarif.runs?.[0]?.results?.find(
      (candidate) => candidate.ruleId === "PULL_REQUEST_TARGET_WORKFLOW"
    );

    expect(result?.locations?.[0]?.physicalLocation?.artifactLocation?.uri).toBe(
      ".github/workflows/a%23b%3Fc%25.yml"
    );
  });

  it("keeps capped findings deterministic when workflow input order changes", () => {
    const snapshot = validSnapshot();
    const template = snapshot.workflows[0];
    if (template === undefined) {
      throw new Error("fixture workflow is required");
    }
    const unsafeSource = [
      "on: pull_request_target",
      "permissions: write-all",
      "- uses: actions/checkout@v4",
      "  with:",
      "    ref: ${{ github.event.pull_request.head.sha }}",
      "- run: model --prompt '${{ github.event.pull_request.body }}'",
      "  env:",
      "    SECRET: ${{ secrets.OPENAI_API_KEY }}",
      "- run: deploy '${{ steps.model.outputs.text }}'"
    ].join("\n");
    snapshot.policy.workflowPaths = [];
    snapshot.rulesets = [];
    snapshot.workflows = Array.from({ length: 100 }, (_, index) => ({
      ...template,
      path: `.github/workflows/generated-${String(index)}.yml`,
      source: unsafeSource
    }));
    const reversed = { ...snapshot, workflows: [...snapshot.workflows].reverse() };

    expect(auditRepository(snapshot).findings).toEqual(auditRepository(reversed).findings);
  });

  it("keeps duplicate workflow findings deterministic when source line numbers differ", () => {
    const snapshot = validSnapshot();
    const template = snapshot.workflows[0];
    if (template === undefined) {
      throw new Error("fixture workflow is required");
    }
    snapshot.policy.workflowPaths = [];
    snapshot.rulesets = [];
    snapshot.workflows = [
      { ...template, source: "- uses: actions/checkout@v4" },
      { ...template, source: "# filler\n- uses: actions/checkout@v4" }
    ];

    const reversed = { ...snapshot, workflows: [...snapshot.workflows].reverse() };

    expect(renderAuditJson(auditRepository(snapshot))).toBe(
      renderAuditJson(auditRepository(reversed))
    );
  });

  it("dogfoods the checked-in ReviewReady normalized snapshot", async () => {
    const fixture = JSON.parse(
      await readFile("fixtures/audit/reviewready.json", "utf8")
    ) as unknown;

    const report = auditRepository(fixture);

    expect(report).toMatchObject({ auditVersion: 1, status: "fail" });
    expect(report.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(["AUDIT_WORKFLOW_NOT_PROTECTED", "AUDIT_TRUSTED_ROOT_MISSING"])
    );
  });
});
