import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

async function readFixture(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

describe("post-v1 design contracts", () => {
  it("loads the bounded AI workflow security corpus contract", async () => {
    const fixture = await readFixture("fixtures/ai-workflow/security-corpus-v1.json");
    const cases = fixture.cases;

    expect(fixture.contract).toBe("reviewready.ai-workflow-security.v1");
    expect(fixture.version).toBe(1);
    expect(fixture.bounds).toEqual({
      maxWorkflowBytes: 262144,
      maxCases: 32,
      maxFindings: 64,
      maxTraversalDepth: 16
    });
    expect(Array.isArray(cases)).toBe(true);
    expect(new Set((cases as Array<{ id: string }>).map((item) => item.id)).size).toBe(
      (cases as unknown[]).length
    );
    expect(
      (cases as Array<{ expected: { status: string } }>).map((item) => item.expected.status)
    ).toEqual(expect.arrayContaining(["no_finding", "finding", "unknown"]));
  });

  it("loads explicit v2 unmatched-change semantics without changing v1", async () => {
    const fixture = await readFixture("fixtures/policy/v2-unmatched-change-strategy.json");
    const strategies = fixture.strategies as Array<{ name: string; exitCode: number }>;

    expect(fixture.contract).toBe("reviewready.policy.unmatched-change.v2");
    expect(fixture.version).toBe(2);
    expect(strategies.map((strategy) => strategy.name)).toEqual(["ready", "not_ready", "error"]);
    expect(strategies.map((strategy) => strategy.exitCode)).toEqual([0, 1, 2]);
    expect(fixture.v1Compatibility).toEqual({
      omittedStrategy: "ready",
      publicResultShape: "unchanged",
      migration: "explicit-opt-in"
    });
  });

  it("loads authenticated attestation states with bounded, non-secret evidence", async () => {
    const fixture = await readFixture("fixtures/policy/v2-attestation-provenance.json");
    const serialized = JSON.stringify(fixture).toLowerCase();
    const cases = fixture.cases as Array<{ expected: string }>;

    expect(fixture.contract).toBe("reviewready.attestation.provenance.v2");
    expect(fixture.version).toBe(2);
    expect(fixture.binding).toEqual([
      "actor",
      "event",
      "repository",
      "baseSha",
      "headSha",
      "policyDigest",
      "freshness"
    ]);
    expect(cases.map((item) => item.expected)).toEqual(
      expect.arrayContaining(["accepted", "rejected", "unknown"])
    );
    expect(serialized).not.toMatch(/token|secret|privatekey|reviewbody|rawbody/u);
  });
});
