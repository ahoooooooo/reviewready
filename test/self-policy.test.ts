import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { evaluate } from "../src/engine.js";
import { parsePolicy } from "../src/policy.js";

const policy = parsePolicy(await readFile(".reviewready.yml", "utf8"));

describe("ReviewReady self-policy coverage", () => {
  it.each([
    "src/index.ts",
    "test/engine.test.ts",
    "fixtures/basic/ready.json",
    ".reviewready.yml",
    "reviewready.schema.json",
    ".github/workflows/reviewready-trusted.yml",
    "action.yml",
    "tsconfig.json",
    "package.json",
    "scripts/release-preflight.mjs",
    "docs/architecture.md",
    "SECURITY.md",
    "AGENTS.md",
    "CONTRIBUTING.md"
  ])("does not leave %s unmatched", (path) => {
    const result = evaluate(policy, {
      version: 1,
      changedFiles: [path],
      body: "",
      labels: [],
      linkedIssues: [],
      checks: [],
      reviews: []
    });

    expect(result.triggeredRules.length, path).toBeGreaterThan(0);
  });
});
