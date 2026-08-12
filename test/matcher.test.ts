import micromatch from "micromatch";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PolicyRule, PullRequestInput } from "../src/domain.js";
import { MATCHING_OPERATION_BUDGET, matchesRule } from "../src/matcher.js";

const input: PullRequestInput = {
  version: 1,
  changedFiles: [".github/workflows/ci.yml", "src/index.ts"],
  body: "",
  labels: ["Needs-Review", "bug"],
  linkedIssues: [],
  checks: [],
  reviews: []
};

function rule(when: PolicyRule["when"]): PolicyRule {
  return {
    id: "match",
    when,
    require: [{ type: "linked_issue" }]
  };
}

function inputWithPaths(
  changedFiles: readonly string[],
  previousChangedFiles?: readonly string[]
): PullRequestInput {
  return {
    ...input,
    changedFiles,
    ...(previousChangedFiles === undefined ? {} : { previousChangedFiles })
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("matchesRule", () => {
  it("supports any, all, and none path conditions including dot directories", () => {
    expect(
      matchesRule(
        rule({
          paths: {
            any: [".github/**"],
            all: [".github/workflows/**", "src/**"],
            none: ["vendor/**"]
          }
        }),
        input
      )
    ).toBe(true);
  });

  it("fails each unsatisfied path operator", () => {
    expect(matchesRule(rule({ paths: { any: ["docs/**"] } }), input)).toBe(false);
    expect(matchesRule(rule({ paths: { all: [".github/**", "docs/**"] } }), input)).toBe(false);
    expect(matchesRule(rule({ paths: { none: ["src/**"] } }), input)).toBe(false);
  });

  it("matches labels case-insensitively and combines path and label conditions", () => {
    expect(
      matchesRule(
        rule({
          paths: { any: ["src/**"] },
          labels: { all: ["needs-review", "BUG"], none: ["skip"] }
        }),
        input
      )
    ).toBe(true);
    expect(
      matchesRule(
        rule({
          paths: { any: ["src/**"] },
          labels: { none: ["Needs-Review"] }
        }),
        input
      )
    ).toBe(false);
  });

  it("matches both sides of a rename without collapsing path semantics", () => {
    const renamedInput: PullRequestInput = {
      ...input,
      changedFiles: ["src/new.ts"],
      previousChangedFiles: ["vendor/old.ts"]
    };

    expect(matchesRule(rule({ paths: { any: ["src/**"] } }), renamedInput)).toBe(true);
    expect(matchesRule(rule({ paths: { any: ["vendor/**"] } }), renamedInput)).toBe(true);
    expect(matchesRule(rule({ paths: { all: ["src/**", "vendor/**"] } }), renamedInput)).toBe(true);
    expect(matchesRule(rule({ paths: { none: ["vendor/**"] } }), renamedInput)).toBe(false);
  });

  it("compiles each unique glob once and does not repeat duplicate path work", () => {
    const compile = micromatch.matcher.bind(micromatch);
    let comparisons = 0;
    const matcherSpy = vi.spyOn(micromatch, "matcher").mockImplementation((pattern, options) => {
      const compiled = compile(pattern, options);
      return (value) => {
        comparisons += 1;
        return compiled(value);
      };
    });

    expect(
      matchesRule(
        rule({
          paths: {
            any: ["src/**", "src/**"],
            all: ["src/**"],
            none: ["docs/**", "docs/**"]
          }
        }),
        inputWithPaths(["src/file.ts", "src/file.ts", "other/file.txt"])
      )
    ).toBe(true);

    expect(matcherSpy.mock.calls.map(([pattern]) => pattern)).toEqual(["src/**", "docs/**"]);
    expect(comparisons).toBe(4);
  });

  it("keeps path globs and case-insensitive exact labels semantically distinct", () => {
    expect(
      matchesRule(
        rule({
          paths: { any: ["src/**"] },
          labels: { all: ["needs-review"] }
        }),
        input
      )
    ).toBe(true);
    expect(matchesRule(rule({ labels: { any: ["bug*"] } }), input)).toBe(false);
  });

  it("fails deterministically before an excessive path comparison budget is exhausted", () => {
    const changedFiles = Array.from(
      { length: 3000 },
      (_, index) => "changed/" + String(index) + ".ts"
    );
    const previousChangedFiles = Array.from(
      { length: 3000 },
      (_, index) => "previous/" + String(index) + ".ts"
    );
    const patterns = Array.from({ length: 100 }, (_, index) => "missing/" + String(index) + "/**");
    let observedOperations = 0;

    vi.spyOn(micromatch, "isMatch").mockImplementation(() => {
      observedOperations += 1;
      return false;
    });
    vi.spyOn(micromatch, "matcher").mockImplementation(() => {
      observedOperations += 1;
      return () => {
        observedOperations += 1;
        return false;
      };
    });

    expect(() =>
      matchesRule(
        rule({ paths: { none: patterns } }),
        inputWithPaths(changedFiles, previousChangedFiles)
      )
    ).toThrow(
      expect.objectContaining({
        name: "PolicyError",
        code: "POLICY_MATCHING_BUDGET_EXCEEDED",
        kind: "policy",
        message: "Policy matching exceeded the deterministic operation budget."
      })
    );
    expect(observedOperations).toBeLessThanOrEqual(MATCHING_OPERATION_BUDGET);
  });
});
