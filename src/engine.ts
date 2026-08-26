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
  /<(?:\/([A-Za-z][A-Za-z0-9-]*)[\t\n\f\r ]*|([A-Za-z][A-Za-z0-9-]*)(?=[\s/>])(?:[\t\n\f\r ]+(?:[^"'<>]|"[^"]*"|'[^']*')*)?[\t\n\f\r ]*\/?)>/gu;
const rawHtmlTagPresencePattern =
  /<(?:\/[A-Za-z][A-Za-z0-9-]*[\t\n\f\r ]*|[A-Za-z][A-Za-z0-9-]*(?=[\s/>])(?:[\t\n\f\r ]+(?:[^"'<>]|"[^"]*"|'[^']*')*)?[\t\n\f\r ]*\/?)>/u;
const rawHtmlBlockStartPattern =
  /^\s{0,3}<(?:\/[A-Za-z][A-Za-z0-9-]*[\t\n\f\r ]*|[A-Za-z][A-Za-z0-9-]*(?=[\s/>])(?:[\t\n\f\r ]+(?:[^"'<>]|"[^"]*"|'[^']*')*)?[\t\n\f\r ]*\/?)>/u;
const rawHtmlTagFragmentStartPattern = /^\s{0,3}<\/?[A-Za-z][A-Za-z0-9-]*(?=$|[\t\n\f\r /])/u;
const maximumRawHtmlTagLength = 4_096;
const maximumRawHtmlSpecialFragmentLength = 4_096;

type RawHtmlSpecialFragmentKind = "processing-instruction" | "declaration" | "cdata";

interface RawHtmlSpecialFragment {
  readonly kind: RawHtmlSpecialFragmentKind;
  text: string;
}

function isAsciiUppercase(value: string | undefined): boolean {
  return value !== undefined && value >= "A" && value <= "Z";
}

function isAsciiLetter(value: string | undefined): boolean {
  return isAsciiUppercase(value) || (value !== undefined && value >= "a" && value <= "z");
}

function rawHtmlSpecialFragmentKind(line: string): RawHtmlSpecialFragmentKind | undefined {
  const content = line.replace(/^\s{0,3}/u, "");
  if (content.startsWith("<?")) {
    return "processing-instruction";
  }
  if (content.startsWith("<![CDATA[")) {
    return "cdata";
  }
  if (content.startsWith("<!") && isAsciiUppercase(content[2])) {
    return "declaration";
  }
  return undefined;
}

function rawHtmlSpecialFragmentIsClosed(value: string, kind: RawHtmlSpecialFragmentKind): boolean {
  const end = kind === "processing-instruction" ? "?>" : kind === "declaration" ? ">" : "]]>";
  return value.includes(end);
}

function hasRawHtmlSpecialTagPresence(value: string): boolean {
  const processingInstructionStart = value.indexOf("<?");
  if (
    processingInstructionStart !== -1 &&
    value.indexOf("?>", processingInstructionStart + 2) !== -1
  ) {
    return true;
  }

  const cdataStart = value.indexOf("<![CDATA[");
  if (cdataStart !== -1 && value.indexOf("]]>", cdataStart + 9) !== -1) {
    return true;
  }

  let index = value.indexOf("<!");
  while (index !== -1) {
    if (isAsciiLetter(value[index + 2])) {
      return value.indexOf(">", index + 2) !== -1;
    }
    index = value.indexOf("<!", index + 2);
  }
  return false;
}

function hasRawHtmlPresence(value: string): boolean {
  return rawHtmlTagPresencePattern.test(value) || hasRawHtmlSpecialTagPresence(value);
}

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
    const tag = (match[1] ?? match[2])?.toLocaleLowerCase("en-US");
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
  return /[\p{White_Space}\p{Control}\p{Format}\p{Mark}\p{Default_Ignorable_Code_Point}]/u.test(
    String.fromCodePoint(codePoint)
  );
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
  "nonbreakingspace",
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
const linkReferenceDefinitionPattern = /^\s{0,3}\[([^\]\r\n]+)\]:[ \t]*(.*)$/u;
const emptyLinkReferenceDefinitionPattern = /^\s{0,3}\[([^\]\r\n]+)\]:[ \t]*$/u;
const indentedAtxHeadingPattern = /^[ \t]{1,3}#{1,6}(?=$|[ \t])/u;

function normalizeLinkReferenceLabel(value: string): string {
  return value
    .trim()
    .replace(/[ \t]+/gu, " ")
    .toLocaleLowerCase("en-US");
}

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

interface VisibleMarkdownDocument {
  lines: string[];
  referenceLabels: Set<string>;
}

interface MultilineLinkReferenceDefinition {
  readonly label: string;
  readonly lineIndexes: readonly number[];
}

interface MultilineLinkReferenceDefinitions {
  readonly byStart: ReadonlyMap<number, MultilineLinkReferenceDefinition>;
  readonly consumedLineIndexes: ReadonlySet<number>;
}

function skipHorizontalWhitespace(value: string, start: number): number {
  let index = start;
  while (index < value.length && (value[index] === " " || value[index] === "\t")) {
    index += 1;
  }
  return index;
}

function linkReferenceDestinationEnd(value: string, start: number): number | undefined {
  if (value[start] === "<") {
    for (let index = start + 1; index < value.length; index += 1) {
      const character = value[index];
      if (character === "\\") {
        if (index + 1 >= value.length || value[index + 1] === "\r" || value[index + 1] === "\n") {
          return undefined;
        }
        index += 1;
        continue;
      }
      if (character === "<" || character === "\r" || character === "\n") {
        return undefined;
      }
      if (character === ">") {
        return index + 1;
      }
    }
    return undefined;
  }

  let depth = 0;
  let hasCharacter = false;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (character === " " || character === "\t") {
      return hasCharacter && depth === 0 ? index : undefined;
    }
    const codePoint = character?.codePointAt(0);
    if (
      character === "\r" ||
      character === "\n" ||
      (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f))
    ) {
      return undefined;
    }
    if (character === "\\") {
      if (index + 1 >= value.length || value[index + 1] === "\r" || value[index + 1] === "\n") {
        return undefined;
      }
      hasCharacter = true;
      index += 1;
      continue;
    }
    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      if (depth === 0) {
        return undefined;
      }
      depth -= 1;
    }
    hasCharacter = true;
  }
  return hasCharacter && depth === 0 ? value.length : undefined;
}

function linkTitleEndWithoutLineEnding(value: string, start: number): number | undefined {
  const quote = value[start];
  if (quote === '"' || quote === "'") {
    return quotedLinkTitleEnd(value, start, quote);
  }
  if (quote === "(") {
    return parenthesizedLinkTitleEnd(value, start);
  }
  return undefined;
}

interface LinkReferenceContinuationLine {
  readonly hasTitle: boolean;
}

function parseLinkReferenceContinuationLine(
  value: string
): LinkReferenceContinuationLine | undefined {
  const destinationStart = skipHorizontalWhitespace(value, 0);
  const destinationEnd = linkReferenceDestinationEnd(value, destinationStart);
  if (destinationEnd === undefined) {
    return undefined;
  }
  const remainderStart = skipHorizontalWhitespace(value, destinationEnd);
  if (remainderStart === value.length) {
    return { hasTitle: false };
  }
  const titleEnd = linkTitleEndWithoutLineEnding(value, remainderStart);
  return titleEnd !== undefined && skipHorizontalWhitespace(value, titleEnd) === value.length
    ? { hasTitle: true }
    : undefined;
}

function isLinkReferenceTitleLine(value: string): boolean {
  const titleStart = skipHorizontalWhitespace(value, 0);
  const titleEnd = linkTitleEndWithoutLineEnding(value, titleStart);
  return titleEnd !== undefined && skipHorizontalWhitespace(value, titleEnd) === value.length;
}

function findMultilineLinkReferenceDefinitions(
  lines: readonly string[]
): MultilineLinkReferenceDefinitions {
  const byStart = new Map<number, MultilineLinkReferenceDefinition>();
  const consumedLineIndexes = new Set<number>();
  for (let index = 0; index < lines.length; index += 1) {
    if (consumedLineIndexes.has(index)) {
      continue;
    }
    const match = emptyLinkReferenceDefinitionPattern.exec(lines[index] ?? "");
    const label = match === null ? undefined : normalizeLinkReferenceLabel(match[1] ?? "");
    if (label === undefined || label.length === 0) {
      continue;
    }
    const destinationIndex = index + 1;
    const destination = parseLinkReferenceContinuationLine(lines[destinationIndex] ?? "");
    if (destination === undefined) {
      continue;
    }
    const lineIndexes = [index, destinationIndex];
    if (!destination.hasTitle && isLinkReferenceTitleLine(lines[destinationIndex + 1] ?? "")) {
      lineIndexes.push(destinationIndex + 1);
    }
    const definition = { label, lineIndexes } satisfies MultilineLinkReferenceDefinition;
    byStart.set(index, definition);
    for (const lineIndex of lineIndexes) {
      consumedLineIndexes.add(lineIndex);
    }
  }
  return { byStart, consumedLineIndexes };
}

function visibleMarkdownLines(body: string): VisibleMarkdownDocument | undefined {
  const visible: string[] = [];
  const referenceLabels = new Set<string>();
  const rawLines = body.split(/\r?\n/u);
  const multilineReferenceDefinitions = findMultilineLinkReferenceDefinitions(rawLines);
  let fence: MarkdownFence | undefined;
  let htmlComment = false;
  const rawHtmlTags = new Map<string, number>();
  let rawHtmlTagFragment: string | undefined;
  let rawHtmlSpecialFragment: RawHtmlSpecialFragment | undefined;
  let linkReferenceContinuation = false;

  for (const [rawLineIndex, rawLine] of rawLines.entries()) {
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

    if (rawHtmlTagFragment !== undefined) {
      rawHtmlTagFragment += "\n" + visibleLine;
      if (rawHtmlTagFragment.length > maximumRawHtmlTagLength) {
        return undefined;
      }
      if (!rawHtmlTagFragment.includes(">")) {
        continue;
      }
      if (!rawHtmlBlockStartPattern.test(rawHtmlTagFragment)) {
        return undefined;
      }
      updateRawHtmlTags(rawHtmlTagFragment, rawHtmlTags);
      rawHtmlTagFragment = undefined;
      continue;
    }
    if (!visibleLine.includes(">") && rawHtmlTagFragmentStartPattern.test(visibleLine)) {
      rawHtmlTagFragment = visibleLine;
      continue;
    }
    if (rawHtmlTags.size > 0) {
      updateRawHtmlTags(visibleLine, rawHtmlTags);
      continue;
    }
    if (rawHtmlSpecialFragment !== undefined) {
      rawHtmlSpecialFragment.text += "\n" + visibleLine;
      if (rawHtmlSpecialFragment.text.length > maximumRawHtmlSpecialFragmentLength) {
        return undefined;
      }
      if (
        !rawHtmlSpecialFragmentIsClosed(rawHtmlSpecialFragment.text, rawHtmlSpecialFragment.kind)
      ) {
        continue;
      }
      rawHtmlSpecialFragment = undefined;
      continue;
    }
    const specialKind = rawHtmlSpecialFragmentKind(visibleLine);
    if (specialKind !== undefined) {
      if (visibleLine.length > maximumRawHtmlSpecialFragmentLength) {
        return undefined;
      }
      if (!rawHtmlSpecialFragmentIsClosed(visibleLine, specialKind)) {
        rawHtmlSpecialFragment = { kind: specialKind, text: visibleLine };
      }
      continue;
    }
    if (rawHtmlBlockStartPattern.test(visibleLine)) {
      updateRawHtmlTags(visibleLine, rawHtmlTags);
      continue;
    }

    if (multilineReferenceDefinitions.consumedLineIndexes.has(rawLineIndex)) {
      const definition = multilineReferenceDefinitions.byStart.get(rawLineIndex);
      if (definition !== undefined) {
        referenceLabels.add(definition.label);
      }
      continue;
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
      if (!indentedAtxHeadingPattern.test(visibleLine)) {
        continue;
      }
    }
    const referenceDefinition = linkReferenceDefinitionPattern.exec(visibleLine);
    if (referenceDefinition === null || (referenceDefinition[2] ?? "").length === 0) {
      linkReferenceContinuation = false;
      visible.push(visibleLine);
    } else {
      const label = normalizeLinkReferenceLabel(referenceDefinition[1] ?? "");
      if (label.length > 0) {
        referenceLabels.add(label);
      }
      linkReferenceContinuation = true;
    }
  }

  return htmlComment ||
    rawHtmlTagFragment !== undefined ||
    rawHtmlSpecialFragment !== undefined ||
    rawHtmlTags.size > 0
    ? undefined
    : { lines: visible, referenceLabels };
}

interface MarkdownHeading {
  readonly level: number;
  readonly text: string;
}

const headingPattern = /^\s{0,3}(#{1,6})(?:[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*|[ \t]*)$/u;
const visibleMarkdownTextPattern =
  /[^\p{White_Space}\p{Control}\p{Format}\p{Mark}\p{Default_Ignorable_Code_Point}]/u;
const indentedCodePattern = /^(?: {4}|\t)/u;
const emptyReferenceMarkdownLinkPattern =
  /!?\[[\p{White_Space}\p{Control}\p{Format}\p{Mark}\p{Default_Ignorable_Code_Point}]+\]\[[^\]]{0,999}\]/gu;
const emptyResolvedReferenceMarkdownLinkPattern = /!?\[\]\[([^\]\r\n]{1,999})\]/gu;
const markdownWhitespacePattern = /\s/u;

interface MarkdownScanBudget {
  remaining: number;
  exhausted: boolean;
}

function createMarkdownScanBudget(length: number): MarkdownScanBudget {
  return {
    remaining: Math.min(Number.MAX_SAFE_INTEGER, length * 8 + 256),
    exhausted: false
  };
}

function consumeMarkdownScanBudget(budget: MarkdownScanBudget | undefined, amount = 1): boolean {
  if (budget === undefined) {
    return true;
  }
  if (
    budget.exhausted ||
    !Number.isSafeInteger(amount) ||
    amount < 0 ||
    budget.remaining < amount
  ) {
    budget.exhausted = true;
    return false;
  }
  budget.remaining -= amount;
  return true;
}

function invisibleMarkdownCharacterLength(value: string, index: number): number {
  const codePoint = value.codePointAt(index);
  if (codePoint === undefined) {
    return 0;
  }
  const character = String.fromCodePoint(codePoint);
  return markdownWhitespacePattern.test(character) || isInvisibleCodePoint(codePoint)
    ? character.length
    : 0;
}

function skipLinkWhitespace(
  value: string,
  start: number,
  budget?: MarkdownScanBudget
): number | undefined {
  let index = start;
  let lineEndingSeen = false;
  while (index < value.length) {
    const character = value[index];
    if (character === " " || character === "\t") {
      if (!consumeMarkdownScanBudget(budget)) {
        return undefined;
      }
      index += 1;
      continue;
    }
    if (character !== "\r" && character !== "\n") {
      break;
    }
    if (lineEndingSeen || !consumeMarkdownScanBudget(budget)) {
      return undefined;
    }
    lineEndingSeen = true;
    index += 1;
    if (character === "\r" && value[index] === "\n") {
      if (!consumeMarkdownScanBudget(budget)) {
        return undefined;
      }
      index += 1;
    }
  }
  return index;
}

function quotedLinkTitleEnd(
  value: string,
  start: number,
  quote: string,
  budget?: MarkdownScanBudget
): number | undefined {
  for (let index = start + 1; index < value.length; index += 1) {
    if (!consumeMarkdownScanBudget(budget)) {
      return undefined;
    }
    const character = value[index];
    if (character === "\r" || character === "\n") {
      return undefined;
    }
    if (character === "\\") {
      if (index + 1 >= value.length) {
        return undefined;
      }
      if (value[index + 1] === "\r" || value[index + 1] === "\n") {
        return undefined;
      }
      index += 1;
      continue;
    }
    if (character === quote) {
      return index + 1;
    }
  }
  return undefined;
}

function parenthesizedLinkTitleEnd(
  value: string,
  start: number,
  budget?: MarkdownScanBudget
): number | undefined {
  let depth = 0;
  for (let index = start; index < value.length; index += 1) {
    if (!consumeMarkdownScanBudget(budget)) {
      return undefined;
    }
    const character = value[index];
    if (character === "\r" || character === "\n") {
      return undefined;
    }
    if (character === "\\") {
      if (index + 1 >= value.length) {
        return undefined;
      }
      if (value[index + 1] === "\r" || value[index + 1] === "\n") {
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

function linkEndAfterWhitespace(
  value: string,
  start: number,
  budget?: MarkdownScanBudget
): number | undefined {
  const index = skipLinkWhitespace(value, start, budget);
  if (index === undefined) {
    return undefined;
  }
  if (value[index] === ")") {
    return index + 1;
  }
  const titleQuote = value[index];
  let titleEnd: number | undefined;
  if (titleQuote === '"') {
    titleEnd = quotedLinkTitleEnd(value, index, '"', budget);
  } else if (titleQuote === "'") {
    titleEnd = quotedLinkTitleEnd(value, index, "'", budget);
  } else if (titleQuote === "(") {
    titleEnd = parenthesizedLinkTitleEnd(value, index, budget);
  }
  if (titleEnd === undefined) {
    return undefined;
  }
  const closing = skipLinkWhitespace(value, titleEnd, budget);
  if (closing === undefined) {
    return undefined;
  }
  return value[closing] === ")" ? closing + 1 : undefined;
}

function emptyInlineLinkEnd(
  value: string,
  openIndex: number,
  budget?: MarkdownScanBudget
): number | undefined {
  let index = openIndex + 1;
  const contentStart = skipLinkWhitespace(value, index, budget);
  if (contentStart === undefined) {
    return undefined;
  }
  if (value[contentStart] === ")") {
    return contentStart + 1;
  }
  index = contentStart;
  if (value[index] === "<") {
    const angleStart = index + 1;
    for (index = angleStart; index < value.length; index += 1) {
      if (!consumeMarkdownScanBudget(budget)) {
        return undefined;
      }
      const character = value[index];
      if (character === "\r" || character === "\n") {
        return undefined;
      }
      if (character === "\\") {
        if (index + 1 >= value.length) {
          return undefined;
        }
        if (value[index + 1] === "\r" || value[index + 1] === "\n") {
          return undefined;
        }
        index += 1;
        continue;
      }
      if (character === "<") {
        return undefined;
      }
      if (character === ">") {
        return linkEndAfterWhitespace(value, index + 1, budget);
      }
    }
    return undefined;
  }

  let depth = 0;
  for (; index < value.length; index += 1) {
    if (!consumeMarkdownScanBudget(budget)) {
      return undefined;
    }
    const character = value[index];
    if (character === undefined) {
      return undefined;
    }
    if (character === "\r" || character === "\n") {
      return depth === 0 ? linkEndAfterWhitespace(value, index, budget) : undefined;
    }
    if (character === "\\") {
      if (index + 1 >= value.length) {
        return undefined;
      }
      if (value[index + 1] === "\r" || value[index + 1] === "\n") {
        return undefined;
      }
      index += 1;
      continue;
    }
    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      if (depth === 0) {
        return index + 1;
      }
      depth -= 1;
    } else if (markdownWhitespacePattern.test(character)) {
      return depth === 0 ? linkEndAfterWhitespace(value, index, budget) : undefined;
    }
  }
  return undefined;
}

function stripEmptyInlineMarkdownLinks(value: string): string {
  const budget = createMarkdownScanBudget(value.length);
  const pieces: string[] = [];
  let cursor = 0;
  let index = 0;
  while (index < value.length) {
    if (!consumeMarkdownScanBudget(budget)) {
      return value;
    }
    const image = value[index] === "!" && value[index + 1] === "[";
    const opening = image ? index + 1 : value[index] === "[" ? index : -1;
    if (opening < 0) {
      index += 1;
      continue;
    }

    let labelEnd = opening + 1;
    while (labelEnd < value.length) {
      const invisibleLength = invisibleMarkdownCharacterLength(value, labelEnd);
      if (invisibleLength === 0) {
        break;
      }
      if (!consumeMarkdownScanBudget(budget)) {
        return value;
      }
      labelEnd += invisibleLength;
    }
    if (value[labelEnd] !== "]" || value[labelEnd + 1] !== "(") {
      index = opening + 1;
      continue;
    }

    const end = emptyInlineLinkEnd(value, labelEnd + 1, budget);
    if (end === undefined) {
      if (budget.exhausted) {
        return value;
      }
      break;
    }
    pieces.push(value.slice(cursor, image ? opening - 1 : opening));
    cursor = end;
    index = end;
  }
  pieces.push(value.slice(cursor));
  return pieces.join("");
}

function stripEmptyReferenceMarkdownLinks(
  value: string,
  referenceLabels?: ReadonlySet<string>
): string {
  const withoutInvisibleLabels = value.replace(emptyReferenceMarkdownLinkPattern, "");
  if (referenceLabels === undefined || referenceLabels.size === 0) {
    return withoutInvisibleLabels;
  }
  return withoutInvisibleLabels.replace(
    emptyResolvedReferenceMarkdownLinkPattern,
    (marker, label: string) =>
      referenceLabels.has(normalizeLinkReferenceLabel(label)) ? "" : marker
  );
}

function inlineCodeSpanEnd(
  value: string,
  start: number,
  markerLength: number,
  budget?: MarkdownScanBudget
): number | undefined {
  for (let index = start + markerLength; index < value.length; index += 1) {
    if (!consumeMarkdownScanBudget(budget)) {
      return undefined;
    }
    if (value[index] !== "`") {
      continue;
    }
    let runLength = 0;
    while (value[index + runLength] === "`") {
      if (!consumeMarkdownScanBudget(budget)) {
        return undefined;
      }
      runLength += 1;
    }
    if (runLength === markerLength) {
      return index + runLength;
    }
    index += runLength - 1;
  }
  return undefined;
}

function maskMarkdownLiteralContextsFromRawHtmlScan(value: string): string {
  const masked = value.split("");
  const budget = createMarkdownScanBudget(value.length);
  const openingBrackets: Array<{
    containsNestedLink: boolean;
    isImage: boolean;
  }> = [];
  let escaped = false;
  let previousWasUnescapedExclamation = false;
  let index = 0;
  while (index < value.length) {
    if (!consumeMarkdownScanBudget(budget)) {
      return masked.join("");
    }
    const character = value[index];
    if (escaped) {
      if (character === "<") {
        masked[index] = " ";
      }
      escaped = false;
      previousWasUnescapedExclamation = false;
      index += 1;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      previousWasUnescapedExclamation = false;
      index += 1;
      continue;
    }

    if (character === "`") {
      previousWasUnescapedExclamation = false;
      let markerLength = 1;
      while (value[index + markerLength] === "`" && consumeMarkdownScanBudget(budget)) {
        markerLength += 1;
      }
      const end = inlineCodeSpanEnd(value, index, markerLength, budget);
      if (end !== undefined) {
        for (let cursor = index; cursor < end; cursor += 1) {
          masked[cursor] = " ";
        }
        index = end;
        continue;
      }
      index += markerLength;
      continue;
    }

    if (character === "[") {
      openingBrackets.push({
        containsNestedLink: false,
        isImage: previousWasUnescapedExclamation
      });
      previousWasUnescapedExclamation = false;
      index += 1;
      continue;
    }
    if (character !== "]") {
      previousWasUnescapedExclamation = character === "!";
      index += 1;
      continue;
    }
    if (openingBrackets.length === 0) {
      previousWasUnescapedExclamation = false;
      index += 1;
      continue;
    }

    previousWasUnescapedExclamation = false;
    const bracket = openingBrackets.pop();
    const containsNestedLink = bracket?.containsNestedLink ?? false;
    const isImage = bracket?.isImage ?? false;
    const openParenthesis = index + 1;
    let end: number | undefined;
    if (value[openParenthesis] === "(") {
      const contentStart =
        skipLinkWhitespace(value, openParenthesis + 1, budget) ?? openParenthesis + 1;
      end = emptyInlineLinkEnd(value, openParenthesis, budget);
      const parent = openingBrackets[openingBrackets.length - 1];
      if (parent !== undefined && (containsNestedLink || (end !== undefined && !isImage))) {
        parent.containsNestedLink = true;
      }
      if (end !== undefined && !containsNestedLink && (parent === undefined || isImage)) {
        for (let cursor = contentStart; cursor < end; cursor += 1) {
          masked[cursor] = " ";
        }
        index = end;
        continue;
      }
    }
    if (containsNestedLink) {
      const parent = openingBrackets[openingBrackets.length - 1];
      if (parent !== undefined) {
        parent.containsNestedLink = true;
      }
    }
    if (budget.exhausted) {
      return masked.join("");
    }

    index += 1;
  }
  return masked.join("");
}

function markdownHeading(line: string): MarkdownHeading | undefined {
  const match = headingPattern.exec(line);
  const marker = match?.[1];
  const text = match?.[2]?.trim() ?? "";
  if (marker === undefined) {
    return undefined;
  }
  return {
    level: marker.length,
    text
  };
}

function hasVisibleMarkdownText(line: string, referenceLabels?: ReadonlySet<string>): boolean {
  if (indentedCodePattern.test(line)) {
    return false;
  }
  const withoutInvisibleEntities = stripInvisibleHtmlEntities(line);
  if (hasRawHtmlPresence(maskMarkdownLiteralContextsFromRawHtmlScan(withoutInvisibleEntities))) {
    return false;
  }
  const withoutEmptyMarkdownMarkers = stripEmptyInlineMarkdownLinks(withoutInvisibleEntities);
  const withoutEmptyReferenceMarkdownLinks = stripEmptyReferenceMarkdownLinks(
    withoutEmptyMarkdownMarkers,
    referenceLabels
  );
  return visibleMarkdownTextPattern.test(withoutEmptyReferenceMarkdownLinks);
}

function hasNonEmptySection(body: string, wantedHeading: string): boolean {
  const document = visibleMarkdownLines(body);
  if (document === undefined) {
    return false;
  }
  const lines = document.lines;

  const wanted = wantedHeading.toLocaleLowerCase("en-US");
  for (let index = 0; index < lines.length; index += 1) {
    const heading = markdownHeading(lines[index] ?? "");
    if (heading?.text.toLocaleLowerCase("en-US") !== wanted) {
      continue;
    }

    const contentLines: string[] = [];
    for (let contentIndex = index + 1; contentIndex < lines.length; contentIndex += 1) {
      const line = lines[contentIndex] ?? "";
      const nestedHeading = markdownHeading(line);
      if (nestedHeading !== undefined) {
        if (nestedHeading.level <= heading.level) {
          break;
        }
        continue;
      }
      contentLines.push(line);
    }
    const withoutMultilineEmptyMarkers = stripEmptyInlineMarkdownLinks(contentLines.join("\n"));
    const withoutEmptyReferenceMarkdownLinks = stripEmptyReferenceMarkdownLinks(
      withoutMultilineEmptyMarkers,
      document.referenceLabels
    );
    if (
      hasRawHtmlPresence(
        maskMarkdownLiteralContextsFromRawHtmlScan(
          stripInvisibleHtmlEntities(withoutEmptyReferenceMarkdownLinks)
        )
      )
    ) {
      continue;
    }
    if (
      withoutEmptyReferenceMarkdownLinks
        .split("\n")
        .some((line) => hasVisibleMarkdownText(line, document.referenceLabels))
    ) {
      return true;
    }
  }
  return false;
}

function hasAttestation(body: string, wantedText: string): boolean {
  const document = visibleMarkdownLines(body);
  if (document === undefined) {
    return false;
  }
  const lines = document.lines;

  return lines.some((line) => {
    const match = /^[ \t]{0,3}[-*+][ \t]+\[[xX]\][ \t]+(.+?)[ \t]*$/u.exec(line);
    return (
      match?.[1]?.trim() === wantedText &&
      hasVisibleMarkdownText(match[1], document.referenceLabels)
    );
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
