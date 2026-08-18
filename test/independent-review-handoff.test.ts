import { describe, expect, it } from "vitest";

import { validateHandoff } from "../scripts/independent-review-handoff.mjs";

function validHandoff() {
  return {
    schemaVersion: 2,
    route: "base",
    reviewEpoch: "epoch-61126ee",
    revision: "a".repeat(40),
    worktree: "clean",
    scope: ["process-delivery"],
    artifacts: ["base-skill", "process-docs"],
    evidence: ["git diff --check", "skill validator"],
    reviewers: [
      {
        id: "reviewer-1",
        role: "final-review",
        dispatchContext: "fork_context=false",
        ownedSurfaces: ["process-delivery"],
        excludedSurfaces: ["product-runtime"],
        artifactIds: ["base-skill", "process-docs"],
        status: "complete"
      }
    ],
    surfaceCoverage: [{ surface: "process-delivery", ownerId: "reviewer-1" }],
    findings: [
      {
        id: "finding-1",
        surface: "process-delivery",
        reviewerId: "reviewer-1",
        severity: "P1",
        summary: "No material finding"
      }
    ],
    strongestFalsifier: "A fresh reviewer finds a missed gate.",
    missedAttackSurface: "Provider authority",
    authorityEvidenceGap: "None identified.",
    recommendation: "Promote the reviewed process candidate.",
    outcome: "promote"
  };
}

describe("independent review handoff", () => {
  it("accepts a complete multi-reviewer handoff", () => {
    expect(validateHandoff(validHandoff())).toMatchObject({
      schemaVersion: 2,
      reviewEpoch: "epoch-61126ee",
      reviewers: [{ dispatchContext: "fork_context=false", status: "complete" }],
      outcome: "promote"
    });
  });

  it("rejects missing required evidence fields", () => {
    const handoff = validHandoff();
    delete (handoff as Record<string, unknown>).strongestFalsifier;

    expect(() => validateHandoff(handoff)).toThrow("strongestFalsifier");
  });

  it("rejects a context other than a fresh fork", () => {
    const handoff = validHandoff();
    const reviewer = handoff.reviewers[0];
    if (reviewer === undefined) throw new Error("test fixture reviewer is missing");
    reviewer.dispatchContext = "fork_context=true";

    expect(() => validateHandoff(handoff)).toThrow("fork_context=false");
  });

  it("rejects findings that are not severity ordered", () => {
    const handoff = validHandoff();
    handoff.findings = [
      {
        id: "finding-1",
        surface: "process-delivery",
        reviewerId: "reviewer-1",
        severity: "P2",
        summary: "Minor"
      },
      {
        id: "finding-2",
        surface: "process-delivery",
        reviewerId: "reviewer-1",
        severity: "P1",
        summary: "Blocking"
      }
    ];

    expect(() => validateHandoff(handoff)).toThrow("severity ordered");
  });

  it("rejects schema drift and unexpected fields", () => {
    const missingVersion = validHandoff();
    delete (missingVersion as Record<string, unknown>).schemaVersion;
    expect(() => validateHandoff(missingVersion)).toThrow("schemaVersion");

    const wrongVersion = { ...validHandoff(), schemaVersion: 999 };
    expect(() => validateHandoff(wrongVersion)).toThrow("schemaVersion");

    const extraField = { ...validHandoff(), unexpected: true };
    expect(() => validateHandoff(extraField)).toThrow("unexpected");

    const nestedExtra = validHandoff() as Record<string, unknown>;
    nestedExtra.reviewers = [
      {
        ...validHandoff().reviewers[0],
        unexpected: true
      }
    ];
    expect(() => validateHandoff(nestedExtra)).toThrow("unexpected reviewer field");
  });

  it("rejects overlapping or incomplete surface ownership", () => {
    const disjoint = validHandoff();
    disjoint.artifacts.push("security-docs");
    disjoint.reviewers.push({
      id: "reviewer-2",
      role: "security",
      dispatchContext: "fork_context=false",
      ownedSurfaces: ["security"],
      excludedSurfaces: ["process-delivery"],
      artifactIds: ["security-docs"],
      status: "complete"
    });
    disjoint.surfaceCoverage.push({ surface: "security", ownerId: "reviewer-2" });
    expect(validateHandoff(disjoint).reviewers).toHaveLength(2);
    const swappedCoverage = disjoint.surfaceCoverage[0];
    if (swappedCoverage === undefined) throw new Error("test fixture coverage is missing");
    swappedCoverage.ownerId = "reviewer-2";
    expect(() => validateHandoff(disjoint)).toThrow("does not own");

    const overlapping = validHandoff();
    overlapping.reviewers.push({
      id: "reviewer-2",
      role: "security",
      dispatchContext: "fork_context=false",
      ownedSurfaces: ["process-delivery"],
      excludedSurfaces: [],
      artifactIds: ["security-docs"],
      status: "complete"
    });
    expect(() => validateHandoff(overlapping)).toThrow("owned surface");

    const incomplete = validHandoff();
    incomplete.surfaceCoverage = [];
    expect(() => validateHandoff(incomplete)).toThrow("surface coverage");
  });

  it("enforces the base route reviewer cap", () => {
    const tooMany = validHandoff();
    for (let index = 2; index <= 4; index += 1) {
      const surface = "surface-" + String(index);
      const reviewerId = "reviewer-" + String(index);
      tooMany.artifacts.push("artifact-" + String(index));
      tooMany.reviewers.push({
        id: reviewerId,
        role: "attack",
        dispatchContext: "fork_context=false",
        ownedSurfaces: [surface],
        excludedSurfaces: [],
        artifactIds: ["artifact-" + String(index)],
        status: "complete"
      });
      tooMany.surfaceCoverage.push({ surface, ownerId: reviewerId });
    }

    expect(() => validateHandoff(tooMany)).toThrow("base route");
  });

  it("rejects unlisted base reviewer artifacts", () => {
    const unlisted = validHandoff() as Record<string, unknown>;
    const reviewers = unlisted.reviewers as Array<Record<string, unknown>>;
    const reviewer = reviewers[0];
    if (reviewer === undefined) throw new Error("test fixture reviewer is missing");
    reviewer.artifactIds = ["unlisted-artifact"];

    expect(() => validateHandoff(unlisted)).toThrow("not listed");
  });

  it("rejects top-level artifacts without a reviewer owner", () => {
    const orphan = validHandoff();
    orphan.artifacts.push("orphan-artifact");

    expect(() => validateHandoff(orphan)).toThrow("not assigned");
  });

  it("rejects duplicate artifact ids outside the final review", () => {
    const missingFinal = validHandoff();
    const missingFinalReviewer = missingFinal.reviewers[0];
    if (missingFinalReviewer === undefined) {
      throw new Error("test fixture reviewer is missing");
    }
    missingFinalReviewer.role = "attack";
    expect(() => validateHandoff(missingFinal)).toThrow("only one final reviewer");

    const duplicateTopLevel = validHandoff();
    duplicateTopLevel.artifacts.push("base-skill");
    expect(() => validateHandoff(duplicateTopLevel)).toThrow("artifact ids");

    const duplicate = validHandoff();
    const firstReviewer = duplicate.reviewers[0];
    if (firstReviewer === undefined) throw new Error("test fixture reviewer is missing");
    firstReviewer.role = "attack";
    duplicate.reviewers.push({
      id: "reviewer-2",
      role: "security",
      dispatchContext: "fork_context=false",
      ownedSurfaces: ["security"],
      excludedSurfaces: ["process-delivery"],
      artifactIds: ["base-skill"],
      status: "complete"
    });
    duplicate.surfaceCoverage.push({ surface: "security", ownerId: "reviewer-2" });
    duplicate.reviewers.push({
      id: "final-reviewer",
      role: "final-review",
      dispatchContext: "fork_context=false",
      ownedSurfaces: ["final-review"],
      excludedSurfaces: [],
      artifactIds: ["base-skill", "process-docs"],
      status: "complete"
    });
    duplicate.surfaceCoverage.push({ surface: "final-review", ownerId: "final-reviewer" });

    expect(() => validateHandoff(duplicate)).toThrow("artifact id overlap");

    const duplicateFinal = validHandoff();
    duplicateFinal.reviewers.push({
      id: "reviewer-2",
      role: "final-review",
      dispatchContext: "fork_context=false",
      ownedSurfaces: ["final-review"],
      excludedSurfaces: [],
      artifactIds: ["base-skill", "process-docs"],
      status: "complete"
    });
    duplicateFinal.surfaceCoverage.push({ surface: "final-review", ownerId: "reviewer-2" });
    expect(() => validateHandoff(duplicateFinal)).toThrow("one final reviewer");
  });

  it("requires deferred outcome when a reviewer is incomplete", () => {
    const deferred = validHandoff();
    const reviewer = deferred.reviewers[0];
    if (reviewer === undefined) throw new Error("test fixture reviewer is missing");
    reviewer.status = "timeout";
    deferred.outcome = "defer-external";
    expect(validateHandoff(deferred).outcome).toBe("defer-external");

    const unsafe = { ...deferred, outcome: "promote" };
    expect(() => validateHandoff(unsafe)).toThrow("incomplete reviewer");
  });

  it("requires raw artifacts and lineage for deep research", () => {
    const seed = validHandoff();
    const originalReviewer = seed.reviewers[0];
    if (originalReviewer === undefined) throw new Error("test fixture reviewer is missing");
    const deep = validHandoff() as Record<string, unknown>;
    deep.route = "deep-research";
    deep.artifacts = ["raw:source-1"];
    deep.reviewers = [
      {
        ...originalReviewer,
        id: "researcher-1",
        role: "research",
        ownedSurfaces: ["research-authority"],
        excludedSurfaces: [],
        artifactIds: ["raw:source-1"],
        artifactBindings: [
          {
            artifactId: "raw:source-1",
            sourceLineage: ["source:source-1@revision"],
            claimIds: ["claim-1"]
          }
        ]
      }
    ];
    deep.surfaceCoverage = [{ surface: "research-authority", ownerId: "researcher-1" }];
    const deepReviewers = deep.reviewers as Array<Record<string, unknown>>;
    const deepSurfaceCoverage = deep.surfaceCoverage as Array<{
      surface: string;
      ownerId: string;
    }>;
    deepReviewers.push({
      id: "final-reviewer",
      role: "final-review",
      dispatchContext: "fork_context=false",
      ownedSurfaces: ["final-review"],
      excludedSurfaces: [],
      artifactIds: ["raw:source-1"],
      artifactBindings: [
        {
          artifactId: "raw:source-1",
          sourceLineage: ["source:source-1@revision"],
          claimIds: ["claim-1"]
        }
      ],
      status: "complete"
    });
    deepSurfaceCoverage.push({ surface: "final-review", ownerId: "final-reviewer" });
    const finalReviewer = deepReviewers.find((reviewer) => reviewer.role === "final-review");
    if (finalReviewer === undefined) throw new Error("test fixture final reviewer is missing");
    deep.findings = [
      {
        id: "finding-1",
        surface: "research-authority",
        reviewerId: "researcher-1",
        severity: "P1",
        summary: "No material finding"
      }
    ];

    expect(validateHandoff(deep).route).toBe("deep-research");

    const derivedTopLevel = { ...deep, artifacts: ["derived:claim-map"] };
    expect(() => validateHandoff(derivedTopLevel)).toThrow("raw");

    const unlistedArtifact = {
      ...deep,
      reviewers: [
        {
          ...deepReviewers[0],
          artifactIds: ["raw:unlisted-source"],
          artifactBindings: [
            {
              artifactId: "raw:unlisted-source",
              sourceLineage: ["source:unlisted@revision"],
              claimIds: ["claim-unlisted"]
            }
          ]
        }
      ]
    };
    (unlistedArtifact.reviewers as Array<Record<string, unknown>>).push(finalReviewer);
    expect(() => validateHandoff(unlistedArtifact)).toThrow("not listed");

    const derived = {
      ...deep,
      reviewers: [
        {
          ...deepReviewers[0],
          artifactIds: ["derived-claim-map"]
        }
      ]
    };
    (derived.reviewers as Array<Record<string, unknown>>).push(finalReviewer);
    expect(() => validateHandoff(derived)).toThrow("raw");

    const finalBindings = finalReviewer.artifactBindings as Array<Record<string, unknown>>;
    const firstFinalBinding = finalBindings[0];
    if (firstFinalBinding === undefined) throw new Error("test fixture binding is missing");
    finalBindings[0] = { ...firstFinalBinding, claimIds: ["claim-conflict"] };
    expect(() => validateHandoff(deep)).toThrow("conflicting artifact binding");
  });

  it("enforces the deep-research reviewer cap", () => {
    const deep = validHandoff() as Record<string, unknown>;
    deep.route = "deep-research";
    deep.scope = ["deep-research"];
    const artifacts: string[] = [];
    const reviewers: Array<Record<string, unknown>> = [];
    const surfaceCoverage: Array<{ surface: string; ownerId: string }> = [];
    deep.artifacts = artifacts;
    deep.reviewers = reviewers;
    deep.surfaceCoverage = surfaceCoverage;
    deep.findings = [];

    for (let index = 1; index <= 6; index += 1) {
      const surface = "research-surface-" + String(index);
      const reviewerId = "researcher-" + String(index);
      const artifactId = "raw:source-" + String(index);
      artifacts.push(artifactId);
      reviewers.push({
        id: reviewerId,
        role: "research",
        dispatchContext: "fork_context=false",
        ownedSurfaces: [surface],
        excludedSurfaces: [],
        artifactIds: [artifactId],
        artifactBindings: [
          {
            artifactId,
            sourceLineage: ["source:" + String(index) + "@revision"],
            claimIds: ["claim-" + String(index)]
          }
        ],
        status: "complete"
      });
      surfaceCoverage.push({ surface, ownerId: reviewerId });
    }

    expect(() => validateHandoff(deep)).toThrow("deep-research route");
  });
});
