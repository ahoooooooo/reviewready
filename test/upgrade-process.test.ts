import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("open-source upgrade process contract", () => {
  it("keeps the orchestration layer connected to its authoritative sources", async () => {
    const [process, index, research, plan, base] = await Promise.all([
      readFile("docs/oss-upgrade-process.md", "utf8"),
      readFile("docs/research/README.md", "utf8"),
      readFile("docs/research/deep-research-process.md", "utf8"),
      readFile("docs/exec-plans/active/post-v1.md", "utf8"),
      readFile("docs/ai-development.md", "utf8")
    ]);

    expect(index).toContain("[Open-source upgrade lifecycle](../oss-upgrade-process.md)");
    expect(research).toContain("[open-source upgrade lifecycle](../oss-upgrade-process.md)");
    expect(plan).toContain("[open-source upgrade lifecycle](../../oss-upgrade-process.md)");

    const requiredSources = [
      "docs/ai-development.md",
      "docs/research/deep-research-process.md",
      "docs/exec-plans/active/post-v1.md",
      "docs/architecture.md",
      "docs/releasing.md",
      "docs/research/open-source-landscape-and-reward-upgrade.md",
      "docs/research/openai-oss-reward-strategy.md"
    ];
    for (const source of requiredSources) {
      expect(process).toContain(source);
    }

    for (const stage of [
      "Anchor the baseline",
      "Frame one decision",
      "Attack in batches",
      "Synthesize and order",
      "Repair at the smallest safe boundary",
      "Prove and independently attack",
      "Promote, loop, and re-anchor"
    ]) {
      expect(base).toContain(stage);
    }
    expect(base).toContain("work kind (behavior, design, evidence, or external authority)");
    expect(base).toMatch(/one\s+issue or pull request outcome/);
    expect(base).toMatch(/a named external\s+authority/);
    expect(base).toMatch(/foundational process is promoted before the plans/);
    expect(base).toMatch(/trust or security change/);
    expect(base).toMatch(/LLM never decides readiness, approves, or\s+merges/);
    expect(base).toMatch(/immutable base revision/);
    expect(base).toMatch(/unknown\s+or incomplete evidence fails closed/);
    expect(process).toMatch(/base process\s+has completed its own attack/);

    expect(research).toMatch(/shortest reproducible path/);
    expect(research).toMatch(/action boundary is explicit/);
    expect(research).toMatch(/prior report lacks replay metadata/);
    expect(research).toMatch(/candidate cannot approve its own\s+prerequisite/);
    expect(research).toMatch(/external-program or adoption question/);
    const lowerResearch = research.toLowerCase();
    const researchStages = [
      "### anchor and frame the decision",
      "### map the source topology",
      "### attack the question in batches",
      "### build a claim map and action boundary",
      "### search for counter-evidence",
      "### resolve through changing abstraction levels",
      "### replay, refresh, and independent review",
      "## promotion and stopping"
    ].map((stage) => lowerResearch.indexOf(stage));
    expect(researchStages.every((position) => position >= 0)).toBe(true);
    expect(researchStages).toEqual([...researchStages].sort((a, b) => a - b));

    expect(process).toMatch(/grant an LLM\s+authority/);
    expect(process).toContain("does not execute pull-request code");
    expect(process).toMatch(/one explicit\s+authorization/);
    expect(process).toContain("self-dogfood");
    expect(process).toContain("npm run check");
    expect(process).toContain("git diff --check");
    const lowerProcess = process.toLowerCase();
    const stagePositions = [
      "## 1. freeze reality",
      "## 2. frame one observable outcome",
      "## 3. research and attack",
      "## 4. shape evidence",
      "## 6. repair in batches",
      "## 7. prove the candidate"
    ].map((stage) => lowerProcess.indexOf(stage));
    expect(stagePositions.every((position) => position >= 0)).toBe(true);
    expect(stagePositions).toEqual([...stagePositions].sort((a, b) => a - b));
  });
});
