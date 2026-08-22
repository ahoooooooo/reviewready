import { describe, expect, it } from "vitest";

import type { MatchSet, PolicyRule, PullRequestInput, RuleCondition } from "../src/domain.js";
import { matchesRule } from "../src/matcher.js";

const DEFAULT_SEED = 0x5eedc0de;
const CASE_COUNT = 1_000;
const roots = ["src", "docs", ".github", "vendor", "test", "packages", "安全"] as const;
const files = ["index.ts", "README.md", "ci.yml", "a.test.ts", "nested.json"] as const;
const labels = ["bug", "needs-review", "skip", "security", "文件"] as const;

interface SeededRandom {
  readonly boolean: () => boolean;
  readonly integer: (exclusiveMaximum: number) => number;
}

function selectedSeed(): number {
  const source = process.env.REVIEWREADY_FUZZ_SEED;
  if (source === undefined) {
    return DEFAULT_SEED;
  }
  const parsed = Number(source);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 0xffffffff) {
    throw new Error("REVIEWREADY_FUZZ_SEED must be an unsigned 32-bit integer.");
  }
  return parsed;
}

function seededRandom(seed: number): SeededRandom {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (value ^ (value >>> 14)) >>> 0;
  };
  return {
    boolean: () => (next() & 1) === 1,
    integer: (exclusiveMaximum) => {
      if (!Number.isSafeInteger(exclusiveMaximum) || exclusiveMaximum <= 0) {
        throw new Error("Random integer bounds must be positive safe integers.");
      }
      return next() % exclusiveMaximum;
    }
  };
}

function pick<const Values extends readonly [unknown, ...unknown[]]>(
  random: SeededRandom,
  values: Values
): Values[number] {
  return values[random.integer(values.length)];
}

function randomPath(random: SeededRandom): string {
  return `${pick(random, roots)}/${pick(random, files)}`;
}

function randomPattern(random: SeededRandom): string {
  const root = pick(random, roots);
  return random.boolean() ? `${root}/**` : `${root}/${pick(random, files)}`;
}

function randomLabel(random: SeededRandom): string {
  const label = pick(random, labels);
  return random.boolean() ? label.toLocaleUpperCase("en-US") : label;
}

function randomValues(
  random: SeededRandom,
  createValue: (random: SeededRandom) => string
): string[] {
  return Array.from({ length: random.integer(5) + 1 }, () => createValue(random));
}

function randomMatchSet(
  random: SeededRandom,
  createValue: (random: SeededRandom) => string
): MatchSet {
  let includeAny = random.boolean();
  const includeAll = random.boolean();
  const includeNone = random.boolean();
  if (!includeAny && !includeAll && !includeNone) {
    includeAny = true;
  }
  return {
    ...(includeAny ? { any: randomValues(random, createValue) } : {}),
    ...(includeAll ? { all: randomValues(random, createValue) } : {}),
    ...(includeNone ? { none: randomValues(random, createValue) } : {})
  };
}

function randomCondition(random: SeededRandom): RuleCondition {
  let includePaths = random.boolean();
  const includeLabels = random.boolean();
  if (!includePaths && !includeLabels) {
    includePaths = true;
  }
  return {
    ...(includePaths ? { paths: randomMatchSet(random, randomPattern) } : {}),
    ...(includeLabels ? { labels: randomMatchSet(random, randomLabel) } : {})
  };
}

function randomInput(random: SeededRandom): PullRequestInput {
  const previousChangedFiles = random.boolean() ? randomValues(random, randomPath) : undefined;
  return {
    version: 1,
    changedFiles: randomValues(random, randomPath),
    ...(previousChangedFiles === undefined ? {} : { previousChangedFiles }),
    body: "",
    labels: randomValues(random, randomLabel),
    linkedIssues: [],
    checks: [],
    reviews: []
  };
}

function restrictedGlobMatches(value: string, pattern: string): boolean {
  if (pattern.endsWith("/**")) {
    return value.startsWith(pattern.slice(0, -2));
  }
  return value === pattern;
}

function referenceMatchSet(
  values: readonly string[],
  matchSet: MatchSet,
  matches: (value: string, pattern: string) => boolean
): boolean {
  const anyMatches =
    matchSet.any === undefined ||
    values.some((value) => matchSet.any?.some((pattern) => matches(value, pattern)) === true);
  const allMatches =
    matchSet.all === undefined ||
    matchSet.all.every((pattern) => values.some((value) => matches(value, pattern)));
  const noneMatches =
    matchSet.none === undefined ||
    !values.some((value) => matchSet.none?.some((pattern) => matches(value, pattern)) === true);
  return anyMatches && allMatches && noneMatches;
}

function referenceMatchesRule(rule: PolicyRule, input: PullRequestInput): boolean {
  if (rule.when.paths !== undefined) {
    const paths = [...input.changedFiles, ...(input.previousChangedFiles ?? [])];
    if (!referenceMatchSet(paths, rule.when.paths, restrictedGlobMatches)) {
      return false;
    }
  }
  if (rule.when.labels !== undefined) {
    const normalizedLabels = input.labels.map((label) => label.toLocaleLowerCase("en-US"));
    const matchesLabel = (value: string, pattern: string): boolean =>
      value === pattern.toLocaleLowerCase("en-US");
    if (!referenceMatchSet(normalizedLabels, rule.when.labels, matchesLabel)) {
      return false;
    }
  }
  return true;
}

function duplicateAndReverse(values: readonly string[]): string[] {
  return [...values].reverse().flatMap((value) => [value, value]);
}

function equivalentMatchSet(matchSet: MatchSet): MatchSet {
  return {
    ...(matchSet.any === undefined ? {} : { any: duplicateAndReverse(matchSet.any) }),
    ...(matchSet.all === undefined ? {} : { all: duplicateAndReverse(matchSet.all) }),
    ...(matchSet.none === undefined ? {} : { none: duplicateAndReverse(matchSet.none) })
  };
}

function equivalentRule(rule: PolicyRule): PolicyRule {
  return {
    ...rule,
    when: {
      ...(rule.when.paths === undefined ? {} : { paths: equivalentMatchSet(rule.when.paths) }),
      ...(rule.when.labels === undefined ? {} : { labels: equivalentMatchSet(rule.when.labels) })
    }
  };
}

function equivalentInput(input: PullRequestInput): PullRequestInput {
  return {
    ...input,
    changedFiles: duplicateAndReverse(input.changedFiles),
    ...(input.previousChangedFiles === undefined
      ? {}
      : { previousChangedFiles: duplicateAndReverse(input.previousChangedFiles) }),
    labels: duplicateAndReverse(input.labels)
  };
}

describe("seeded matcher properties", () => {
  it("matches an independent restricted-glob oracle and preserves set semantics", () => {
    const seed = selectedSeed();
    const random = seededRandom(seed);

    for (let caseIndex = 0; caseIndex < CASE_COUNT; caseIndex += 1) {
      const rule: PolicyRule = {
        id: "generated",
        when: randomCondition(random),
        require: [{ type: "linked_issue" }]
      };
      const input = randomInput(random);
      const context = `seed=${String(seed)} case=${String(caseIndex)}`;
      const actual = matchesRule(rule, input);

      expect(actual, context).toBe(referenceMatchesRule(rule, input));
      expect(matchesRule(equivalentRule(rule), equivalentInput(input)), context).toBe(actual);
    }
  });
});
