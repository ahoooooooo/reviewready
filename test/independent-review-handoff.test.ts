import { describe, expect, it } from "vitest";

import { validateHandoff } from "../scripts/independent-review-handoff.mjs";

const reviewerReport = [
  "REVIEWER_REPORT_V1",
  "surface=process-delivery",
  "falsifier=A fresh reviewer finds a missed process gate.",
  "evidence=base-skill,process-docs",
  "missed_surface=product-runtime",
  "authority_gap=none",
  "recommendation=promote"
].join("\n");

const finalReviewReport = reviewerReport
  .replace("surface=process-delivery", "surface=final-review")
  .replace("evidence=base-skill,process-docs", "evidence=base-skill,process-docs");

const researchReport = [
  "RESEARCH_PASS_V1",
  "surface=research-authority",
  "sources=raw:source-1",
  "claim_ids=claim-1",
  "evidence=raw:source-1:lines=1-2",
  "counter_case=none",
  "freshness=2026-08-19; refresh on release change",
  "outcome=continue"
].join("\n");

type ReviewerFixture = {
  id: string;
  role: string;
  dispatchContext: string;
  ownedSurfaces: string[];
  excludedSurfaces: string[];
  artifactIds: string[];
  packetMode: string;
  waitBudgetSeconds: number;
  report?: string;
  closeEvidence: string;
  artifactBindings?: Array<Record<string, unknown>>;
  status: string;
};

type HandoffFixture = {
  schemaVersion: number;
  route: string;
  reviewEpoch: string;
  revision: string;
  worktree: string;
  scope: string[];
  artifacts: string[];
  evidence: string[];
  reviewerReadiness: {
    canaryId: string;
    dispatchContext: string;
    waitBudgetSeconds: number;
    sentinel: string;
    observedOutput: string;
    status: string;
    closed: boolean;
    closeEvidence: string;
  };
  reviewers: ReviewerFixture[];
  surfaceCoverage: Array<{ surface: string; ownerId: string }>;
  findings: Array<Record<string, string>>;
  strongestFalsifier: string;
  missedAttackSurface: string;
  authorityEvidenceGap: string;
  recommendation: string;
  outcome: string;
};

function validHandoff(): HandoffFixture {
  return {
    schemaVersion: 2,
    route: "base",
    reviewEpoch: "epoch-61126ee",
    revision: "a".repeat(40),
    worktree: "clean",
    scope: ["process-delivery"],
    artifacts: ["base-skill", "process-docs"],
    evidence: ["git diff --check", "skill validator"],
    reviewerReadiness: {
      canaryId: "canary-1",
      dispatchContext: "fork_context=false",
      waitBudgetSeconds: 30,
      sentinel: "REVIEWER_CANARY_OK",
      observedOutput: "REVIEWER_CANARY_OK",
      status: "passed",
      closed: true,
      closeEvidence: "host-close-agent:agent=canary-1:previous_status=completed"
    },
    reviewers: [
      {
        id: "reviewer-1",
        role: "final-review",
        dispatchContext: "fork_context=false",
        ownedSurfaces: ["process-delivery"],
        excludedSurfaces: ["product-runtime"],
        artifactIds: ["base-skill", "process-docs"],
        packetMode: "paired-artifacts",
        waitBudgetSeconds: 120,
        report: reviewerReport,
        closeEvidence: "host-close-agent:agent=reviewer-1:previous_status=completed",
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
      reviewerReadiness: { status: "passed", closed: true },
      reviewers: [{ dispatchContext: "fork_context=false", status: "complete" }],
      outcome: "promote"
    });
  });

  it("requires a real worker canary before substantive review promotion", () => {
    const missing = validHandoff() as Record<string, unknown>;
    delete missing.reviewerReadiness;
    expect(() => validateHandoff(missing)).toThrow("reviewerReadiness");

    const wrongSentinel = validHandoff();
    wrongSentinel.reviewerReadiness.observedOutput = "READY";
    expect(() => validateHandoff(wrongSentinel)).toThrow("canary sentinel");

    const missingCloseEvidence = validHandoff();
    delete (missingCloseEvidence.reviewerReadiness as Record<string, unknown>).closeEvidence;
    expect(() => validateHandoff(missingCloseEvidence)).toThrow("closeEvidence");

    const wrongCloseEvidence = validHandoff();
    wrongCloseEvidence.reviewerReadiness.closeEvidence =
      "host-close-agent:agent=other-canary:previous_status=completed";
    expect(() => validateHandoff(wrongCloseEvidence)).toThrow("canary id");

    const deferredCanary = validHandoff();
    deferredCanary.reviewerReadiness.status = "deferred";
    deferredCanary.reviewerReadiness.closed = false;
    deferredCanary.outcome = "promote";
    expect(() => validateHandoff(deferredCanary)).toThrow("incomplete reviewer");
  });

  it("requires the final report and substantive agent close binding", () => {
    const missingReport = validHandoff();
    const missingReportReviewer = missingReport.reviewers[0];
    if (missingReportReviewer === undefined) throw new Error("test fixture reviewer is missing");
    delete missingReportReviewer.report;
    expect(() => validateHandoff(missingReport)).toThrow("report");

    const forgedClose = validHandoff();
    const forgedCloseReviewer = forgedClose.reviewers[0];
    if (forgedCloseReviewer === undefined) throw new Error("test fixture reviewer is missing");
    forgedCloseReviewer.closeEvidence =
      "host-close-agent:agent=other-reviewer:previous_status=completed";
    expect(() => validateHandoff(forgedClose)).toThrow("reviewer id");

    const malformedReport = validHandoff();
    const malformedReportReviewer = malformedReport.reviewers[0];
    if (malformedReportReviewer === undefined) throw new Error("test fixture reviewer is missing");
    malformedReportReviewer.report = reviewerReport.replace("REVIEWER_REPORT_V1", "REPORT");
    expect(() => validateHandoff(malformedReport)).toThrow("reviewer report");
  });

  it("rejects packet counts and budgets outside the declared mode", () => {
    const single = validHandoff();
    const singleReviewer = single.reviewers[0];
    if (singleReviewer === undefined) throw new Error("test fixture reviewer is missing");
    singleReviewer.packetMode = "single-artifact";
    expect(() => validateHandoff(single)).toThrow("single-artifact");

    const paired = validHandoff();
    const pairedReviewer = paired.reviewers[0];
    if (pairedReviewer === undefined) throw new Error("test fixture reviewer is missing");
    pairedReviewer.waitBudgetSeconds = 60;
    expect(() => validateHandoff(paired)).toThrow("paired-artifacts");

    const singleLong = validHandoff();
    const singleLongReviewer = singleLong.reviewers[0];
    if (singleLongReviewer === undefined) throw new Error("test fixture reviewer is missing");
    singleLongReviewer.packetMode = "single-artifact";
    singleLongReviewer.artifactIds = ["base-skill"];
    singleLongReviewer.waitBudgetSeconds = 120;
    expect(() => validateHandoff(singleLong)).toThrow("60-second budget");
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
      packetMode: "single-artifact",
      waitBudgetSeconds: 60,
      closeEvidence: "host-close-agent:agent=reviewer-2:previous_status=completed",
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
      packetMode: "single-artifact",
      waitBudgetSeconds: 60,
      closeEvidence: "host-close-agent:agent=reviewer-2:previous_status=completed",
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
        packetMode: "single-artifact",
        waitBudgetSeconds: 60,
        closeEvidence: "host-close-agent:agent=" + reviewerId + ":previous_status=completed",
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
    reviewer.packetMode = "single-artifact";
    reviewer.waitBudgetSeconds = 60;
    reviewer.report = reviewerReport.replace("base-skill,process-docs", "unlisted-artifact");

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
      packetMode: "single-artifact",
      waitBudgetSeconds: 60,
      closeEvidence: "host-close-agent:agent=reviewer-2:previous_status=completed",
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
      packetMode: "paired-artifacts",
      waitBudgetSeconds: 120,
      report: finalReviewReport,
      closeEvidence: "host-close-agent:agent=final-reviewer:previous_status=completed",
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
      packetMode: "paired-artifacts",
      waitBudgetSeconds: 120,
      report: finalReviewReport,
      closeEvidence: "host-close-agent:agent=reviewer-2:previous_status=completed",
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
        packetMode: "single-artifact",
        waitBudgetSeconds: 60,
        report: researchReport,
        closeEvidence: "host-close-agent:agent=researcher-1:previous_status=completed",
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
      packetMode: "single-artifact",
      waitBudgetSeconds: 60,
      report: finalReviewReport.replace("base-skill,process-docs", "raw:source-1"),
      closeEvidence: "host-close-agent:agent=final-reviewer:previous_status=completed",
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
          report: researchReport.replaceAll("raw:source-1", "raw:unlisted-source"),
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
        packetMode: "single-artifact",
        waitBudgetSeconds: 60,
        report: researchReport
          .replace("research-authority", surface)
          .replaceAll("raw:source-1", artifactId)
          .replace("claim-1", "claim-" + String(index)),
        closeEvidence: "host-close-agent:agent=" + reviewerId + ":previous_status=completed",
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
