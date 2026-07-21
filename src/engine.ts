import type {
  EvaluationResult,
  Policy,
  PullRequestInput,
  Requirement,
  RequirementResult
} from "./domain.js";
import { normalizeInput } from "./input.js";
import { matchesRule } from "./matcher.js";

interface MutableRequirementResult {
  key: string;
  type: Requirement["type"];
  status: "satisfied" | "missing";
  summary: string;
  ruleIds: string[];
  evidence?: string;
}

function requirementKey(requirement: Requirement): string {
  switch (requirement.type) {
    case "pr_body_section":
      return `pr_body_section:${requirement.heading.toLocaleLowerCase("en-US")}`;
    case "linked_issue":
      return "linked_issue";
    case "check":
      return `check:${requirement.name}:${[...requirement.conclusions].sort().join(",")}:${requirement.app ?? ""}`;
    case "maintainer_review":
      return `maintainer_review:${String(requirement.minimum)}`;
    case "human_attestation":
      return `human_attestation:${requirement.text}`;
  }
}

function hasNonEmptySection(body: string, wantedHeading: string): boolean {
  const lines = body.split(/\r?\n/u);
  const headingPattern = /^\s{0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/u;
  for (let index = 0; index < lines.length; index += 1) {
    const match = headingPattern.exec(lines[index] ?? "");
    const heading = match?.[2]?.trim();
    if (heading?.toLocaleLowerCase("en-US") !== wantedHeading.toLocaleLowerCase("en-US")) {
      continue;
    }

    for (let contentIndex = index + 1; contentIndex < lines.length; contentIndex += 1) {
      const line = lines[contentIndex] ?? "";
      if (headingPattern.test(line)) {
        return false;
      }
      if (line.trim().length > 0) {
        return true;
      }
    }
    return false;
  }
  return false;
}

function hasAttestation(body: string, wantedText: string): boolean {
  return body.split(/\r?\n/u).some((line) => {
    const match = /^\s*[-*+]\s+\[[xX]\]\s+(.+?)\s*$/u.exec(line);
    return match?.[1]?.trim() === wantedText;
  });
}

function evaluateRequirement(
  requirement: Requirement,
  input: PullRequestInput
): Omit<MutableRequirementResult, "key" | "ruleIds"> {
  switch (requirement.type) {
    case "pr_body_section": {
      const satisfied = hasNonEmptySection(input.body, requirement.heading);
      return {
        type: requirement.type,
        status: satisfied ? "satisfied" : "missing",
        summary: `PR body section "${requirement.heading}" has content`,
        ...(satisfied ? { evidence: `Found non-empty "${requirement.heading}" section` } : {})
      };
    }
    case "linked_issue": {
      const satisfied = input.linkedIssues.length > 0;
      return {
        type: requirement.type,
        status: satisfied ? "satisfied" : "missing",
        summary: "Pull request links an issue",
        ...(satisfied
          ? { evidence: input.linkedIssues.map((issue) => `#${String(issue)}`).join(", ") }
          : {})
      };
    }
    case "check": {
      const check = input.checks.find(
        (candidate) =>
          candidate.name === requirement.name &&
          requirement.conclusions.includes(candidate.conclusion) &&
          (requirement.app === undefined || candidate.app === requirement.app)
      );
      return {
        type: requirement.type,
        status: check === undefined ? "missing" : "satisfied",
        summary: `Check "${requirement.name}" concludes ${requirement.conclusions.join(" or ")}`,
        ...(check === undefined
          ? {}
          : {
              evidence: `${check.name}: ${check.conclusion}${check.app === undefined ? "" : ` (${check.app})`}`
            })
      };
    }
    case "maintainer_review": {
      const latestByLogin = new Map(input.reviews.map((review) => [review.login, review]));
      const count = [...latestByLogin.values()].filter(
        (review) => review.maintainer && review.state === "approved"
      ).length;
      return {
        type: requirement.type,
        status: count >= requirement.minimum ? "satisfied" : "missing",
        summary: `${String(requirement.minimum)} approving maintainer${requirement.minimum === 1 ? "" : "s"}`,
        evidence: `${String(count)} approving maintainer${count === 1 ? "" : "s"}`
      };
    }
    case "human_attestation": {
      const satisfied = hasAttestation(input.body, requirement.text);
      return {
        type: requirement.type,
        status: satisfied ? "satisfied" : "missing",
        summary: `Checked human attestation: "${requirement.text}"`,
        ...(satisfied ? { evidence: "Exact checked task-list attestation found" } : {})
      };
    }
  }
}

export function evaluate(policy: Policy, value: unknown): EvaluationResult {
  const input = normalizeInput(value);
  const rules = policy.rules.filter((rule) => matchesRule(rule, input));
  const results = new Map<string, MutableRequirementResult>();

  for (const rule of rules) {
    for (const requirement of rule.require) {
      const key = requirementKey(requirement);
      const existing = results.get(key);
      if (existing !== undefined) {
        existing.ruleIds.push(rule.id);
        continue;
      }

      results.set(key, {
        key,
        ruleIds: [rule.id],
        ...evaluateRequirement(requirement, input)
      });
    }
  }

  const requirements: RequirementResult[] = [...results.values()];
  return {
    outputVersion: 1,
    status: requirements.some((requirement) => requirement.status === "missing")
      ? "not_ready"
      : "ready",
    policyVersion: policy.version,
    triggeredRules: rules.map((rule) => rule.id),
    requirements
  };
}
