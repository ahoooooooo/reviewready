import micromatch from "micromatch";

import type { MatchSet, PolicyRule, PullRequestInput } from "./domain.js";

function matchesPatterns(values: readonly string[], matchSet: MatchSet, paths: boolean): boolean {
  const isMatch = (value: string, pattern: string): boolean =>
    paths
      ? micromatch.isMatch(value, pattern, { dot: true, nonegate: true })
      : value.toLocaleLowerCase("en-US") === pattern.toLocaleLowerCase("en-US");

  if (
    matchSet.any !== undefined &&
    !values.some((value) => matchSet.any?.some((pattern) => isMatch(value, pattern)) === true)
  ) {
    return false;
  }

  if (
    matchSet.all !== undefined &&
    !matchSet.all.every((pattern) => values.some((value) => isMatch(value, pattern)))
  ) {
    return false;
  }

  if (
    matchSet.none !== undefined &&
    values.some((value) => matchSet.none?.some((pattern) => isMatch(value, pattern)) === true)
  ) {
    return false;
  }

  return true;
}

export function matchesRule(rule: PolicyRule, input: PullRequestInput): boolean {
  if (
    rule.when.paths !== undefined &&
    !matchesPatterns(input.changedFiles, rule.when.paths, true)
  ) {
    return false;
  }
  if (rule.when.labels !== undefined && !matchesPatterns(input.labels, rule.when.labels, false)) {
    return false;
  }
  return true;
}
