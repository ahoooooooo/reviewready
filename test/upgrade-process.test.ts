import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("open-source upgrade process contract", () => {
  it("keeps the orchestration layer connected to its authoritative sources", async () => {
    const [process, index, research, plan, base, deepSkill, reviewerContract, researchMethod] =
      await Promise.all([
        readFile("docs/oss-upgrade-process.md", "utf8"),
        readFile("docs/research/README.md", "utf8"),
        readFile("docs/research/deep-research-process.md", "utf8"),
        readFile("docs/exec-plans/active/post-v1.md", "utf8"),
        readFile("docs/ai-development.md", "utf8"),
        readFile("skills/reviewready-deep-research/SKILL.md", "utf8"),
        readFile("skills/reviewready-base-delivery/references/reviewer-contract.md", "utf8"),
        readFile("skills/reviewready-deep-research/references/research-method.md", "utf8")
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
    expect(deepSkill).toContain("references/research-method.md");
    expect(deepSkill).toContain("Planning-only path");
    expect(deepSkill).toContain("process-self-optimization reviewer gate overrides it");
    expect(deepSkill).toContain("source-to-final handoff");
    expect(reviewerContract).toContain("REVIEWER_CANARY_OK");

    expect(research).toMatch(/shortest reproducible path/);
    expect(research).toMatch(/action boundary is explicit/);
    expect(research).toMatch(/prior report lacks replay metadata/);
    expect(research).toMatch(/candidate\s+cannot approve its own\s+prerequisite/);
    expect(research).toMatch(/external-program or adoption question/);
    expect(research).toContain("base skill and `AGENTS.md` have precedence");
    expect(research).toContain("RESEARCH_PASS_V1");
    expect(research).toContain("npm run research:validate");
    expect(research).toContain("worker-readiness");
    expect(researchMethod).toContain("worker-admission");
    expect(research).not.toContain("Permit one replacement for a timeout");
    expect(research).toContain("Source-pass reports cannot satisfy");
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
  it("does not retain stale pre-merge claims for completed roadmap nodes", async () => {
    const plan = await readFile("docs/exec-plans/active/post-v1.md", "utf8");

    expect(plan).toContain("PR #80");
    expect(plan).not.toContain("that PR remains documentation-only");
    expect(plan).not.toContain("must pass the repository gate before");
  });
  it("keeps external authentication checks visible to every agent run", async () => {
    const [guide, contract, implementation, base, development, lessons, adr, reviewerContract] =
      await Promise.all([
        readFile("AGENTS.md", "utf8"),
        readFile("docs/authentication.md", "utf8"),
        readFile("scripts/auth-status.mjs", "utf8"),
        readFile("skills/reviewready-base-delivery/SKILL.md", "utf8"),
        readFile("docs/ai-development.md", "utf8"),
        readFile("docs/operational-lessons.md", "utf8"),
        readFile("docs/adr/0016-authentication-authority-status.md", "utf8"),
        readFile("skills/reviewready-base-delivery/references/reviewer-contract.md", "utf8")
      ]);

    expect(guide).toContain("## Authentication authority and external preflight");
    expect(guide).toContain("npm run auth:status");
    expect(guide).toContain("npm run agent:record");
    expect(guide).toContain("npm run agent:triage");
    expect(guide).toMatch(/Windows Git\s+Credential Manager/u);
    expect(guide).toContain("connected GitHub provider/browser channel");
    expect(guide).toMatch(/npm\s+Trusted Publishing/u);
    expect(guide).not.toContain("gh auth status");
    expect(guide).not.toContain("gh api user");
    expect(contract).toContain("same-context retries");
    expect(contract).toContain("Local npm authentication is intentionally irrelevant");
    expect(contract).toContain("External lane routing");
    expect(contract).toContain("bounded batch");
    expect(guide).toContain("bounded external batch");
    expect(guide).toContain("connected/elevated");
    expect(base).toContain("Keep ordinary work in the local sandbox");
    expect(base).toContain("return to the sandbox");
    expect(base).toContain("ETIMEDOUT");
    expect(base).toContain("REVIEWREADY_NPM_CACHE");
    expect(base).toContain("references/reviewer-contract.md");
    expect(reviewerContract).toContain("A silent timeout is terminal");
    expect(reviewerContract).toContain("60 seconds by default");
    expect(reviewerContract).toMatch(
      /close it exactly once through the host\s+close-agent adapter/u
    );
    expect(reviewerContract).toContain("codex.cmd --strict-config doctor --json");
    expect(reviewerContract).toContain("connected/elevated host context");
    expect(reviewerContract).toContain("sandbox-only no-credentials");
    expect(reviewerContract).toContain("worker-readiness");
    expect(reviewerContract).toContain("REVIEWER_CANARY_OK");
    expect(reviewerContract).toContain("30-second budget");
    expect(reviewerContract).toContain("one primary raw artifact");
    expect(reviewerContract).toContain("model=gpt-5.6-luna");
    expect(reviewerContract).toContain("reasoning_effort=max");
    expect(reviewerContract).toContain("structured substantive-agent");
    expect(reviewerContract).toContain("integrator owns the broad baseline");
    expect(reviewerContract).toMatch(/deliberately approved\s+120-second read/u);
    expect(reviewerContract).toContain("REVIEWER_REPORT_V1");
    expect(guide).toContain("Before any reviewer spawn");
    expect(guide).toContain("REVIEWER_CANARY_OK");
    expect(guide).toContain("one named surface");
    expect(guide).toMatch(/new\s+chat\s+session\s+is\s+not\s+a\s+fresh\s+host/u);
    expect(development).toContain("first operation in a bounded");
    expect(development).toContain("silent timeout is terminal");
    expect(lessons).toContain("Bounded external lane and nested npm execution");
    expect(lessons).toContain("REVIEWREADY_NPM_CACHE");
    expect(lessons).toContain("Reviewer watchdog");
    expect(lessons).toContain("pre-dispatch tool failure");
    expect(lessons).toContain("host close-agent control");
    expect(lessons).toContain("control-plane blocker");
    expect(lessons).toContain("elevated host context");
    expect(lessons).toContain("green control-plane did not prove reviewer completion");
    expect(lessons).toContain("two-stage admission");
    expect(adr).toContain("bounded external batch");
    expect(adr).toContain("connected/elevated lane");
    expect(implementation).toContain('ghCli: "forbidden"');
    expect(implementation).toContain('npmWhoami: "forbidden"');
  });
});
