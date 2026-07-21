import type {
  EvaluationResult,
  MatchSet,
  Policy,
  Requirement,
  RequirementResult
} from "./domain.js";

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
      return `human attestation "${requirement.text}" is checked`;
  }
}

function matchSetLabel(kind: "paths" | "labels", matchSet: MatchSet): string[] {
  const lines: string[] = [];
  for (const operator of ["any", "all", "none"] as const) {
    const values = matchSet[operator];
    if (values !== undefined) {
      lines.push(`    ${kind} ${operator}: ${values.join(", ")}`);
    }
  }
  return lines;
}

function escapeMarkdown(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/[\r\n]+/gu, " ")
    .replace(/([`*_{}()#+.!|])/gu, "\\$1")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]");
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

export function renderText(result: EvaluationResult): string {
  const { satisfied, missing } = splitResults(result);
  const lines = [
    result.status === "ready" ? "READY FOR HUMAN REVIEW" : "NOT READY FOR HUMAN REVIEW",
    "",
    `Triggered rules: ${result.triggeredRules.length === 0 ? "(none)" : result.triggeredRules.join(", ")}`
  ];

  if (satisfied.length > 0) {
    lines.push("", "Verified:", ...satisfied.map((item) => `✓ ${item.summary}`));
  }
  if (missing.length > 0) {
    lines.push("", "Missing:", ...missing.map((item) => `✗ ${item.summary}`));
  }

  return lines.join("\n");
}

export function renderMarkdown(result: EvaluationResult): string {
  const { satisfied, missing } = splitResults(result);
  const status = result.status === "ready" ? "ready" : "not ready";
  const lines = [
    `## ReviewReady: ${status}`,
    "",
    `Triggered rules: ${result.triggeredRules.length === 0 ? "_none_" : result.triggeredRules.map(escapeMarkdown).join(", ")}`
  ];

  if (satisfied.length > 0) {
    lines.push(
      "",
      "### Verified",
      ...satisfied.map((item) => `- ✅ ${escapeMarkdown(item.summary)}`)
    );
  }
  if (missing.length > 0) {
    lines.push("", "### Missing", ...missing.map((item) => `- ❌ ${escapeMarkdown(item.summary)}`));
  }

  lines.push(
    "",
    "_Readiness confirms required evidence is present. It does not approve the change or establish correctness._"
  );
  return lines.join("\n");
}

export function explainPolicy(policy: Policy): string {
  const lines = [`ReviewReady policy version ${String(policy.version)}`];

  for (const rule of policy.rules) {
    lines.push("", `Rule: ${rule.id}`);
    if (rule.description !== undefined) {
      lines.push(`  ${rule.description}`);
    }
    lines.push("  When:");
    if (rule.when.paths !== undefined) {
      lines.push(...matchSetLabel("paths", rule.when.paths));
    }
    if (rule.when.labels !== undefined) {
      lines.push(...matchSetLabel("labels", rule.when.labels));
    }
    lines.push("  Requires:", ...rule.require.map((item) => `    - ${requirementLabel(item)}`));
  }

  return lines.join("\n");
}
