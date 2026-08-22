import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const actionReferences = (workflow: string): string[] =>
  [...workflow.matchAll(/^\s*uses:\s+[^@\s]+@([^\s#]+)(?:\s+#.*)?$/gmu)].map(
    (match) => match[1] ?? ""
  );

describe("security automation baseline", () => {
  it("pins every third-party Action to an immutable commit", async () => {
    const workflows = await Promise.all([
      readFile(".github/workflows/codeql.yml", "utf8"),
      readFile(".github/workflows/dependency-review.yml", "utf8"),
      readFile(".github/workflows/scorecard.yml", "utf8")
    ]);

    for (const workflow of workflows) {
      expect(() => {
        parse(workflow);
      }).not.toThrow();
      const references = actionReferences(workflow);
      expect(references.length).toBeGreaterThan(0);
      expect(references.every((reference) => /^[0-9a-f]{40}$/u.test(reference))).toBe(true);
      expect(workflow).toContain("persist-credentials: false");
    }
  });

  it("runs CodeQL for pull requests, merge queues, main, and a schedule", async () => {
    const workflow = await readFile(".github/workflows/codeql.yml", "utf8");

    expect(workflow).toMatch(/^\s{2}pull_request:$/mu);
    expect(workflow).toMatch(/^\s{2}merge_group:$/mu);
    expect(workflow).toMatch(/^\s{2}push:$/mu);
    expect(workflow).toMatch(/^\s{2}schedule:$/mu);
    expect(workflow).toContain("languages: javascript-typescript");
    expect(workflow).toContain("build-mode: none");
    expect(workflow.match(/github\/codeql-action\/(?:init|analyze)@[0-9a-f]{40}/gu)).toHaveLength(
      2
    );
    expect(workflow).toContain("security-events: write");
  });

  it("fails pull requests that introduce high-severity dependency risk", async () => {
    const workflow = await readFile(".github/workflows/dependency-review.yml", "utf8");

    expect(workflow).toMatch(/^\s{2}pull_request:$/mu);
    expect(workflow).toContain(
      "actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294"
    );
    expect(workflow).toContain("fail-on-severity: high");
    expect(workflow).toContain("comment-summary-in-pr: never");
    expect(workflow).not.toMatch(/^\s+[\w-]+:\s+write$/mu);
  });

  it("publishes a default-branch Scorecard result with bounded permissions", async () => {
    const workflow = await readFile(".github/workflows/scorecard.yml", "utf8");

    expect(workflow).toMatch(/^\s{2}push:$/mu);
    expect(workflow).toMatch(/^\s{2}schedule:$/mu);
    expect(workflow).not.toMatch(/^\s{2}pull_request:$/mu);
    expect(workflow).not.toContain("permissions: read-all");
    expect(workflow).toContain("ossf/scorecard-action@2d1146689b8cda280b9bc96326124645441f03bc");
    expect(workflow).toContain("publish_results: true");
    expect(workflow).toContain("security-events: write");
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("retention-days: 5");
    expect(workflow).toContain("github/codeql-action/upload-sarif@");
  });
});
