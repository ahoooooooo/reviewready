import micromatch from "micromatch";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Policy, PullRequestInput } from "../src/domain.js";
import { evaluate } from "../src/engine.js";
import { MATCHING_OPERATION_BUDGET, MatchOperationBudget } from "../src/matcher.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("deterministic matcher performance contract", () => {
  it("keeps shared-glob work bounded across the maximum policy rule count", () => {
    const maximumRules = 100;
    const changedPathCount = 100;
    const maximumComparisons = maximumRules * changedPathCount;
    const policy: Policy = {
      version: 1,
      rules: Array.from({ length: maximumRules }, (_, index) => ({
        id: `rule-${String(index)}`,
        when: { paths: { none: ["missing/**"] } },
        require: [{ type: "linked_issue" }]
      }))
    };
    const input: PullRequestInput = {
      version: 1,
      changedFiles: Array.from(
        { length: changedPathCount },
        (_, index) => `src/file-${String(index)}.ts`
      ),
      body: "",
      labels: [],
      linkedIssues: [],
      checks: [],
      reviews: []
    };
    const compile = micromatch.matcher.bind(micromatch);
    let comparisons = 0;
    const matcherSpy = vi.spyOn(micromatch, "matcher").mockImplementation((pattern, options) => {
      const compiled = compile(pattern, options);
      return (value) => {
        comparisons += 1;
        return compiled(value);
      };
    });
    const consumeSpy = vi.spyOn(MatchOperationBudget.prototype, "consume");

    const result = evaluate(policy, input);

    expect(result.triggeredRules).toHaveLength(maximumRules);
    expect(result.status).toBe("not_ready");
    expect(matcherSpy).toHaveBeenCalledTimes(1);
    expect(comparisons).toBeLessThanOrEqual(maximumComparisons);
    expect(consumeSpy.mock.calls.length).toBeLessThanOrEqual(maximumComparisons + 1);
    expect(maximumComparisons + 1).toBeLessThan(MATCHING_OPERATION_BUDGET);
  });
});
