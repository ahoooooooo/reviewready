import { describe, expect, it } from "vitest";

import {
  encodeAuditEvidenceBase64url,
  decodeAuditEvidenceBase64url,
  compareAuditEvidenceChecks,
  normalizeAuditEvidenceBundle,
  sha256AuditEvidenceBytes,
  verifyAuditEvidenceSourceArtifact
} from "../src/audit-evidence-bundle.js";

function expectCode(action: () => unknown, code: string): void {
  expect(action).toThrow(expect.objectContaining({ code }));
}

function artifact(path: string, contentBase64url: string, byteLength: number, sha256: string) {
  return {
    path,
    revisionSha: "a".repeat(40),
    sha256,
    byteLength,
    contentBase64url
  };
}

describe("audit evidence bundle artifacts and semantic normalization", () => {
  it("decodes only canonical unpadded base64url", () => {
    expect(decodeAuditEvidenceBase64url("eA")).toEqual(new Uint8Array([0x78]));
    expect(decodeAuditEvidenceBase64url("")).toEqual(new Uint8Array());
    expectCode(() => decodeAuditEvidenceBase64url("A"), "artifact-base64");
    expectCode(() => decodeAuditEvidenceBase64url("eA="), "artifact-base64");
    expectCode(() => decodeAuditEvidenceBase64url("eB"), "artifact-base64");
  });

  it("rejects oversized base64 before decoding an unbounded payload", () => {
    expectCode(() => decodeAuditEvidenceBase64url("A".repeat(349_527)), "artifact-base64");
    expectCode(() => encodeAuditEvidenceBase64url(new Uint8Array(262_145)), "artifact-bytes");
    expectCode(
      () => sha256AuditEvidenceBytes("not bytes" as unknown as Uint8Array),
      "artifact-bytes"
    );
  });

  it("rejects malformed source artifact shapes before byte verification", () => {
    const valid = artifact(
      ".github/workflows/ci.yml",
      "",
      0,
      sha256AuditEvidenceBytes(new Uint8Array())
    );

    expectCode(() => verifyAuditEvidenceSourceArtifact(null, "workflow"), "artifact-shape");
    expectCode(
      () => verifyAuditEvidenceSourceArtifact({ ...valid, path: 7 }, "workflow"),
      "artifact-shape"
    );
    expectCode(
      () => verifyAuditEvidenceSourceArtifact({ ...valid, byteLength: "0" }, "workflow"),
      "artifact-shape"
    );
    expectCode(
      () => verifyAuditEvidenceSourceArtifact({ ...valid, revisionSha: "bad" }, "workflow"),
      "artifact-hash"
    );
    expectCode(
      () => verifyAuditEvidenceSourceArtifact({ ...valid, byteLength: -1 }, "workflow"),
      "artifact-length"
    );
  });

  it("verifies exact source bytes, hash, size, UTF-8, and workflow path", () => {
    const valid = artifact(".github/workflows/ci.yml", "cHJpbnQ", 5, "b".repeat(64));
    expectCode(() => verifyAuditEvidenceSourceArtifact(valid, "workflow"), "artifact-hash");

    const source = artifact(
      ".github/workflows/ci.yml",
      "cHJpbnQ",
      5,
      "ce953a0eb08246617b7f849486c4b26a7af37e9d2e8f0e13b3ae1bf0da8a70a2"
    );
    expect(verifyAuditEvidenceSourceArtifact(source, "workflow").bytes).toEqual(
      new TextEncoder().encode("print")
    );
    expectCode(
      () => verifyAuditEvidenceSourceArtifact({ ...source, path: ".reviewready.yml" }, "workflow"),
      "artifact-path"
    );
    expectCode(
      () => verifyAuditEvidenceSourceArtifact({ ...source, byteLength: 4 }, "workflow"),
      "artifact-length"
    );
    expectCode(
      () =>
        verifyAuditEvidenceSourceArtifact(
          {
            ...source,
            byteLength: 1,
            sha256: "e4ff5e7d7a7f08e9800a3e25cb774533cb20040df30b6ba10f956f9acd0eb3f7",
            contentBase64url: "wA"
          },
          "workflow"
        ),
      "artifact-utf8"
    );
  });

  it("preserves a UTF-8 BOM in decoded source artifacts", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x61]);
    const source = artifact(
      ".github/workflows/ci.yml",
      encodeAuditEvidenceBase64url(bytes),
      bytes.byteLength,
      sha256AuditEvidenceBytes(bytes)
    );

    expect(verifyAuditEvidenceSourceArtifact(source, "workflow")).toEqual({
      bytes,
      text: "\uFEFFa"
    });
  });

  it("sorts set-like arrays and findings without mutating the input", () => {
    const input = {
      assertions: {
        policyPath: ".reviewready.yml",
        protectedWorkflowPaths: [".github/workflows/z.yml", ".github/workflows/a.yml"],
        trustedWorkflowPaths: []
      },
      snapshot: {
        policy: {
          requiredChecks: [{ name: "z" }, { name: "a", appId: 2 }, { name: "a" }],
          workflowPaths: [".github/workflows/z.yml", ".github/workflows/a.yml"]
        },
        rulesets: [
          {
            id: 2,
            refPatterns: ["z", "a"],
            repositoryPatterns: ["z", "a"],
            requiredChecks: [],
            bypassActorSummaries: [
              { actorType: "user", bypassMode: "always", count: 1 },
              { actorType: "app", bypassMode: "always", count: 1 }
            ]
          },
          {
            id: 1,
            refPatterns: [],
            repositoryPatterns: [],
            requiredChecks: [],
            bypassActorSummaries: []
          }
        ],
        workflows: [{ path: ".github/workflows/z.yml" }, { path: ".github/workflows/a.yml" }]
      },
      report: {
        findings: [
          { code: "Z", message: "z", severity: "warning", category: "workflow" },
          { code: "A", message: "a", severity: "error", category: "integrity" }
        ]
      }
    } as const;

    const normalized = normalizeAuditEvidenceBundle(input);
    expect(normalized).not.toBe(input);
    expect(input.assertions.protectedWorkflowPaths[0]).toBe(".github/workflows/z.yml");
    expect(normalized.assertions.protectedWorkflowPaths).toEqual([
      ".github/workflows/a.yml",
      ".github/workflows/z.yml"
    ]);
    expect(normalized.snapshot.policy.requiredChecks).toEqual([
      { name: "a" },
      { name: "a", appId: 2 },
      { name: "z" }
    ]);
    expect(normalized.snapshot.rulesets.map((value) => value.id)).toEqual([1, 2]);
    expect(normalized.snapshot.rulesets[1].bypassActorSummaries).toEqual([
      { actorType: "app", bypassMode: "always", count: 1 },
      { actorType: "user", bypassMode: "always", count: 1 }
    ]);
    expect(normalized.report.findings.map((value) => value.code)).toEqual(["A", "Z"]);
  });

  it("rejects mutually exclusive collection missing-code arrays", () => {
    const input = {
      collection: {
        missing: ["settings-observation-mismatch", "settings-authority-incomplete"]
      },
      snapshot: {
        completeness: {
          missing: ["settings-observation-mismatch", "settings-authority-incomplete"]
        }
      }
    };

    expectCode(() => normalizeAuditEvidenceBundle(input), "bundle-missing-conflict");
  });

  it("fails closed on semantic duplicates and bypass count overflow", () => {
    expectCode(
      () =>
        normalizeAuditEvidenceBundle({
          snapshot: {
            policy: {
              workflowPaths: [".github/workflows/a.yml", ".github/workflows/a.yml"]
            }
          }
        }),
      "bundle-array-duplicate"
    );
    expectCode(
      () =>
        normalizeAuditEvidenceBundle({
          snapshot: {
            rulesets: [
              { id: 1, refPatterns: [], repositoryPatterns: [] },
              { id: 1, refPatterns: [], repositoryPatterns: [] }
            ]
          }
        }),
      "bundle-duplicate-id"
    );
    expectCode(
      () =>
        normalizeAuditEvidenceBundle({
          snapshot: {
            rulesets: [
              {
                id: 1,
                bypassActorSummaries: [
                  { actorType: "user", bypassMode: "always", count: 100 },
                  { actorType: "team", bypassMode: "always", count: 1 }
                ]
              }
            ]
          }
        }),
      "bundle-bypass-count"
    );
  });

  it("normalizes every set-like projection without mutating nested input", () => {
    const checks = [
      { name: "z" },
      { name: "same", appSlug: "z-provider" },
      { name: "same", appId: 2 },
      { name: "same", appId: 1 },
      { name: "same", appSlug: "a-provider" },
      { name: "same" },
      { name: "a" }
    ];
    const input = {
      collection: { missing: ["workflow-root-not-observed", "trusted-workflow-root"] },
      assertions: {
        protectedWorkflowPaths: [".github/workflows/z.yml", ".github/workflows/a.yml"],
        trustedWorkflowPaths: [".github/workflows/z.yml", ".github/workflows/a.yml"]
      },
      snapshot: {
        policy: {
          requiredChecks: checks,
          workflowPaths: [".github/workflows/z.yml", ".github/workflows/a.yml"]
        },
        branchProtection: {
          requiredStatusChecks: { checks: [...checks].reverse() },
          requiredPullRequestReviews: {
            bypassActorSummaries: [
              { actorType: "user", count: 1 },
              { actorType: "app", count: 2 },
              { actorType: "team", count: 1 }
            ]
          }
        },
        rulesets: [
          {
            id: 2,
            refPatterns: ["z", "a"],
            repositoryPatterns: ["z", "a"],
            requiredChecks: [...checks].reverse(),
            bypassActorSummaries: [
              { actorType: "user", bypassMode: "always", count: 1 },
              { actorType: "app", bypassMode: "always", count: 1 },
              { actorType: "team", bypassMode: "exempt", count: 1 }
            ]
          },
          {
            id: 1,
            refPatterns: [],
            repositoryPatterns: [],
            requiredChecks: [],
            bypassActorSummaries: []
          }
        ],
        completeness: { missing: ["workflow-root-not-observed", "trusted-workflow-root"] },
        workflows: [{ path: ".github/workflows/z.yml" }, { path: ".github/workflows/a.yml" }]
      },
      artifacts: {
        workflows: [{ path: ".github/workflows/z.yml" }, { path: ".github/workflows/a.yml" }]
      },
      report: {
        findings: [
          { code: "z", message: "z", severity: "warning", category: "workflow", line: 2 },
          { code: "a", message: "a", severity: "error", category: "integrity", path: "a" }
        ]
      }
    } as const;

    const normalized = normalizeAuditEvidenceBundle(input);
    expect(input.snapshot.policy.requiredChecks[0]).toEqual({ name: "z" });
    expect(normalized.snapshot.policy.requiredChecks.at(-1)).toEqual({ name: "z" });
    expect(normalized.snapshot.rulesets.map((value) => value.id)).toEqual([1, 2]);
    expect(normalized.snapshot.workflows.map((value) => value.path)).toEqual([
      ".github/workflows/a.yml",
      ".github/workflows/z.yml"
    ]);
    expect(normalized.artifacts.workflows.map((value) => value.path)).toEqual([
      ".github/workflows/a.yml",
      ".github/workflows/z.yml"
    ]);
    expect(normalized.report.findings.map((value) => value.code)).toEqual(["a", "z"]);
  });

  it("rejects invalid comparison and normalization shapes", () => {
    expectCode(() => compareAuditEvidenceChecks(null, { name: "a" }), "bundle-check");
    expectCode(() => compareAuditEvidenceChecks({ name: "a" }, { name: 1 }), "bundle-check");
    expectCode(
      () => compareAuditEvidenceChecks({ name: "a", appId: "1" }, { name: "a", appId: 2 }),
      "bundle-check"
    );
    expectCode(
      () => compareAuditEvidenceChecks({ name: "a", appSlug: 1 }, { name: "a", appSlug: "b" }),
      "bundle-check"
    );
    expectCode(
      () => normalizeAuditEvidenceBundle({ snapshot: { policy: { requiredChecks: "no" } } }),
      "bundle-check"
    );
    expectCode(
      () =>
        normalizeAuditEvidenceBundle({
          snapshot: { rulesets: [{ id: 1, refPatterns: ["a", "a"] }] }
        }),
      "bundle-array-duplicate"
    );
    expectCode(
      () => normalizeAuditEvidenceBundle({ snapshot: { workflows: "no" } }),
      "bundle-workflows"
    );
    expectCode(
      () => normalizeAuditEvidenceBundle({ artifacts: { workflows: "no" } }),
      "bundle-artifacts"
    );
    expectCode(
      () => normalizeAuditEvidenceBundle({ report: { findings: "no" } }),
      "bundle-findings"
    );
    expectCode(
      () =>
        normalizeAuditEvidenceBundle({
          snapshot: {
            branchProtection: {
              requiredPullRequestReviews: {
                bypassActorSummaries: [{ actorType: "user", count: 101 }]
              }
            }
          }
        }),
      "bundle-bypass"
    );
  });
});
