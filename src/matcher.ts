import micromatch from "micromatch";

import { PolicyError } from "./errors.js";
import type { MatchSet, PolicyRule, PullRequestInput } from "./domain.js";

/**
 * Policy cap for glob preparation, candidate comparisons, and exact-label
 * lookups. Larger path cross-products fail closed before running unbounded work.
 */
export const MATCHING_OPERATION_BUDGET = 500_000;

const pathMatcherOptions = { dot: true, nonegate: true } as const;

type PathMatcher = (value: string) => boolean;

export class MatchOperationBudget {
  private operations = 0;

  public consume(): void {
    if (this.operations >= MATCHING_OPERATION_BUDGET) {
      throw new PolicyError(
        "POLICY_MATCHING_BUDGET_EXCEEDED",
        "Policy matching exceeded the deterministic operation budget."
      );
    }
    this.operations += 1;
  }
}

function uniqueValues(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function normalizedValues(values: readonly string[]): Set<string> {
  return new Set(values.map((value) => value.toLocaleLowerCase("en-US")));
}

function normalizedPatterns(patterns: readonly string[]): Set<string> {
  return normalizedValues(patterns);
}

function matchesLabels(
  values: readonly string[],
  matchSet: MatchSet,
  budget: MatchOperationBudget
): boolean {
  const normalizedValueSet = normalizedValues(values);

  if (
    matchSet.any !== undefined &&
    ![...normalizedPatterns(matchSet.any)].some((pattern) => {
      budget.consume();
      return normalizedValueSet.has(pattern);
    })
  ) {
    return false;
  }

  if (
    matchSet.all !== undefined &&
    ![...normalizedPatterns(matchSet.all)].every((pattern) => {
      budget.consume();
      return normalizedValueSet.has(pattern);
    })
  ) {
    return false;
  }

  if (
    matchSet.none !== undefined &&
    [...normalizedPatterns(matchSet.none)].some((pattern) => {
      budget.consume();
      return normalizedValueSet.has(pattern);
    })
  ) {
    return false;
  }

  return true;
}

function matchesPaths(
  values: readonly string[],
  matchSet: MatchSet,
  budget: MatchOperationBudget
): boolean {
  const compiled = new Map<string, PathMatcher>();
  const getMatcher = (pattern: string): PathMatcher => {
    const existing = compiled.get(pattern);
    if (existing !== undefined) {
      return existing;
    }

    budget.consume();
    const matcher = micromatch.matcher(pattern, pathMatcherOptions);
    compiled.set(pattern, matcher);
    return matcher;
  };
  const isMatch = (value: string, pattern: string): boolean => {
    const matcher = getMatcher(pattern);
    budget.consume();
    return matcher(value);
  };
  const anyPatterns = uniqueValues(matchSet.any ?? []);
  const allPatterns = uniqueValues(matchSet.all ?? []);
  const nonePatterns = uniqueValues(matchSet.none ?? []);

  if (
    matchSet.any !== undefined &&
    !values.some((value) => anyPatterns.some((pattern) => isMatch(value, pattern)))
  ) {
    return false;
  }

  if (
    matchSet.all !== undefined &&
    !allPatterns.every((pattern) => values.some((value) => isMatch(value, pattern)))
  ) {
    return false;
  }

  if (
    matchSet.none !== undefined &&
    values.some((value) => nonePatterns.some((pattern) => isMatch(value, pattern)))
  ) {
    return false;
  }

  return true;
}

export function matchesRule(
  rule: PolicyRule,
  input: PullRequestInput,
  budget = new MatchOperationBudget()
): boolean {
  if (rule.when.paths !== undefined) {
    const paths = uniqueValues([...input.changedFiles, ...(input.previousChangedFiles ?? [])]);
    if (!matchesPaths(paths, rule.when.paths, budget)) {
      return false;
    }
  }
  if (rule.when.labels !== undefined && !matchesLabels(input.labels, rule.when.labels, budget)) {
    return false;
  }
  return true;
}
