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

function structuredKey(parts: readonly unknown[]): string {
  return JSON.stringify(parts);
}

function requirementIdentity(requirement: Requirement): string {
  switch (requirement.type) {
    case "pr_body_section":
      return structuredKey([requirement.type, requirement.heading.toLocaleLowerCase("en-US")]);
    case "linked_issue":
      return structuredKey([requirement.type]);
    case "check":
      return structuredKey([
        requirement.type,
        requirement.name,
        [...new Set(requirement.conclusions)].sort(),
        requirement.app ?? null
      ]);
    case "maintainer_review":
      return structuredKey([requirement.type, requirement.minimum]);
    case "human_attestation":
      return structuredKey([requirement.type, requirement.text]);
  }
}

function publicRequirementKey(requirement: Requirement): string {
  switch (requirement.type) {
    case "pr_body_section":
      return `pr_body_section:${requirement.heading.toLocaleLowerCase("en-US")}`;
    case "linked_issue":
      return "linked_issue";
    case "check":
      return `check:${requirement.name}:${[...new Set(requirement.conclusions)].sort().join(",")}:${requirement.app ?? ""}`;
    case "maintainer_review":
      return `maintainer_review:${String(requirement.minimum)}`;
    case "human_attestation":
      return `human_attestation:${requirement.text}`;
  }
}

interface MarkdownFence {
  readonly marker: "`" | "~";
  readonly length: number;
}

function fenceMarker(line: string): MarkdownFence | undefined {
  const match = /^\s{0,3}(`{3,}|~{3,})/u.exec(line);
  const marker = match?.[1];
  if (marker === undefined) {
    return undefined;
  }
  return {
    marker: marker[0] as "`" | "~",
    length: marker.length
  };
}

function closesFence(line: string, fence: MarkdownFence): boolean {
  const match = /^\s{0,3}(`{3,}|~{3,})[ \t]*$/u.exec(line);
  const marker = match?.[1];
  return marker !== undefined && marker[0] === fence.marker && marker.length >= fence.length;
}

function visibleMarkdownLines(body: string): string[] | undefined {
  const visible: string[] = [];
  let fence: MarkdownFence | undefined;
  let htmlComment = false;

  for (const rawLine of body.split(/\r?\n/u)) {
    if (fence !== undefined) {
      if (closesFence(rawLine, fence)) {
        fence = undefined;
      }
      continue;
    }

    let line = rawLine;
    let visibleLine = "";
    while (line.length > 0) {
      if (htmlComment) {
        const end = line.indexOf("-->");
        if (end === -1) {
          break;
        }
        htmlComment = false;
        line = line.slice(end + 3);
        continue;
      }

      const start = line.indexOf("<!--");
      if (start === -1) {
        visibleLine += line;
        line = "";
        continue;
      }

      visibleLine += line.slice(0, start);
      htmlComment = true;
      line = line.slice(start + 4);
    }

    const marker = fenceMarker(visibleLine);
    if (marker !== undefined) {
      fence = marker;
      continue;
    }
    visible.push(visibleLine);
  }

  return htmlComment ? undefined : visible;
}

interface MarkdownHeading {
  readonly level: number;
  readonly text: string;
}

const headingPattern = /^\s{0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/u;

function markdownHeading(line: string): MarkdownHeading | undefined {
  const match = headingPattern.exec(line);
  const marker = match?.[1];
  const text = match?.[2]?.trim();
  if (marker === undefined || text === undefined) {
    return undefined;
  }
  return {
    level: marker.length,
    text
  };
}

function hasNonEmptySection(body: string, wantedHeading: string): boolean {
  const lines = visibleMarkdownLines(body);
  if (lines === undefined) {
    return false;
  }

  const wanted = wantedHeading.toLocaleLowerCase("en-US");
  for (let index = 0; index < lines.length; index += 1) {
    const heading = markdownHeading(lines[index] ?? "");
    if (heading?.text.toLocaleLowerCase("en-US") !== wanted) {
      continue;
    }

    for (let contentIndex = index + 1; contentIndex < lines.length; contentIndex += 1) {
      const line = lines[contentIndex] ?? "";
      const nestedHeading = markdownHeading(line);
      if (nestedHeading !== undefined) {
        if (nestedHeading.level <= heading.level) {
          break;
        }
        continue;
      }
      if (line.trim().length > 0) {
        return true;
      }
    }
  }
  return false;
}

function hasAttestation(body: string, wantedText: string): boolean {
  const lines = visibleMarkdownLines(body);
  if (lines === undefined) {
    return false;
  }

  return lines.some((line) => {
    const match = /^[ \t]{0,3}[-*+][ \t]+\[[xX]\][ \t]+(.+?)[ \t]*$/u.exec(line);
    return match?.[1]?.trim() === wantedText;
  });
}

function reviewTimestamp(review: PullRequestInput["reviews"][number]): number | undefined {
  if (review.submittedAt === undefined) {
    return undefined;
  }
  const timestamp = Date.parse(review.submittedAt);
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

function isLaterReview(
  current: PullRequestInput["reviews"][number],
  candidate: PullRequestInput["reviews"][number]
): boolean {
  const currentTimestamp = reviewTimestamp(current);
  const candidateTimestamp = reviewTimestamp(candidate);

  if (candidateTimestamp === undefined || currentTimestamp === undefined) {
    return candidateTimestamp !== undefined || currentTimestamp === undefined;
  }
  return candidateTimestamp >= currentTimestamp;
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
      const namedChecks = input.checks.filter((candidate) => candidate.name === requirement.name);
      const unqualifiedChecks = namedChecks.filter((candidate) => candidate.app === undefined);
      const candidates =
        requirement.app === undefined && unqualifiedChecks.length > 0
          ? unqualifiedChecks
          : namedChecks;
      const check = candidates.find(
        (candidate) =>
          candidate.conclusion !== null &&
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
              evidence: `${check.name}: ${check.conclusion === null ? "pending" : check.conclusion}${check.app === undefined ? "" : ` (${check.app})`}`
            })
      };
    }
    case "maintainer_review": {
      const latestByLogin = new Map<string, PullRequestInput["reviews"][number]>();
      for (const review of input.reviews) {
        if (review.state === "commented") {
          continue;
        }
        const current = latestByLogin.get(review.login);
        if (current === undefined || isLaterReview(current, review)) {
          latestByLogin.set(review.login, review);
        }
      }
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
        summary: `PR body contains the specified checked task-list text: "${requirement.text}"`,
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
      const identity = requirementIdentity(requirement);
      const existing = results.get(identity);
      if (existing !== undefined) {
        existing.ruleIds.push(rule.id);
        continue;
      }

      results.set(identity, {
        key: publicRequirementKey(requirement),
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
