import { describe, expect, it } from "vitest";

import { validateHandoff } from "../scripts/independent-review-handoff.mjs";

function validHandoff() {
  return {
    schemaVersion: 1,
    revision: "a".repeat(40),
    worktree: "clean",
    reviewerId: "reviewer-1",
    reviewerRole: "reviewer",
    dispatchContext: "fork_context=false",
    scope: ["skills/reviewready-base-delivery/SKILL.md"],
    artifacts: ["base skill and process docs"],
    evidence: ["git diff --check", "skill validator"],
    findings: [{ severity: "P1", summary: "No material finding" }],
    strongestFalsifier: "A fresh reviewer finds a missed gate.",
    missedAttackSurface: "Provider authority",
    authorityEvidenceGap: "None identified.",
    recommendation: "Promote the reviewed process candidate.",
    outcome: "promote"
  };
}

describe("independent review handoff", () => {
  it("accepts a complete fresh-review handoff", () => {
    expect(validateHandoff(validHandoff())).toMatchObject({
      dispatchContext: "fork_context=false",
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
    handoff.dispatchContext = "fork_context=true";

    expect(() => validateHandoff(handoff)).toThrow("fork_context=false");
  });

  it("rejects findings that are not severity ordered", () => {
    const handoff = validHandoff();
    handoff.findings = [
      { severity: "P2", summary: "Minor" },
      { severity: "P1", summary: "Blocking" }
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
    nestedExtra.findings = [{ severity: "P1", summary: "Finding", unexpected: true }];
    expect(() => validateHandoff(nestedExtra)).toThrow("unexpected finding field");
  });
});
