import { describe, expect, it } from "vitest";

import type { PolicyRule, PullRequestInput } from "../src/domain.js";
import { matchesRule } from "../src/matcher.js";

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
});
