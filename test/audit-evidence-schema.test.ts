import { readFile } from "node:fs/promises";

import Ajv2020Module from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import {
  computeAuditEvidenceIntegrity,
  encodeAuditEvidenceBase64url,
  hydrateAuditEvidenceBundle,
  normalizeAuditEvidenceBundle,
  sha256AuditEvidenceBytes,
  verifyAuditEvidenceSourceArtifact,
  validateAuditEvidenceBundle
} from "../src/audit-evidence-bundle.js";
import {
  buildAuditEvidenceBundle,
  createAuditEvidenceSnapshot
} from "../src/audit-evidence-collection.js";
import { auditRepository, type AuditReport, type AuditSnapshot } from "../src/audit.js";

type Draft2020Constructor = new (options?: {
  readonly allErrors?: boolean;
  readonly strict?: boolean;
}) => {
  compile: (schema: object) => (data: unknown) => boolean;
};

const Ajv2020 = Ajv2020Module as unknown as Draft2020Constructor;

function expectCode(action: () => unknown, code: string): void {
  expect(action).toThrow(expect.objectContaining({ code }));
}

interface EvidenceBundle extends Record<string, unknown> {
  collection: Record<string, unknown>;
  snapshot: Record<string, unknown> & {
    repository: Record<string, unknown>;
  };
  artifacts: {
    policy: Record<string, unknown>;
    workflows: unknown[];
  };
  report: unknown;
}

async function loadSchema(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile("reviewready.audit-evidence.schema.json", "utf8")) as Record<
    string,
    unknown
  >;
}

function validBundle(): EvidenceBundle {
  const sha1 = "a".repeat(40);
  const policySha256 = "92ecf5a78f4a78c58815a358253f72c0705886f828d3802bfd77c75eef4aa732";
  const bundle: EvidenceBundle = {
    bundleVersion: 1,
    canonicalization: "RFC8785",
    subject: {
      repositoryId: 1,
      owner: "ahoooooooo",
      name: "reviewready",
      ownerType: "organization",
      visibility: "public",
      defaultBranch: "main",
      requestedBaseSha: sha1,
      observedBaseShaAtStart: sha1,
      observedBaseShaAtEnd: sha1
    },
    collection: {
      apiVersion: "2026-03-10",
      consistency: "stable-double-observation-v1",
      observedAt: "2026-08-13T10:20:30.000Z",
      durationMs: 1,
      status: "complete",
      missing: [],
      requestAttempts: 1,
      retryAttempts: 0,
      bounds: {
        bundleBytes: 8388608,
        aggregateSourceBytes: 4194304,
        sourceFileBytes: 262144,
        workflows: 100,
        rulesets: 100,
        findings: 500,
        requestAttempts: 768,
        pagesPerCollection: 10,
        itemsPerPage: 100,
        responseBytes: 2097152,
        retriesPerRequest: 1,
        deadlineMs: 120000,
        concurrency: 4,
        jsonDepth: 32,
        jsonObjectMembers: 20000,
        jsonArrayElements: 20000,
        jsonTokens: 100000,
        jsonStringBytes: 6291456,
        jsonNumberChars: 32
      }
    },
    assertions: {
      policyPath: ".reviewready.yml",
      protectedWorkflowPaths: [],
      trustedWorkflowPaths: []
    },
    snapshot: {
      snapshotVersion: 1,
      repository: { owner: "ahoooooooo", name: "reviewready", defaultBranch: "main" },
      baseRevision: {
        sha: sha1,
        policyPath: ".reviewready.yml",
        policyRevisionSha: sha1,
        policySha256,
        policyLoadedFromBase: true
      },
      policy: { requiredChecks: [{ name: "check" }], workflowPaths: [] },
      completeness: { complete: true, missing: [] },
      branchProtection: {
        branch: "main",
        exists: true,
        enforceAdmins: true,
        allowForcePushes: false,
        allowDeletions: false,
        requiredStatusChecks: {
          strict: true,
          checks: [{ name: "check", appSlug: "github-actions" }]
        },
        requiredPullRequestReviews: {
          requiredApprovingReviewCount: 1,
          bypassActorsKnown: true,
          bypassActorSummaries: []
        }
      },
      rulesets: [],
      tagProtection: { known: true, allowsDeletion: false, allowsUpdate: false },
      workflows: []
    },
    artifacts: {
      policy: {
        path: ".reviewready.yml",
        revisionSha: sha1,
        sha256: policySha256,
        byteLength: 119,
        contentBase64url:
          "dmVyc2lvbjogMQpydWxlczoKICAtIGlkOiBhCiAgICB3aGVuOgogICAgICBwYXRoczogeyBhbnk6IFsiKioiXSB9CiAgICByZXF1aXJlOgogICAgICAtIHR5cGU6IGNoZWNrCiAgICAgICAgbmFtZTogY2hlY2s"
      },
      workflows: []
    },
    report: {
      auditVersion: 1,
      status: "pass",
      repository: { owner: "ahoooooooo", name: "reviewready", baseSha: sha1 },
      findings: [],
      checked: ["base-revision", "branch-protection", "rulesets", "tag-protection", "workflows"]
    },
    integrity: {
      algorithm: "sha256",
      snapshotSha256: "b".repeat(64),
      reportSha256: "b".repeat(64),
      payloadSha256: "b".repeat(64)
    }
  };
  bundle.integrity = computeAuditEvidenceIntegrity(bundle);
  return bundle;
}

function richBundle(): EvidenceBundle {
  const sha = "a".repeat(40);
  const workflowPath = ".github/workflows/ci.yml";
  const workflowSource = "on: pull_request\njobs: {}";
  const policySource = [
    "version: 1",
    "rules:",
    "  - id: checks",
    "    when:",
    '      paths: { any: ["**"] }',
    "    require:",
    "      - type: check",
    "        name: check",
    "        app: GitHub-Actions"
  ].join("\n");
  const policySha256 = sha256AuditEvidenceBytes(new TextEncoder().encode(policySource));
  const snapshot: AuditSnapshot = {
    version: 1,
    repository: { owner: "ahoooooooo", name: "reviewready", defaultBranch: "main" },
    baseRevision: {
      sha,
      policyPath: ".reviewready.yml",
      policyRevisionSha: sha,
      policySha256,
      policyLoadedFromBase: true
    },
    policy: {
      requiredChecks: [{ name: "check", appSlug: "github-actions" }],
      workflowPaths: [workflowPath]
    },
    completeness: { complete: true, missing: [] },
    branchProtection: {
      branch: "main",
      exists: true,
      enforceAdmins: true,
      allowForcePushes: false,
      allowDeletions: false,
      requiredStatusChecks: {
        strict: false,
        checks: [
          { name: "check", appId: 7 },
          { name: "check", appSlug: "github-actions" }
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
        requiredChecks: [{ name: "check", appId: 7 }]
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
    tagProtection: { known: true, allowsDeletion: false, allowsUpdate: false },
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
  return buildAuditEvidenceBundle({
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
    snapshot: createAuditEvidenceSnapshot(snapshot),
    policySource,
    workflowSources: [{ path: workflowPath, source: workflowSource }],
    protectedWorkflowPaths: [workflowPath],
    trustedWorkflowPaths: [workflowPath],
    observedAt: "2026-08-13T10:20:30.000Z",
    durationMs: 2,
    requestAttempts: 2,
    retryAttempts: 0
  }) as EvidenceBundle;
}

function versionedRuleset(): Record<string, unknown> {
  return {
    id: 1,
    name: "main-protection",
    target: "branch",
    refPatterns: ["~DEFAULT_BRANCH"],
    enforcement: "active",
    bypassActorsKnown: true,
    bypassActorSummaries: [],
    allowForcePushes: false,
    allowDeletions: false,
    requiredChecks: [],
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
  };
}

function firstRuleset(bundle: EvidenceBundle): Record<string, unknown> {
  const ruleset = (bundle.snapshot.rulesets as Array<Record<string, unknown>>)[0];
  if (ruleset === undefined) {
    throw new Error("fixture ruleset is required");
  }
  return ruleset;
}

describe("audit evidence bundle schema", () => {
  it("accepts v2 ruleset semantics and rejects those semantics in v1", async () => {
    const validator = new Ajv2020({ allErrors: true, strict: true }).compile(await loadSchema());
    const version2 = validBundle();
    version2.bundleVersion = 2;
    version2.snapshot.snapshotVersion = 2;
    version2.snapshot.rulesets = [versionedRuleset()];
    version2.integrity = computeAuditEvidenceIntegrity(version2);

    expect(validator(version2)).toBe(true);
    expect(() => {
      validateAuditEvidenceBundle(version2);
    }).not.toThrow();

    const emptyVersion2 = validBundle();
    emptyVersion2.bundleVersion = 2;
    emptyVersion2.snapshot.snapshotVersion = 2;
    emptyVersion2.integrity = computeAuditEvidenceIntegrity(emptyVersion2);
    expect(validator(emptyVersion2)).toBe(false);
    expectCode(() => {
      validateAuditEvidenceBundle(emptyVersion2);
    }, "bundle-version");

    const version1 = validBundle();
    version1.snapshot.rulesets = [versionedRuleset()];
    version1.integrity = computeAuditEvidenceIntegrity(version1);
    expect(validator(version1)).toBe(false);
    expectCode(() => {
      validateAuditEvidenceBundle(version1);
    }, "bundle-version");
  });

  it("normalizes and rejects v2 semantic edge cases without lossy coercion", () => {
    const unsorted = validBundle();
    unsorted.bundleVersion = 2;
    unsorted.snapshot.snapshotVersion = 2;
    const unsortedRuleset = versionedRuleset();
    (unsortedRuleset.pullRequest as Record<string, unknown>).allowedMergeMethods = [
      "squash",
      "merge",
      "rebase"
    ];
    unsorted.snapshot.rulesets = [unsortedRuleset];
    const normalized = normalizeAuditEvidenceBundle(unsorted);
    const normalizedRuleset = (normalized.snapshot.rulesets as Array<Record<string, unknown>>)[0];
    expect((normalizedRuleset?.pullRequest as Record<string, unknown>).allowedMergeMethods).toEqual(
      ["merge", "rebase", "squash"]
    );

    const lossyReviewerInput = validBundle();
    lossyReviewerInput.bundleVersion = 2;
    lossyReviewerInput.snapshot.snapshotVersion = 2;
    const reviewerRuleset = versionedRuleset();
    (reviewerRuleset.pullRequest as Record<string, unknown>).requiredReviewers = [{}];
    lossyReviewerInput.snapshot.rulesets = [reviewerRuleset];
    expect(() => {
      normalizeAuditEvidenceBundle(lossyReviewerInput);
    }).toThrow("bundle-ruleset-reviewers-unsupported");

    const cases: readonly [(bundle: EvidenceBundle) => void, string][] = [
      [
        (bundle) => {
          const ruleset = firstRuleset(bundle);
          (ruleset.pullRequest as Record<string, unknown>).allowedMergeMethods = [];
          bundle.integrity = computeAuditEvidenceIntegrity(bundle);
        },
        "bundle-ruleset-review"
      ],
      [
        (bundle) => {
          const ruleset = firstRuleset(bundle);
          (ruleset.pullRequest as Record<string, unknown>).requiredReviewers = [{}];
          bundle.integrity = computeAuditEvidenceIntegrity(bundle);
        },
        "bundle-ruleset-reviewers-unsupported"
      ],
      [
        (bundle) => {
          const ruleset = firstRuleset(bundle);
          (ruleset.requiredStatusChecksPolicy as Record<string, unknown>).extra = true;
          bundle.integrity = computeAuditEvidenceIntegrity(bundle);
        },
        "bundle-ruleset-status"
      ]
    ];
    for (const [mutate, code] of cases) {
      const invalid = validBundle();
      invalid.bundleVersion = 2;
      invalid.snapshot.snapshotVersion = 2;
      invalid.snapshot.rulesets = [versionedRuleset()];
      mutate(invalid);
      expectCode(() => {
        validateAuditEvidenceBundle(invalid);
      }, code);
    }
  });

  it("is a closed Draft 2020-12 schema with the frozen version surface", async () => {
    const schema = await loadSchema();
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual([
      "bundleVersion",
      "canonicalization",
      "subject",
      "collection",
      "assertions",
      "snapshot",
      "artifacts",
      "report",
      "integrity"
    ]);
    const defs = schema.$defs as Record<string, Record<string, unknown> | undefined>;
    const auditReport = defs.auditReport;
    expect(auditReport).toBeDefined();
    expect(auditReport?.additionalProperties).toBe(false);
  });

  it("compiles as an independent strict Draft 2020-12 schema", async () => {
    const schema = await loadSchema();
    expect(() => {
      new Ajv2020({ allErrors: true, strict: true }).compile(schema);
    }).not.toThrow();
  });

  it("accepts workflow path casing used by the runtime", async () => {
    const schema = await loadSchema();
    const validator = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
    const bundle = validBundle();
    const path = ".GITHUB/workflows/ci.yml";
    const source = "on: pull_request\njobs: {}";
    const bytes = new TextEncoder().encode(source);
    const artifactSha256 = sha256AuditEvidenceBytes(bytes);
    bundle.snapshot.policy = { requiredChecks: [{ name: "check" }], workflowPaths: [path] };
    bundle.snapshot.workflows = [
      {
        path,
        revisionSha: "a".repeat(40),
        artifactSha256,
        protectedFromPullRequest: false,
        trustedRoot: false
      }
    ];
    bundle.artifacts.workflows = [
      {
        path,
        revisionSha: "a".repeat(40),
        sha256: artifactSha256,
        byteLength: bytes.byteLength,
        contentBase64url: encodeAuditEvidenceBase64url(bytes)
      }
    ];
    bundle.integrity = computeAuditEvidenceIntegrity(bundle);

    expect(validator(bundle)).toBe(true);
    expect(() => {
      verifyAuditEvidenceSourceArtifact(
        {
          path,
          revisionSha: "a".repeat(40),
          sha256: sha256AuditEvidenceBytes(new Uint8Array()),
          byteLength: 0,
          contentBase64url: ""
        },
        "workflow"
      );
    }).not.toThrow();
  });

  it("rejects Unicode-folded workflow paths in both runtime and public schema", async () => {
    const schema = await loadSchema();
    const validator = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
    const bundle = validBundle();
    const path = ".github/wor\u212Aflows/ci.yml";
    const source = "on: pull_request\njobs: {}";
    const bytes = new TextEncoder().encode(source);
    const artifactSha256 = sha256AuditEvidenceBytes(bytes);
    bundle.snapshot.policy = { requiredChecks: [{ name: "check" }], workflowPaths: [path] };
    bundle.snapshot.workflows = [
      {
        path,
        revisionSha: "a".repeat(40),
        artifactSha256,
        protectedFromPullRequest: false,
        trustedRoot: false
      }
    ];
    bundle.artifacts.workflows = [
      {
        path,
        revisionSha: "a".repeat(40),
        sha256: artifactSha256,
        byteLength: bytes.byteLength,
        contentBase64url: encodeAuditEvidenceBase64url(bytes)
      }
    ];
    bundle.integrity = computeAuditEvidenceIntegrity(bundle);

    expect(validator(bundle)).toBe(false);
    expect(() => {
      validateAuditEvidenceBundle(bundle);
    }).toThrow();
  });

  it("keeps strict schema and runtime bounds aligned", async () => {
    const schema = await loadSchema();
    const validator = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
    const invalidSlug = validBundle();
    const branch = invalidSlug.snapshot.branchProtection as Record<string, unknown>;
    const checks = branch.requiredStatusChecks as Record<string, unknown>;
    checks.checks = [{ name: "check", appSlug: "a".repeat(513) }];
    invalidSlug.integrity = computeAuditEvidenceIntegrity(invalidSlug);
    expect(validator(invalidSlug)).toBe(false);
    expect(() => {
      validateAuditEvidenceBundle(invalidSlug);
    }).toThrow("bundle-check");

    const invalidRepositoryPatterns = validBundle();
    invalidRepositoryPatterns.snapshot.rulesets = [
      {
        id: 1,
        name: "repository",
        target: "repository",
        refPatterns: [],
        repositoryPatterns: [],
        enforcement: "active",
        bypassActorsKnown: true,
        bypassActorSummaries: [],
        requiredChecks: []
      }
    ];
    invalidRepositoryPatterns.integrity = computeAuditEvidenceIntegrity(invalidRepositoryPatterns);
    expect(validator(invalidRepositoryPatterns)).toBe(false);
    expect(() => {
      validateAuditEvidenceBundle(invalidRepositoryPatterns);
    }).toThrow("bundle-ruleset");

    const invalidPushRepositoryPatterns = validBundle();
    invalidPushRepositoryPatterns.snapshot.rulesets = [
      {
        id: 1,
        name: "push",
        target: "push",
        refPatterns: [],
        repositoryPatterns: [],
        enforcement: "active",
        bypassActorsKnown: true,
        bypassActorSummaries: [],
        requiredChecks: []
      }
    ];
    invalidPushRepositoryPatterns.integrity = computeAuditEvidenceIntegrity(
      invalidPushRepositoryPatterns
    );
    expect(validator(invalidPushRepositoryPatterns)).toBe(false);
    expect(() => {
      validateAuditEvidenceBundle(invalidPushRepositoryPatterns);
    }).toThrow("bundle-ruleset");
  });

  it("makes the frozen report check order structural and documents semantic finding order", async () => {
    const schema = await loadSchema();
    const validator = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
    const reportProperties = ((schema.$defs as Record<string, Record<string, unknown> | undefined>)
      .auditReport?.properties ?? {}) as Record<string, Record<string, unknown> | undefined>;
    expect(reportProperties.findings?.$comment).toContain("frozen comparator order");

    const invalidChecked = validBundle();
    (invalidChecked.report as Record<string, unknown>).checked = [
      "workflows",
      "tag-protection",
      "rulesets",
      "branch-protection",
      "base-revision"
    ];
    invalidChecked.integrity = computeAuditEvidenceIntegrity(invalidChecked);
    expect(validator(invalidChecked)).toBe(false);
    expectCode(() => {
      validateAuditEvidenceBundle(invalidChecked);
    }, "bundle-report");

    const invalidFindings = validBundle();
    (invalidFindings.report as Record<string, unknown>).findings = [
      { code: "z", category: "integrity", severity: "error", message: "z" },
      { code: "a", category: "integrity", severity: "error", message: "a" }
    ];
    invalidFindings.integrity = computeAuditEvidenceIntegrity(invalidFindings);
    expect(validator(invalidFindings)).toBe(true);
    expectCode(() => {
      validateAuditEvidenceBundle(invalidFindings);
    }, "bundle-report-order");
  });

  it("documents the runtime-only retry count relation", async () => {
    const schema = await loadSchema();
    const validator = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
    const collectionProperties = ((
      schema.$defs as Record<string, Record<string, unknown> | undefined>
    ).collection?.properties ?? {}) as Record<string, Record<string, unknown> | undefined>;
    expect(collectionProperties.retryAttempts?.$comment).toContain(
      "no greater than requestAttempts"
    );

    const invalid = validBundle();
    invalid.collection.requestAttempts = 1;
    invalid.collection.retryAttempts = 2;
    invalid.integrity = computeAuditEvidenceIntegrity(invalid);
    expect(validator(invalid)).toBe(true);
    expectCode(() => {
      validateAuditEvidenceBundle(invalid);
    }, "bundle-retry-count");
  });

  it("does not let complete evidence contain a null branch-protection fact", async () => {
    const schema = await loadSchema();
    const validator = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
    const invalid = validBundle();
    invalid.snapshot.branchProtection = null;
    invalid.integrity = computeAuditEvidenceIntegrity(invalid);
    expect(validator(invalid)).toBe(false);
    expect(() => {
      validateAuditEvidenceBundle(invalid);
    }).toThrow("bundle-branch-protection");

    const unknownReviewAuthority = validBundle();
    (
      unknownReviewAuthority.snapshot.branchProtection as Record<string, unknown>
    ).requiredPullRequestReviews = {
      requiredApprovingReviewCount: 1,
      bypassActorsKnown: false,
      bypassActorSummaries: []
    };
    unknownReviewAuthority.integrity = computeAuditEvidenceIntegrity(unknownReviewAuthority);
    expect(validator(unknownReviewAuthority)).toBe(false);
    expect(() => {
      validateAuditEvidenceBundle(unknownReviewAuthority);
    }).toThrow("bundle-authority-incomplete");
  });

  it("rejects a complete collection with an incomplete audit report", () => {
    const bundle = validBundle();
    bundle.snapshot.rulesets = [
      {
        id: 1,
        name: "tags",
        target: "tag",
        refPatterns: ["refs/tags/*"],
        enforcement: "active",
        bypassActorsKnown: true,
        bypassActorSummaries: [],
        allowForcePushes: false,
        allowDeletions: false,
        requiredChecks: []
      }
    ];
    const workflowPath = ".github/workflows/noisy.yml";
    const workflowSource = Array.from({ length: 110 }, () => "- uses: actions/checkout@v4").join(
      "\n"
    );
    const workflowBytes = new TextEncoder().encode(workflowSource);
    const workflowSha256 = sha256AuditEvidenceBytes(workflowBytes);
    bundle.snapshot.policy = {
      requiredChecks: [{ name: "check" }],
      workflowPaths: [workflowPath]
    };
    bundle.snapshot.workflows = [
      {
        path: workflowPath,
        revisionSha: "a".repeat(40),
        artifactSha256: workflowSha256,
        protectedFromPullRequest: false,
        trustedRoot: false
      }
    ];
    bundle.artifacts = {
      policy: bundle.artifacts.policy,
      workflows: [
        {
          path: workflowPath,
          revisionSha: "a".repeat(40),
          sha256: workflowSha256,
          byteLength: workflowBytes.byteLength,
          contentBase64url: encodeAuditEvidenceBase64url(workflowBytes)
        }
      ]
    };
    const snapshot: AuditSnapshot = {
      version: 1 as const,
      repository: { owner: "ahoooooooo", name: "reviewready", defaultBranch: "main" },
      baseRevision: {
        sha: "a".repeat(40),
        policyPath: ".reviewready.yml",
        policyRevisionSha: "a".repeat(40),
        policySha256: "92ecf5a78f4a78c58815a358253f72c0705886f828d3802bfd77c75eef4aa732",
        policyLoadedFromBase: true
      },
      policy: { requiredChecks: [{ name: "check" }], workflowPaths: [workflowPath] },
      completeness: { complete: true, missing: [] },
      branchProtection: {
        branch: "main",
        exists: true,
        enforceAdmins: true,
        allowForcePushes: false,
        allowDeletions: false,
        requiredStatusChecks: {
          strict: true,
          checks: [{ name: "check", appSlug: "github-actions" }]
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
          name: "tags",
          target: "tag" as const,
          refPatterns: ["refs/tags/*"],
          enforcement: "active" as const,
          bypassActors: [],
          bypassActorsKnown: true,
          allowForcePushes: false,
          allowDeletions: false,
          requiredChecks: []
        }
      ],
      tagProtection: { known: true, allowsDeletion: false, allowsUpdate: false },
      workflows: [
        {
          path: workflowPath,
          revisionSha: "a".repeat(40),
          protectedFromPullRequest: false,
          trustedRoot: false,
          source: workflowSource
        }
      ]
    };
    bundle.report = auditRepository(snapshot);
    bundle.integrity = computeAuditEvidenceIntegrity(bundle);
    expect((bundle.report as AuditReport).status).toBe("incomplete");
    expect(() => {
      validateAuditEvidenceBundle(bundle);
    }).toThrow("bundle-report-status");
  });

  it("accepts the minimal frozen shape and rejects unknown nested fields", async () => {
    const validate = new Ajv2020({ allErrors: true }).compile(await loadSchema());
    const bundle = validBundle();
    expect(validate(bundle)).toBe(true);

    const invalid = structuredClone(bundle);
    invalid.snapshot.repository.untrusted = true;
    expect(validate(invalid)).toBe(false);

    const invalidTimestamp = structuredClone(bundle);
    invalidTimestamp.collection.observedAt = "2026-99-99T99:99:99.999Z";
    expect(validate(invalidTimestamp)).toBe(false);

    const invalidCalendarDate = structuredClone(bundle);
    invalidCalendarDate.collection.observedAt = "2026-02-31T00:00:00.000Z";
    expect(validate(invalidCalendarDate)).toBe(false);
  });

  it("keeps fixed collection bounds and rejects an unsupported API version", async () => {
    const schema = await loadSchema();
    const defs = schema.$defs as Record<string, Record<string, unknown> | undefined>;
    const bounds = defs.collectionBounds?.properties as
      Record<string, Record<string, unknown> | undefined> | undefined;
    expect(bounds?.bundleBytes?.const).toBe(8388608);
    expect(bounds?.requestAttempts?.const).toBe(768);
    expect(bounds?.jsonTokens?.const).toBe(100000);

    const validate = new Ajv2020({ allErrors: true }).compile(schema);
    const invalid = validBundle();
    invalid.collection.apiVersion = "latest";
    expect(validate(invalid)).toBe(false);
  });

  it("enforces target-specific ruleset shapes", async () => {
    const validate = new Ajv2020({ allErrors: true }).compile(await loadSchema());
    const cases = [
      {
        target: "branch",
        refPatterns: [],
        enforcement: "active",
        allowForcePushes: false,
        allowDeletions: false
      },
      {
        target: "push",
        refPatterns: ["refs/heads/main"],
        enforcement: "active"
      },
      {
        target: "repository",
        refPatterns: [],
        enforcement: "evaluate",
        repositoryPatterns: ["ahoooooooo/*"]
      },
      {
        target: "branch",
        refPatterns: ["refs/heads/main"],
        enforcement: "active",
        allowForcePushes: false,
        allowDeletions: false,
        bypassActorSummaries: [{ actorType: "deploy_key", bypassMode: "pull_request", count: 1 }]
      },
      {
        target: "tag",
        refPatterns: ["refs/tags/v1"],
        enforcement: "active",
        allowForcePushes: false,
        allowDeletions: false,
        bypassActorSummaries: [{ actorType: "integration", bypassMode: "pull_request", count: 1 }]
      },
      {
        target: "branch",
        refPatterns: ["refs/heads/main"],
        enforcement: "active",
        allowForcePushes: false,
        allowDeletions: false,
        bypassActorSummaries: [{ actorType: "deploy_key", bypassMode: "always", count: 2 }]
      }
    ] as const;

    for (const ruleset of cases) {
      const invalid = validBundle();
      (invalid.snapshot as Record<string, unknown>).rulesets = [
        {
          id: 1,
          name: "test",
          bypassActorsKnown: true,
          bypassActorSummaries: [],
          requiredChecks: [],
          ...ruleset
        }
      ];
      expect(validate(invalid)).toBe(false);
    }
  });

  it("rejects invalid base64 lengths, empty policy artifacts, and complete unknown facts", async () => {
    const validate = new Ajv2020({ allErrors: true }).compile(await loadSchema());

    const invalidBase64 = validBundle();
    (
      (invalidBase64.artifacts as Record<string, unknown>).policy as Record<string, unknown>
    ).contentBase64url = "A";
    expect(validate(invalidBase64)).toBe(false);

    const nonCanonicalBase64 = validBundle();
    (
      (nonCanonicalBase64.artifacts as Record<string, unknown>).policy as Record<string, unknown>
    ).contentBase64url = "eB";
    expect(validate(nonCanonicalBase64)).toBe(false);

    const uppercaseReportSha = validBundle();
    (
      (uppercaseReportSha.report as Record<string, unknown>).repository as Record<string, unknown>
    ).baseSha = "A".repeat(40);
    expect(validate(uppercaseReportSha)).toBe(false);

    const unicodeBound = validBundle();
    ((unicodeBound.report as Record<string, unknown>).repository as Record<string, unknown>).name =
      "😀".repeat(512);
    expect(validate(unicodeBound)).toBe(true);

    const emptyPolicy = validBundle();
    (
      (emptyPolicy.artifacts as Record<string, unknown>).policy as Record<string, unknown>
    ).byteLength = 0;
    expect(validate(emptyPolicy)).toBe(false);

    const completeUnknown = validBundle();
    (completeUnknown.snapshot as Record<string, unknown>).tagProtection = {
      known: false,
      allowsDeletion: true,
      allowsUpdate: true
    };
    expect(validate(completeUnknown)).toBe(false);

    const workflowPath = validBundle();
    (workflowPath.artifacts as Record<string, unknown>).workflows = [
      {
        path: ".reviewready.yml",
        revisionSha: "a".repeat(40),
        sha256: "b".repeat(64),
        byteLength: 1,
        contentBase64url: "eA"
      }
    ];
    expect(validate(workflowPath)).toBe(false);

    const userOrganizationAdmin = validBundle();
    (userOrganizationAdmin.subject as Record<string, unknown>).ownerType = "user";
    (userOrganizationAdmin.snapshot as Record<string, unknown>).rulesets = [
      {
        id: 1,
        name: "test",
        target: "branch",
        refPatterns: ["refs/heads/main"],
        enforcement: "active",
        bypassActorsKnown: true,
        bypassActorSummaries: [{ actorType: "organization_admin", bypassMode: "always", count: 1 }],
        allowForcePushes: false,
        allowDeletions: false,
        requiredChecks: []
      }
    ];
    expect(validate(userOrganizationAdmin)).toBe(false);
  });

  it("runtime-validates cross-field identity, time, retry, and completeness relations", () => {
    const valid = validBundle();
    expect(() => {
      validateAuditEvidenceBundle(valid);
    }).not.toThrow();

    const unicodeBound = validBundle();
    const rulesets = unicodeBound.snapshot.rulesets as Array<Record<string, unknown>>;
    rulesets.push({
      id: 1,
      name: "😀".repeat(512),
      target: "push",
      refPatterns: [],
      enforcement: "active",
      bypassActorsKnown: true,
      bypassActorSummaries: [],
      requiredChecks: []
    });
    unicodeBound.integrity = computeAuditEvidenceIntegrity(unicodeBound);
    expect(() => {
      validateAuditEvidenceBundle(unicodeBound);
    }).not.toThrow();

    const shaMismatch = validBundle();
    (shaMismatch.snapshot as Record<string, unknown>).baseRevision = {
      ...((shaMismatch.snapshot as Record<string, unknown>).baseRevision as Record<
        string,
        unknown
      >),
      sha: "c".repeat(40)
    };
    expectCode(() => {
      validateAuditEvidenceBundle(shaMismatch);
    }, "bundle-revision-mismatch");

    const retryMismatch = validBundle();
    retryMismatch.collection.requestAttempts = 1;
    retryMismatch.collection.retryAttempts = 2;
    expectCode(() => {
      validateAuditEvidenceBundle(retryMismatch);
    }, "bundle-retry-count");

    const dateMismatch = validBundle();
    dateMismatch.collection.observedAt = "2026-99-99T99:99:99.999Z";
    expectCode(() => {
      validateAuditEvidenceBundle(dateMismatch);
    }, "bundle-time");

    const calendarDateMismatch = validBundle();
    calendarDateMismatch.collection.observedAt = "2026-02-31T00:00:00.000Z";
    expectCode(() => {
      validateAuditEvidenceBundle(calendarDateMismatch);
    }, "bundle-time");

    const completenessMismatch = validBundle();
    (completenessMismatch.snapshot as Record<string, unknown>).completeness = {
      complete: false,
      missing: ["settings-authority-incomplete"]
    };
    expectCode(() => {
      validateAuditEvidenceBundle(completenessMismatch);
    }, "bundle-completeness-mismatch");
  });

  it("recomputes all integrity domains instead of trusting digest-shaped strings", () => {
    const snapshotTamper = validBundle();
    (
      (snapshotTamper.snapshot as Record<string, unknown>).tagProtection as Record<string, unknown>
    ).allowsUpdate = true;
    expectCode(() => {
      validateAuditEvidenceBundle(snapshotTamper);
    }, "bundle-integrity");

    const reportTamper = validBundle();
    (reportTamper.report as Record<string, unknown>).status = "fail";
    expectCode(() => {
      validateAuditEvidenceBundle(reportTamper);
    }, "bundle-integrity");

    const payloadTamper = validBundle();
    payloadTamper.collection.durationMs = 2;
    expectCode(() => {
      validateAuditEvidenceBundle(payloadTamper);
    }, "bundle-integrity");
  });

  it("requires source artifacts to produce the saved policy projection", () => {
    const forged = validBundle();
    (forged.snapshot.policy as Record<string, unknown>).requiredChecks = [];
    forged.integrity = computeAuditEvidenceIntegrity(forged);
    expectCode(() => {
      validateAuditEvidenceBundle(forged);
    }, "bundle-policy-derived");
  });

  it("requires workflow assertions to name saved workflow artifacts", () => {
    const bundle = validBundle();
    bundle.assertions = {
      policyPath: ".reviewready.yml",
      protectedWorkflowPaths: [".github/workflows/ci.yml"],
      trustedWorkflowPaths: []
    };
    bundle.integrity = computeAuditEvidenceIntegrity(bundle);
    expectCode(() => {
      validateAuditEvidenceBundle(bundle);
    }, "bundle-assertions");
  });

  it("recomputes the saved report from the hydrated source-free snapshot", () => {
    const forged = validBundle();
    const report = forged.report as Record<string, unknown>;
    forged.report = {
      ...report,
      status: "fail"
    };
    forged.integrity = computeAuditEvidenceIntegrity(forged);
    expectCode(() => {
      validateAuditEvidenceBundle(forged);
    }, "bundle-report-recomputed");
  });

  it("fails closed on unknown branch-review authority in a complete bundle", () => {
    const bundle = validBundle();
    (bundle.snapshot as Record<string, unknown>).branchProtection = {
      branch: "main",
      exists: true,
      enforceAdmins: true,
      allowForcePushes: false,
      allowDeletions: false,
      requiredStatusChecks: null,
      requiredPullRequestReviews: {
        requiredApprovingReviewCount: 1,
        bypassActorsKnown: false,
        bypassActorSummaries: []
      }
    };
    expectCode(() => {
      validateAuditEvidenceBundle(bundle);
    }, "bundle-authority-incomplete");
  });

  it("requires the conservative mismatch projection and incomplete report", async () => {
    const validator = new Ajv2020({ allErrors: true }).compile(await loadSchema());
    const nonConservative = validBundle();
    nonConservative.collection.status = "incomplete";
    nonConservative.collection.missing = ["settings-observation-mismatch"];
    (nonConservative.snapshot as Record<string, unknown>).completeness = {
      complete: false,
      missing: ["settings-observation-mismatch"]
    };
    (nonConservative.snapshot as Record<string, unknown>).branchProtection = {
      branch: "main",
      exists: true,
      enforceAdmins: true,
      allowForcePushes: false,
      allowDeletions: false,
      requiredStatusChecks: null,
      requiredPullRequestReviews: null
    };
    expect(validator(nonConservative)).toBe(false);
    expectCode(() => {
      validateAuditEvidenceBundle(nonConservative);
    }, "bundle-mismatch-projection");

    const wrongReport = validBundle();
    wrongReport.collection.status = "incomplete";
    wrongReport.collection.missing = ["settings-observation-mismatch"];
    (wrongReport.snapshot as Record<string, unknown>).completeness = {
      complete: false,
      missing: ["settings-observation-mismatch"]
    };
    (wrongReport.snapshot as Record<string, unknown>).branchProtection = null;
    (wrongReport.snapshot as Record<string, unknown>).tagProtection = {
      known: false,
      allowsDeletion: true,
      allowsUpdate: true
    };
    expect(validator(wrongReport)).toBe(false);
    expectCode(() => {
      validateAuditEvidenceBundle(wrongReport);
    }, "bundle-report-status");
  });

  it("requires an explicit unknown authority fact for authority-incomplete collections", async () => {
    const validator = new Ajv2020({ allErrors: true }).compile(await loadSchema());
    const invalid = validBundle();
    invalid.collection.status = "incomplete";
    invalid.collection.missing = ["settings-authority-incomplete"];
    invalid.snapshot.completeness = {
      complete: false,
      missing: ["settings-authority-incomplete"]
    };
    (invalid.report as Record<string, unknown>).status = "incomplete";
    invalid.integrity = computeAuditEvidenceIntegrity(invalid);

    expect(validator(invalid)).toBe(false);
    expectCode(() => {
      validateAuditEvidenceBundle(invalid);
    }, "bundle-authority-mismatch");
  });

  it("rejects a complete collection with an incomplete derived report", async () => {
    const validator = new Ajv2020({ allErrors: true, strict: true }).compile(await loadSchema());
    const invalid = validBundle();
    (invalid.snapshot.branchProtection as Record<string, unknown>).exists = false;
    (invalid.report as Record<string, unknown>).status = "incomplete";
    invalid.integrity = computeAuditEvidenceIntegrity(invalid);

    expect(validator(invalid)).toBe(false);
    expectCode(() => {
      validateAuditEvidenceBundle(invalid);
    }, "bundle-report-status");
  });

  it("rejects mutually exclusive incomplete missing codes in schema and runtime", async () => {
    const validator = new Ajv2020({ allErrors: true, strict: true }).compile(await loadSchema());
    const invalid = validBundle();
    invalid.collection.status = "incomplete";
    invalid.collection.missing = ["settings-authority-incomplete", "settings-observation-mismatch"];
    invalid.snapshot.completeness = {
      complete: false,
      missing: ["settings-authority-incomplete", "settings-observation-mismatch"]
    };
    invalid.snapshot.branchProtection = null;
    invalid.snapshot.rulesets = [];
    invalid.snapshot.tagProtection = {
      known: false,
      allowsDeletion: true,
      allowsUpdate: true
    };
    (invalid.report as Record<string, unknown>).status = "incomplete";
    invalid.integrity = computeAuditEvidenceIntegrity(invalid);

    expect(validator(invalid)).toBe(false);
    expectCode(() => {
      validateAuditEvidenceBundle(invalid);
    }, "bundle-missing-conflict");
  });

  it("documents runtime-only semantic array constraints", async () => {
    const schema = await loadSchema();
    const defs = schema.$defs as Record<string, Record<string, unknown> | undefined>;
    const snapshotProperties = (defs.snapshot?.properties ?? {}) as Record<
      string,
      Record<string, unknown> | undefined
    >;
    const branchReviewProperties = (defs.requiredPullRequestReviews?.properties ?? {}) as Record<
      string,
      Record<string, unknown> | undefined
    >;
    const rulesetProperties = (defs.ruleset?.properties ?? {}) as Record<
      string,
      Record<string, unknown> | undefined
    >;

    expect(snapshotProperties.rulesets?.$comment).toContain("strictly increasing");
    expect(snapshotProperties.workflows?.$comment).toContain("sorted unique path");
    expect(branchReviewProperties.bypassActorSummaries?.$comment).toContain("aggregate count");
    expect(rulesetProperties.bypassActorSummaries?.$comment).toContain("aggregate count");
  });

  it("validates report findings and their canonical order", () => {
    const invalidCategory = validBundle();
    (invalidCategory.report as Record<string, unknown>).findings = [
      { code: "x", category: "other", severity: "error", message: "x" }
    ];
    expectCode(() => {
      validateAuditEvidenceBundle(invalidCategory);
    }, "bundle-report-finding");

    const extraField = validBundle();
    (extraField.report as Record<string, unknown>).findings = [
      { code: "x", category: "integrity", severity: "error", message: "x", extra: true }
    ];
    expectCode(() => {
      validateAuditEvidenceBundle(extraField);
    }, "bundle-report-finding");

    const reversed = validBundle();
    (reversed.report as Record<string, unknown>).findings = [
      { code: "z", category: "integrity", severity: "error", message: "z" },
      { code: "a", category: "integrity", severity: "error", message: "a" }
    ];
    expectCode(() => {
      validateAuditEvidenceBundle(reversed);
    }, "bundle-report-order");
  });

  it("enforces runtime collection bounds that the public schema declares", () => {
    const tooManyChecks = validBundle();
    (tooManyChecks.snapshot.policy as Record<string, unknown>).requiredChecks = Array.from(
      { length: 101 },
      (_, index) => ({ name: "check-" + String(index) })
    );
    expectCode(() => {
      validateAuditEvidenceBundle(tooManyChecks);
    }, "bundle-check-limit");

    const zeroRepositoryId = validBundle();
    (zeroRepositoryId.subject as Record<string, unknown>).repositoryId = 0;
    expectCode(() => {
      validateAuditEvidenceBundle(zeroRepositoryId);
    }, "bundle-subject");
  });

  it("hydrates a rich bundle with redacted actors and source-bound workflows", () => {
    const bundle = richBundle();
    expect(() => {
      validateAuditEvidenceBundle(bundle);
    }).not.toThrow();
    const hydrated = hydrateAuditEvidenceBundle(bundle);
    expect(hydrated.snapshot.rulesets).toHaveLength(2);
    expect(hydrated.snapshot.rulesets[0]?.bypassActors).toHaveLength(6);
    expect(hydrated.snapshot.rulesets[0]?.bypassActors[0]?.id).toContain("redacted:");
    expect(hydrated.snapshot.workflows[0]?.source).toBe("on: pull_request\njobs: {}");
    expect(hydrated.report.repository.baseSha).toBe("a".repeat(40));
  });

  it("covers scalar validators and fails closed before integrity replay", () => {
    const expectInvalid = (mutate: (bundle: EvidenceBundle) => void, code: string): void => {
      const bundle = validBundle();
      mutate(bundle);
      expectCode(() => {
        validateAuditEvidenceBundle(bundle);
      }, code);
    };

    expectInvalid((bundle) => (bundle.bundleVersion = 3), "bundle-version");
    expectInvalid((bundle) => {
      (bundle.report as Record<string, unknown>).findings = Array.from({ length: 501 }, () => ({
        code: "too-many",
        category: "integrity",
        severity: "error",
        message: "too-many"
      }));
    }, "bundle-findings-limit");
    expectInvalid((bundle) => {
      (bundle.integrity as Record<string, unknown>).snapshotSha256 = "invalid";
    }, "bundle-integrity");
    expectInvalid(
      (bundle) => ((bundle.subject as Record<string, unknown>).owner = "bad\u0000owner"),
      "bundle-subject"
    );
    expectInvalid(
      (bundle) => ((bundle.subject as Record<string, unknown>).ownerType = "team"),
      "bundle-subject"
    );
    expectInvalid(
      (bundle) => ((bundle.subject as Record<string, unknown>).visibility = "unknown"),
      "bundle-subject"
    );
    expectInvalid(
      (bundle) => ((bundle.subject as Record<string, unknown>).defaultBranch = ""),
      "bundle-subject"
    );
    expectInvalid(
      (bundle) =>
        ((bundle.subject as Record<string, unknown>).observedBaseShaAtEnd = "b".repeat(40)),
      "bundle-revision-mismatch"
    );
    expectInvalid((bundle) => (bundle.collection.apiVersion = "v0"), "bundle-collection");
    expectInvalid((bundle) => (bundle.collection.durationMs = 120_001), "bundle-collection");
    expectInvalid((bundle) => (bundle.collection.status = "unknown"), "bundle-collection");
    expectInvalid(
      (bundle) => ((bundle.collection.bounds as Record<string, unknown>).bundleBytes = 1),
      "bundle-bounds"
    );
    expectInvalid(
      (bundle) => ((bundle.assertions as Record<string, unknown>).policyPath = "../policy.yml"),
      "bundle-assertions"
    );
    expectInvalid(
      (bundle) =>
        ((
          (bundle.snapshot as Record<string, unknown>).branchProtection as Record<string, unknown>
        ).branch = "develop"),
      "bundle-branch-protection"
    );
    expectInvalid(
      (bundle) =>
        ((
          (bundle.snapshot as Record<string, unknown>).branchProtection as Record<string, unknown>
        ).requiredStatusChecks = { strict: true, checks: "no" }),
      "bundle-branch-protection"
    );
    expectInvalid(
      (bundle) =>
        ((
          ((bundle.snapshot as Record<string, unknown>).branchProtection as Record<string, unknown>)
            .requiredPullRequestReviews as Record<string, unknown>
        ).requiredApprovingReviewCount = 101),
      "bundle-branch-protection"
    );
    expectInvalid(
      (bundle) =>
        ((
          ((bundle.snapshot as Record<string, unknown>).branchProtection as Record<string, unknown>)
            .requiredPullRequestReviews as Record<string, unknown>
        ).bypassActorSummaries = [{ actorType: "unknown", count: 1 }]),
      "bundle-bypass"
    );
    expectInvalid(
      (bundle) =>
        ((bundle.snapshot as Record<string, unknown>).rulesets = [
          {
            id: 1,
            name: "bad",
            target: "invalid",
            refPatterns: [],
            enforcement: "active",
            bypassActorsKnown: true,
            bypassActorSummaries: [],
            requiredChecks: []
          }
        ]),
      "bundle-ruleset"
    );
    expectInvalid(
      (bundle) =>
        ((bundle.snapshot as Record<string, unknown>).rulesets = [
          {
            id: 1,
            name: "branch",
            target: "branch",
            refPatterns: [],
            enforcement: "active",
            bypassActorsKnown: true,
            bypassActorSummaries: [],
            allowForcePushes: false,
            allowDeletions: false,
            requiredChecks: []
          }
        ]),
      "bundle-ruleset"
    );
    expectInvalid(
      (bundle) =>
        ((bundle.snapshot as Record<string, unknown>).rulesets = [
          {
            id: 1,
            name: "repository",
            target: "repository",
            refPatterns: [],
            repositoryPatterns: [],
            enforcement: "active",
            bypassActorsKnown: true,
            bypassActorSummaries: [],
            requiredChecks: []
          }
        ]),
      "bundle-ruleset"
    );
    expectInvalid(
      (bundle) => ((bundle.snapshot as Record<string, unknown>).workflows = "no"),
      "bundle-workflows"
    );
    expectInvalid(
      (bundle) => ((bundle.artifacts as Record<string, unknown>).policy = "no"),
      "bundle-artifacts"
    );
    expectCode(() => normalizeAuditEvidenceBundle("not-an-object"), "bundle-shape");
    expectCode(
      () => computeAuditEvidenceIntegrity({ snapshot: {}, report: {} }),
      "bundle-integrity"
    );
  });

  it("covers collection, bypass, ruleset, workflow, and artifact ordering failures", () => {
    const expectInvalid = (mutate: (bundle: EvidenceBundle) => void, code: string): void => {
      const bundle = validBundle();
      mutate(bundle);
      expectCode(() => {
        validateAuditEvidenceBundle(bundle);
      }, code);
    };

    expectInvalid((bundle) => {
      bundle.collection.missing = ["trusted-workflow-root"];
    }, "bundle-collection");
    expectInvalid((bundle) => {
      bundle.collection.status = "incomplete";
    }, "bundle-collection");
    expectInvalid((bundle) => {
      bundle.collection.retryAttempts = -1;
    }, "bundle-retry-count");
    expectInvalid((bundle) => {
      const branch = bundle.snapshot.branchProtection as Record<string, unknown>;
      branch.requiredPullRequestReviews = null;
    }, "bundle-authority-incomplete");
    expectInvalid((bundle) => {
      const reviews = (bundle.snapshot.branchProtection as Record<string, unknown>)
        .requiredPullRequestReviews as Record<string, unknown>;
      reviews.bypassActorSummaries = [{ actorType: "user", count: 0 }];
    }, "bundle-bypass");
    expectInvalid((bundle) => {
      const reviews = (bundle.snapshot.branchProtection as Record<string, unknown>)
        .requiredPullRequestReviews as Record<string, unknown>;
      reviews.bypassActorSummaries = [
        { actorType: "app", count: 100 },
        { actorType: "user", count: 1 }
      ];
    }, "bundle-bypass-count");
    expectInvalid((bundle) => {
      const reviews = (bundle.snapshot.branchProtection as Record<string, unknown>)
        .requiredPullRequestReviews as Record<string, unknown>;
      reviews.bypassActorSummaries = [
        { actorType: "user", count: 1 },
        { actorType: "user", count: 1 }
      ];
    }, "bundle-array-duplicate");

    const ruleset = (): Record<string, unknown> => ({
      id: 1,
      name: "test",
      target: "branch",
      refPatterns: ["refs/heads/main"],
      enforcement: "active",
      bypassActorsKnown: true,
      bypassActorSummaries: [],
      allowForcePushes: false,
      allowDeletions: false,
      requiredChecks: []
    });
    expectInvalid((bundle) => {
      const value = ruleset();
      value.target = "repository";
      value.refPatterns = [];
      value.repositoryPatterns = ["org/*"];
      delete value.allowForcePushes;
      delete value.allowDeletions;
      value.bypassActorSummaries = [{ actorType: "user", bypassMode: "pull_request", count: 1 }];
      (bundle.snapshot as Record<string, unknown>).rulesets = [value];
    }, "bundle-bypass");
    expectInvalid((bundle) => {
      const value = ruleset();
      value.bypassActorSummaries = [{ actorType: "deploy_key", bypassMode: "always", count: 2 }];
      (bundle.snapshot as Record<string, unknown>).rulesets = [value];
    }, "bundle-bypass-singleton");
    expectInvalid((bundle) => {
      const value = ruleset();
      value.bypassActorSummaries = [
        { actorType: "user", bypassMode: "always", count: 100 },
        { actorType: "team", bypassMode: "always", count: 1 }
      ];
      (bundle.snapshot as Record<string, unknown>).rulesets = [value];
    }, "bundle-bypass-count");
    expectInvalid((bundle) => {
      const first = ruleset();
      first.bypassActorSummaries = [
        { actorType: "user", bypassMode: "always", count: 1 },
        { actorType: "user", bypassMode: "always", count: 1 }
      ];
      (bundle.snapshot as Record<string, unknown>).rulesets = [first];
    }, "bundle-array-duplicate");
    expectInvalid((bundle) => {
      const value = ruleset();
      value.allowForcePushes = undefined;
      delete value.allowForcePushes;
      (bundle.snapshot as Record<string, unknown>).rulesets = [value];
    }, "bundle-ruleset");
    expectInvalid((bundle) => {
      const value = ruleset();
      value.target = "push";
      value.refPatterns = ["refs/heads/main"];
      delete value.allowForcePushes;
      delete value.allowDeletions;
      (bundle.snapshot as Record<string, unknown>).rulesets = [value];
    }, "bundle-ruleset");
    expectInvalid((bundle) => {
      const value = ruleset();
      value.target = "repository";
      value.refPatterns = [];
      value.repositoryPatterns = ["org/*"];
      value.enforcement = "evaluate";
      delete value.allowForcePushes;
      delete value.allowDeletions;
      (bundle.snapshot as Record<string, unknown>).rulesets = [value];
    }, "bundle-ruleset");
    expectInvalid((bundle) => {
      const value = ruleset();
      value.id = 0;
      (bundle.snapshot as Record<string, unknown>).rulesets = [value];
    }, "bundle-ruleset");
    expectInvalid((bundle) => {
      const first = ruleset();
      const second = { ...ruleset(), id: 1 };
      (bundle.snapshot as Record<string, unknown>).rulesets = [first, second];
    }, "bundle-duplicate-id");
    expectInvalid((bundle) => {
      (bundle.subject as Record<string, unknown>).ownerType = "user";
      const value = ruleset();
      value.bypassActorSummaries = [
        { actorType: "organization_admin", bypassMode: "always", count: 1 }
      ];
      (bundle.snapshot as Record<string, unknown>).rulesets = [value];
    }, "bundle-owner-type");
    expectInvalid((bundle) => {
      (bundle.snapshot as Record<string, unknown>).workflows = [
        {
          path: ".github/workflows/ci.yml",
          revisionSha: "a".repeat(40),
          artifactSha256: "b".repeat(64),
          protectedFromPullRequest: true,
          trustedRoot: false
        }
      ];
    }, "bundle-workflow");
    expectInvalid((bundle) => {
      (bundle.artifacts as Record<string, unknown>).policy = {
        ...bundle.artifacts.policy,
        path: "wrong.yml"
      };
    }, "bundle-artifact-binding");
  });

  it("covers remaining conservative projection and replay rejection paths", () => {
    const expectInvalid = (mutate: (bundle: EvidenceBundle) => void, code: string): void => {
      const bundle = validBundle();
      mutate(bundle);
      expectCode(() => {
        validateAuditEvidenceBundle(bundle);
      }, code);
    };

    expectInvalid((bundle) => (bundle.snapshot.snapshotVersion = 2), "bundle-version");
    expectInvalid(
      (bundle) => (bundle.snapshot.repository.owner = "different-owner"),
      "bundle-subject-mismatch"
    );
    expectInvalid((bundle) => {
      bundle.snapshot.completeness = {
        complete: false,
        missing: ["settings-authority-incomplete", "settings-observation-mismatch"]
      };
    }, "bundle-missing-conflict");
    expectInvalid((bundle) => {
      bundle.collection.status = "incomplete";
      bundle.collection.missing = ["settings-observation-mismatch"];
      bundle.snapshot.completeness = {
        complete: false,
        missing: ["settings-observation-mismatch"]
      };
      bundle.snapshot.branchProtection = null;
      bundle.snapshot.rulesets = [
        {
          id: 1,
          name: "branch",
          target: "branch",
          refPatterns: ["refs/heads/main"],
          enforcement: "active",
          bypassActorsKnown: true,
          bypassActorSummaries: [],
          allowForcePushes: false,
          allowDeletions: false,
          requiredChecks: []
        }
      ];
    }, "bundle-mismatch-projection");
    expectInvalid((bundle) => {
      (bundle.snapshot.tagProtection as Record<string, unknown>).known = false;
    }, "bundle-authority-incomplete");
    expectInvalid((bundle) => {
      bundle.collection.status = "incomplete";
      bundle.collection.missing = ["settings-observation-mismatch"];
      bundle.snapshot.completeness = {
        complete: false,
        missing: ["settings-observation-mismatch"]
      };
      bundle.snapshot.branchProtection = null;
      bundle.snapshot.tagProtection = {
        known: true,
        allowsDeletion: false,
        allowsUpdate: false
      };
    }, "bundle-mismatch-projection");
    expectInvalid((bundle) => {
      bundle.snapshot.rulesets = [
        {
          id: 1,
          name: "branch",
          target: "branch",
          refPatterns: ["refs/heads/main"],
          enforcement: "active",
          bypassActorsKnown: true,
          bypassActorSummaries: [{ actorType: "unknown", bypassMode: "always", count: 1 }],
          allowForcePushes: false,
          allowDeletions: false,
          requiredChecks: []
        }
      ];
    }, "bundle-bypass");
    expectInvalid((bundle) => {
      bundle.snapshot.rulesets = [
        {
          id: 1,
          name: "branch",
          target: "branch",
          refPatterns: ["refs/heads/main"],
          enforcement: "invalid",
          bypassActorsKnown: true,
          bypassActorSummaries: [],
          allowForcePushes: false,
          allowDeletions: false,
          requiredChecks: []
        }
      ];
    }, "bundle-ruleset");
    expectInvalid((bundle) => {
      bundle.snapshot.rulesets = [
        {
          id: 1,
          name: "repository",
          target: "repository",
          refPatterns: [],
          repositoryPatterns: ["org/*"],
          enforcement: "active",
          bypassActorsKnown: true,
          bypassActorSummaries: [],
          allowForcePushes: false,
          requiredChecks: []
        }
      ];
    }, "bundle-ruleset");
    expectInvalid((bundle) => {
      bundle.snapshot.workflows = [
        {
          path: ".github/workflows/ci.yml",
          revisionSha: "a".repeat(40),
          artifactSha256: "b".repeat(64),
          protectedFromPullRequest: false,
          trustedRoot: false
        },
        {
          path: ".github/workflows/ci.yml",
          revisionSha: "a".repeat(40),
          artifactSha256: "b".repeat(64),
          protectedFromPullRequest: false,
          trustedRoot: false
        }
      ];
    }, "bundle-array-duplicate");
    expectInvalid(
      (bundle) => ((bundle.report as Record<string, unknown>).status = "unknown"),
      "bundle-report"
    );
    expectInvalid((bundle) => {
      (bundle.snapshot.policy as Record<string, unknown>).workflowPaths = [
        ".github/workflows/z.yml",
        ".github/workflows/a.yml"
      ];
    }, "bundle-policy");
  });
});
