import type {
  EvaluationResult,
  MatchSet,
  Policy,
  Requirement,
  RequirementResult
} from "./domain.js";

const NO_MATCH_MESSAGE =
  "No policy rules matched this change; no evidence requirements were evaluated.";

function escapeControlCharacters(value: string): string {
  // The control ranges are intentionally matched so they can be rendered as literal data.
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\p{Format}]/gu, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return `\\u${codePoint.toString(16).padStart(4, "0")}`;
  });
}

function requirementLabel(requirement: Requirement): string {
  switch (requirement.type) {
    case "pr_body_section":
      return `PR body section "${requirement.heading}" has content`;
    case "linked_issue":
      return "pull request links an issue";
    case "check":
      return `check "${requirement.name}" concludes ${requirement.conclusions.join(" or ")}${requirement.app === undefined ? "" : ` from "${requirement.app}"`}`;
    case "maintainer_review":
      return `${String(requirement.minimum)} approving maintainer${requirement.minimum === 1 ? "" : "s"}`;
    case "human_attestation":
      return `PR body contains checked task-list text: "${requirement.text}"`;
  }
}

function matchSetLabel(kind: "paths" | "labels", matchSet: MatchSet): string[] {
  const lines: string[] = [];
  for (const operator of ["any", "all", "none"] as const) {
    const values = matchSet[operator];
    if (values !== undefined) {
      lines.push(`    ${kind} ${operator}: ${values.map(escapeControlCharacters).join(", ")}`);
    }
  }
  return lines;
}

function escapeMarkdown(value: string): string {
  const controlSafe = escapeControlCharacters(value.replace(/[\r\n]+/gu, " "));
  return controlSafe.replace(/[&<>\\`*_{}[\]()#+.!|~-]/gu, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      default:
        return `\\${character}`;
    }
  });
}

function splitResults(result: EvaluationResult): {
  satisfied: readonly RequirementResult[];
  missing: readonly RequirementResult[];
} {
  return {
    satisfied: result.requirements.filter((item) => item.status === "satisfied"),
    missing: result.requirements.filter((item) => item.status === "missing")
  };
}

function reportSummary(item: RequirementResult): string {
  if (item.type !== "human_attestation") {
    return item.summary;
  }

  return item.summary.replace(
    /^Checked human attestation:/u,
    "PR body contains the specified checked task-list text:"
  );
}

function hasCatchAllPathRule(policy: Policy): boolean {
  return policy.rules.some(
    (rule) =>
      rule.when.labels === undefined &&
      rule.when.paths?.any?.includes("**") === true &&
      rule.when.paths.all === undefined &&
      rule.when.paths.none === undefined
  );
}

export function renderText(result: EvaluationResult): string {
  const { satisfied, missing } = splitResults(result);
  const lines = [
    result.status === "ready" ? "READY FOR HUMAN REVIEW" : "NOT READY FOR HUMAN REVIEW",
    "",
    `Triggered rules: ${result.triggeredRules.length === 0 ? "(none)" : result.triggeredRules.map(escapeControlCharacters).join(", ")}`
  ];

  if (result.triggeredRules.length === 0) {
    lines.push("", "No policy rules matched:", NO_MATCH_MESSAGE);
  } else {
    if (satisfied.length > 0) {
      lines.push(
        "",
        "Verified:",
        ...satisfied.map((item) => `✓ ${escapeControlCharacters(reportSummary(item))}`)
      );
    }
    if (missing.length > 0) {
      lines.push(
        "",
        "Missing:",
        ...missing.map((item) => `✗ ${escapeControlCharacters(reportSummary(item))}`)
      );
    }
  }

  return lines.join("\n");
}

export function renderJson(result: EvaluationResult, pretty = false): string {
  return JSON.stringify(result, undefined, pretty ? 2 : undefined);
}

export function renderMarkdown(result: EvaluationResult): string {
  const { satisfied, missing } = splitResults(result);
  const status = result.status === "ready" ? "ready" : "not ready";
  const lines = [
    `## ReviewReady: ${status}`,
    "",
    `Triggered rules: ${result.triggeredRules.length === 0 ? "_none_" : result.triggeredRules.map(escapeMarkdown).join(", ")}`
  ];

  if (result.triggeredRules.length === 0) {
    lines.push("", "### No policy rules matched", NO_MATCH_MESSAGE);
  } else {
    if (satisfied.length > 0) {
      lines.push(
        "",
        "### Verified",
        ...satisfied.map((item) => `- ✅ ${escapeMarkdown(reportSummary(item))}`)
      );
    }
    if (missing.length > 0) {
      lines.push(
        "",
        "### Missing",
        ...missing.map((item) => `- ❌ ${escapeMarkdown(reportSummary(item))}`)
      );
    }
  }

  lines.push(
    "",
    "_Readiness confirms required evidence is present. It does not approve the change or establish correctness._"
  );
  return lines.join("\n");
}

export function explainPolicy(policy: Policy): string {
  const lines = [
    `ReviewReady policy version ${String(policy.version)}`,
    "",
    "Unmatched changes: v1 returns ready when no policy rule matches; no evidence requirements are evaluated.",
    hasCatchAllPathRule(policy)
      ? 'This policy has a broad path catch-all rule ("**").'
      : "This policy has no unconditional catch-all rule."
  ];

  for (const rule of policy.rules) {
    lines.push("", `Rule: ${escapeControlCharacters(rule.id)}`);
    if (rule.description !== undefined) {
      lines.push(`  ${escapeControlCharacters(rule.description)}`);
    }
    lines.push("  When:");
    if (rule.when.paths !== undefined) {
      lines.push(...matchSetLabel("paths", rule.when.paths));
    }
    if (rule.when.labels !== undefined) {
      lines.push(...matchSetLabel("labels", rule.when.labels));
    }
    lines.push(
      "  Requires:",
      ...rule.require.map((item) => `    - ${escapeControlCharacters(requirementLabel(item))}`)
    );
  }

  return lines.join("\n");
}
