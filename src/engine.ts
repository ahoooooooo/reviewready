import type {
  EvaluationResult,
  Policy,
  PullRequestInput,
  Requirement,
  RequirementResult
} from "./domain.js";
import { normalizeInput } from "./input.js";
import { MatchOperationBudget, matchesRule } from "./matcher.js";

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
      return `check:${requirement.name}:${[...requirement.conclusions].sort().join(",")}:${requirement.app ?? ""}`;
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

const htmlTagPattern =
  /<\/?([A-Za-z][A-Za-z0-9-]*)(?:\s+[^\s"'=<>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>]+))?)*\s*\/?\s*>/gu;
const rawHtmlBlockStartPattern =
  /^\s{0,3}<\/?[A-Za-z][A-Za-z0-9-]*(?:\s+[^\s"'=<>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>]+))?)*\s*\/?\s*>/u;
const voidHtmlTags = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr"
]);

function updateRawHtmlTags(line: string, tags: Map<string, number>): void {
  for (const match of line.matchAll(htmlTagPattern)) {
    const tag = match[1]?.toLocaleLowerCase("en-US");
    const rawTag = match[0];
    if (tag === undefined) {
      continue;
    }
    if (rawTag.startsWith("</")) {
      const count = tags.get(tag);
      if (count === undefined) {
        continue;
      }
      if (count === 1) tags.delete(tag);
      else tags.set(tag, count - 1);
      continue;
    }
    if (!rawTag.endsWith("/>") && !voidHtmlTags.has(tag)) {
      tags.set(tag, (tags.get(tag) ?? 0) + 1);
    }
  }
}

function isInvisibleCodePoint(codePoint: number): boolean {
  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
    return false;
  }
  return /[\p{White_Space}\p{Control}\p{Format}\p{Mark}]/u.test(String.fromCodePoint(codePoint));
}

const invisibleHtmlEntityNames = new Set([
  "af",
  "applyfunction",
  "bom",
  "emsp",
  "emsp13",
  "emsp14",
  "feff",
  "functionapplication",
  "hairsp",
  "ic",
  "invisiblecomma",
  "invisibleseparator",
  "invisibletimes",
  "it",
  "mediumspace",
  "nobreak",
  "nbsp",
  "negativemediumspace",
  "negativethickspace",
  "negativethinspace",
  "negativeverythinspace",
  "nmedium",
  "newline",
  "numsp",
  "nthick",
  "nthin",
  "nverythin",
  "puncsp",
  "shy",
  "tab",
  "thickspace",
  "thinsp",
  "thinspace",
  "verythinspace",
  "wordjoiner",
  "zerowidthnonjoiner",
  "zerowidthjoiner",
  "zerowidthspace",
  "zwnj",
  "zwj"
]);
const htmlEntityPattern = /&(?:#x([0-9a-f]+)|#([0-9]+)|([A-Za-z][A-Za-z0-9]+));/giu;
const linkReferenceDefinitionPattern = /^\s{0,3}\[[^\]\r\n]+\]:[ \t]+/u;

function stripInvisibleHtmlEntities(line: string): string {
  return line.replace(htmlEntityPattern, (entity, hexadecimal, decimal, name) => {
    const codePoint =
      typeof hexadecimal === "string"
        ? Number.parseInt(hexadecimal, 16)
        : typeof decimal === "string"
          ? Number.parseInt(decimal, 10)
          : undefined;
    const invisible =
      (codePoint !== undefined && isInvisibleCodePoint(codePoint)) ||
      (typeof name === "string" && invisibleHtmlEntityNames.has(name.toLocaleLowerCase("en-US")));
    return invisible ? "" : entity;
  });
}

function visibleMarkdownLines(body: string): string[] | undefined {
  const visible: string[] = [];
  let fence: MarkdownFence | undefined;
  let htmlComment = false;
  const rawHtmlTags = new Map<string, number>();
  let linkReferenceContinuation = false;

  for (const rawLine of body.split(/\r?\n/u)) {
    if (fence !== undefined) {
      if (closesFence(rawLine, fence)) {
        fence = undefined;
      }
      continue;
    }

    if (rawHtmlTags.size > 0 || rawHtmlBlockStartPattern.test(rawLine)) {
      updateRawHtmlTags(rawLine, rawHtmlTags);
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
    const renderedLine = stripInvisibleHtmlEntities(visibleLine);
    if (renderedLine.trim().length === 0) {
      linkReferenceContinuation = false;
      visible.push(visibleLine);
      continue;
    }
    if (linkReferenceContinuation && /^[ \t]+/u.test(visibleLine)) {
      continue;
    }
    if (!linkReferenceDefinitionPattern.test(visibleLine)) {
      linkReferenceContinuation = false;
      visible.push(visibleLine);
    } else {
      linkReferenceContinuation = true;
    }
  }

  return htmlComment || rawHtmlTags.size > 0 ? undefined : visible;
}

interface MarkdownHeading {
  readonly level: number;
  readonly text: string;
}

const headingPattern = /^\s{0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/u;
const visibleMarkdownTextPattern = /[^\p{White_Space}\p{Control}\p{Format}\p{Mark}]/u;
const indentedCodePattern = /^(?: {4}|\t)/u;
const emptyReferenceMarkdownLinkPattern = /!?\[\s*\]\[[^\]\r\n]*\]/gu;
const markdownWhitespacePattern = /\s/u;

function emptyInlineLinkEnd(value: string, openIndex: number): number | undefined {
  let depth = 1;
  for (let index = openIndex; index < value.length; index += 1) {
    const character = value[index];
    if (character === "\r" || character === "\n") {
      return undefined;
    }
    if (character === "\\") {
      if (index + 1 >= value.length) {
        return undefined;
      }
      index += 1;
      continue;
    }
    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
  }
  return undefined;
}

function stripEmptyInlineMarkdownLinks(value: string): string {
  const pieces: string[] = [];
  let cursor = 0;
  let index = 0;
  while (index < value.length) {
    const image = value[index] === "!" && value[index + 1] === "[";
    const opening = image ? index + 1 : value[index] === "[" ? index : -1;
    if (opening < 0) {
      index += 1;
      continue;
    }

    let labelEnd = opening + 1;
    while (labelEnd < value.length && markdownWhitespacePattern.test(value[labelEnd] ?? "")) {
      labelEnd += 1;
    }
    if (value[labelEnd] !== "]" || value[labelEnd + 1] !== "(") {
      index = opening + 1;
      continue;
    }

    const end = emptyInlineLinkEnd(value, labelEnd + 2);
    if (end === undefined) {
      break;
    }
    pieces.push(value.slice(cursor, image ? opening - 1 : opening));
    cursor = end;
    index = end;
  }
  pieces.push(value.slice(cursor));
  return pieces.join("");
}

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

function hasVisibleMarkdownText(line: string): boolean {
  if (indentedCodePattern.test(line)) {
    return false;
  }
  const withoutEmptyMarkdownMarkers = stripEmptyInlineMarkdownLinks(
    stripInvisibleHtmlEntities(line)
  ).replace(emptyReferenceMarkdownLinkPattern, "");
  return visibleMarkdownTextPattern.test(withoutEmptyMarkdownMarkers);
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
      if (hasVisibleMarkdownText(line)) {
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
    return match?.[1]?.trim() === wantedText && hasVisibleMarkdownText(match[1]);
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

function hasConflictingTimestampedState(
  current: PullRequestInput["reviews"][number],
  candidate: PullRequestInput["reviews"][number]
): boolean {
  const currentTimestamp = reviewTimestamp(current);
  const candidateTimestamp = reviewTimestamp(candidate);
  return (
    currentTimestamp !== undefined &&
    candidateTimestamp !== undefined &&
    currentTimestamp === candidateTimestamp &&
    current.state !== candidate.state
  );
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
          : requirement.app === undefined
            ? namedChecks
            : namedChecks.filter((candidate) => candidate.app === requirement.app);
      const satisfies = (candidate: PullRequestInput["checks"][number]): boolean =>
        candidate.conclusion !== null && requirement.conclusions.includes(candidate.conclusion);
      const check =
        candidates.length > 0 && candidates.every(satisfies)
          ? candidates.find((candidate) => satisfies(candidate))
          : undefined;
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
        const loginKey = review.login.toLocaleLowerCase("en-US");
        const current = latestByLogin.get(loginKey);
        if (current !== undefined && hasConflictingTimestampedState(current, review)) {
          latestByLogin.set(loginKey, { ...review, state: "dismissed" });
          continue;
        }
        if (current === undefined || isLaterReview(current, review)) {
          latestByLogin.set(loginKey, review);
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
        summary: `Checked human attestation: "${requirement.text}"`,
        ...(satisfied ? { evidence: "Exact checked task-list attestation found" } : {})
      };
    }
  }
}

export function evaluate(policy: Policy, value: unknown): EvaluationResult {
  const input = normalizeInput(value);
  const matchingBudget = new MatchOperationBudget();
  const rules = policy.rules.filter((rule) => matchesRule(rule, input, matchingBudget));
  const results = new Map<string, MutableRequirementResult>();

  for (const rule of rules) {
    for (const requirement of rule.require) {
      const identity = requirementIdentity(requirement);
      const existing = results.get(identity);
      if (existing !== undefined) {
        if (!existing.ruleIds.includes(rule.id)) {
          existing.ruleIds.push(rule.id);
        }
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
