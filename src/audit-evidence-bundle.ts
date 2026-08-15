import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";

import {
  AUDIT_BUNDLE_DIGEST_DOMAIN,
  AUDIT_REPORT_DIGEST_DOMAIN,
  AUDIT_SNAPSHOT_DIGEST_DOMAIN,
  canonicalizeAuditEvidenceJsonValue,
  canonicalizeJsonValue,
  hashAuditEvidenceDomain,
  type JsonValue
} from "./audit-evidence.js";
import { auditRepository, type AuditReport, type AuditSnapshot } from "./audit.js";
import { parsePolicy } from "./policy.js";

export const MAX_AUDIT_EVIDENCE_SOURCE_BYTES = 262_144;
export const MAX_AUDIT_EVIDENCE_BASE64URL_CHARS =
  Math.floor(MAX_AUDIT_EVIDENCE_SOURCE_BYTES / 3) * 4 +
  (MAX_AUDIT_EVIDENCE_SOURCE_BYTES % 3 === 0 ? 0 : (MAX_AUDIT_EVIDENCE_SOURCE_BYTES % 3) + 1);
export const MAX_AUDIT_EVIDENCE_WORKFLOWS = 100;
export const MAX_AUDIT_EVIDENCE_RULESETS = 100;
export const MAX_AUDIT_EVIDENCE_FINDINGS = 500;

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const BASE64_VALUE = new Map(
  Array.from(BASE64_ALPHABET).map((character, index) => [character, index])
);
const UTF8 = new TextEncoder();
const SHA1 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
// eslint-disable-next-line no-control-regex
const BOUNDED_TEXT = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\p{Cf}\p{Cs}]/u;
const PATH =
  /^(?!\/)(?![A-Za-z]:)(?!.*\\)(?!.*\/\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))[^/]+(?:\/[^/]+)*$/u;
const WORKFLOW =
  /^[.][gG][iI][tT][hH][uU][bB]\/[wW][oO][rR][kK][fF][lL][oO][wW][sS]\/[^/]+\.(?:[yY][mM][lL]|[yY][aA][mM][lL])$/u;
const OBSERVED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const CHECKED_ORDER = [
  "base-revision",
  "branch-protection",
  "rulesets",
  "tag-protection",
  "workflows"
] as const;
const BUNDLE_BOUNDS: Readonly<Record<string, number>> = {
  bundleBytes: 8_388_608,
  aggregateSourceBytes: 4_194_304,
  sourceFileBytes: 262_144,
  workflows: 100,
  rulesets: 100,
  findings: 500,
  requestAttempts: 768,
  pagesPerCollection: 10,
  itemsPerPage: 100,
  responseBytes: 2_097_152,
  retriesPerRequest: 1,
  deadlineMs: 120_000,
  concurrency: 4,
  jsonDepth: 32,
  jsonObjectMembers: 20_000,
  jsonArrayElements: 20_000,
  jsonTokens: 100_000,
  jsonStringBytes: 6_291_456,
  jsonNumberChars: 32
};

export class AuditEvidenceBundleError extends Error {
  public constructor(
    public readonly code: string,
    message = code
  ) {
    super(message);
    this.name = "AuditEvidenceBundleError";
  }
}

function fail(code: string, message = code): never {
  throw new AuditEvidenceBundleError(code, message);
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !isProxy(value);
}

function boundedText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Array.from(value).length >= 1 &&
    Array.from(value).length <= 512 &&
    !BOUNDED_TEXT.test(value)
  );
}

function repositoryPath(value: unknown): value is string {
  return boundedText(value) && PATH.test(value);
}

function workflowPath(value: unknown): value is string {
  return repositoryPath(value) && WORKFLOW.test(value);
}

function requiredString(record: Record<string, JsonValue>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    fail("artifact-shape");
  }
  return value;
}

function requiredNumber(record: Record<string, JsonValue>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    fail("artifact-shape");
  }
  return value;
}

function hasExactKeys(record: Record<string, JsonValue>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return (
    Object.keys(record).length === keys.length &&
    Object.keys(record).every((key) => allowed.has(key))
  );
}

function requiredRecord(value: unknown, code: string): Record<string, JsonValue> {
  if (!isRecord(value)) {
    fail(code);
  }
  return value;
}

function requiredText(value: unknown, code: string): string {
  if (typeof value !== "string") {
    fail(code);
  }
  return value;
}

function requiredBoolean(value: unknown, code: string): boolean {
  if (typeof value !== "boolean") {
    fail(code);
  }
  return value;
}

function requiredSafeInteger(value: unknown, code: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || Object.is(value, -0)) {
    fail(code);
  }
  return value;
}

function requiredArray(value: unknown, code: string): JsonValue[] {
  if (!Array.isArray(value)) {
    fail(code);
  }
  const result: JsonValue[] = [];
  for (const item of value as readonly unknown[]) {
    result.push(item as JsonValue);
  }
  return result;
}

function requiredSha(value: unknown, pattern: RegExp, code: string): string {
  const text = requiredText(value, code);
  if (!pattern.test(text)) {
    fail(code);
  }
  return text;
}

function assertClosed(
  record: Record<string, JsonValue>,
  keys: readonly string[],
  code: string
): void {
  if (!hasExactKeys(record, keys)) {
    fail(code);
  }
}

function assertCheck(value: JsonValue): void {
  const check = requiredRecord(value, "bundle-check");
  const keys = Object.keys(check);
  if (
    !keys.every((key) => key === "name" || key === "appId" || key === "appSlug") ||
    !hasOwn(check, "name")
  ) {
    fail("bundle-check");
  }
  if (!boundedText(check.name)) {
    fail("bundle-check");
  }
  const hasAppId = hasOwn(check, "appId");
  const hasAppSlug = hasOwn(check, "appSlug");
  if (hasAppId === hasAppSlug) {
    if (hasAppId) {
      fail("bundle-check");
    }
  } else if (hasAppId) {
    const appId = check.appId;
    if (
      typeof appId !== "number" ||
      !Number.isSafeInteger(appId) ||
      appId < 1 ||
      appId > 2_147_483_647
    ) {
      fail("bundle-check");
    }
  } else if (
    typeof check.appSlug !== "string" ||
    !boundedText(check.appSlug) ||
    !/^[a-z0-9][a-z0-9-]*$/u.test(check.appSlug)
  ) {
    fail("bundle-check");
  }
}

export function decodeAuditEvidenceBase64url(value: unknown): Uint8Array {
  if (
    typeof value !== "string" ||
    value.length > MAX_AUDIT_EVIDENCE_BASE64URL_CHARS ||
    value.length % 4 === 1 ||
    !/^(?:[A-Za-z0-9_-]{4})*(?:(?:[A-Za-z0-9_-][AQgw])|(?:[A-Za-z0-9_-]{2}[AEIMQUYcgkosw048]))?$/u.test(
      value
    )
  ) {
    fail("artifact-base64");
  }
  const decoded = new Uint8Array(Math.floor((value.length * 6) / 8));
  let accumulator = 0;
  let bits = 0;
  let offset = 0;
  for (const character of value) {
    const digit = BASE64_VALUE.get(character);
    if (digit === undefined) {
      fail("artifact-base64");
    }
    accumulator = ((accumulator << 6) | digit) & 0x3fff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      decoded[offset] = (accumulator >> bits) & 0xff;
      offset += 1;
    }
  }
  if (bits > 0 && (accumulator & ((1 << bits) - 1)) !== 0) {
    fail("artifact-base64");
  }
  return decoded;
}

export function encodeAuditEvidenceBase64url(value: Uint8Array): string {
  if (!(value instanceof Uint8Array) || value.byteLength > MAX_AUDIT_EVIDENCE_SOURCE_BYTES) {
    fail("artifact-bytes");
  }
  let result = "";
  for (let index = 0; index < value.byteLength; index += 3) {
    const first = value[index] ?? 0;
    const second = value[index + 1];
    const third = value[index + 2];
    result += BASE64_ALPHABET.charAt(first >> 2);
    result += BASE64_ALPHABET.charAt(((first & 0x03) << 4) | ((second ?? 0) >> 4));
    if (second !== undefined) {
      result += BASE64_ALPHABET.charAt(((second & 0x0f) << 2) | ((third ?? 0) >> 6));
    }
    if (third !== undefined) {
      result += BASE64_ALPHABET.charAt(third & 0x3f);
    }
  }
  return result;
}

export function sha256AuditEvidenceBytes(value: Uint8Array): string {
  if (!(value instanceof Uint8Array) || value.byteLength > MAX_AUDIT_EVIDENCE_SOURCE_BYTES) {
    fail("artifact-bytes");
  }
  return createHash("sha256").update(value).digest("hex");
}

export interface VerifiedAuditEvidenceSource {
  readonly bytes: Uint8Array;
  readonly text: string;
}

export function verifyAuditEvidenceSourceArtifact(
  value: unknown,
  kind: "policy" | "workflow"
): VerifiedAuditEvidenceSource {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["path", "revisionSha", "sha256", "byteLength", "contentBase64url"])
  ) {
    fail("artifact-shape");
  }
  const path = requiredString(value, "path");
  if (!(kind === "workflow" ? workflowPath(path) : repositoryPath(path))) {
    fail("artifact-path");
  }
  const revisionSha = requiredString(value, "revisionSha");
  const sha256 = requiredString(value, "sha256");
  if (!SHA1.test(revisionSha) || !SHA256.test(sha256)) {
    fail("artifact-hash");
  }
  const byteLength = requiredNumber(value, "byteLength");
  if (byteLength < 0 || byteLength > MAX_AUDIT_EVIDENCE_SOURCE_BYTES) {
    fail("artifact-length");
  }
  const contentBase64url = requiredString(value, "contentBase64url");
  const bytes = decodeAuditEvidenceBase64url(contentBase64url);
  if (encodeAuditEvidenceBase64url(bytes) !== contentBase64url) {
    fail("artifact-base64");
  }
  if (bytes.byteLength !== byteLength) {
    fail("artifact-length");
  }
  if (sha256AuditEvidenceBytes(bytes) !== sha256) {
    fail("artifact-hash");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    fail("artifact-utf8");
  }
  return { bytes, text };
}

function compareUtf16(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) {
      return difference;
    }
  }
  return left.length - right.length;
}

function cloneJson(value: unknown): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      fail("bundle-number");
    }
    return value;
  }
  if (typeof value !== "object" || isProxy(value)) {
    fail("bundle-value");
  }
  if (Array.isArray(value)) {
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== value.length + 1 ||
      keys.some((key) => key !== "length" && typeof key !== "string")
    ) {
      fail("bundle-array");
    }
    const result: JsonValue[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !("value" in descriptor)) {
        fail("bundle-array");
      }
      result.push(cloneJson(descriptor.value));
    }
    return result;
  }
  if (!isRecord(value)) {
    fail("bundle-object");
  }
  const result = Object.create(null) as Record<string, JsonValue>;
  const keys = Reflect.ownKeys(value);
  for (const key of keys) {
    if (typeof key !== "string") {
      fail("bundle-object");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      fail("bundle-object");
    }
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      value: cloneJson(descriptor.value),
      writable: true
    });
  }
  return result;
}

export interface AuditEvidenceIntegrityValues {
  readonly algorithm: "sha256";
  readonly snapshotSha256: string;
  readonly reportSha256: string;
  readonly payloadSha256: string;
}

function hashCanonicalEvidenceValue(domain: string, value: JsonValue): string {
  return hashAuditEvidenceDomain(domain, UTF8.encode(canonicalizeAuditEvidenceJsonValue(value)));
}

export function computeAuditEvidenceIntegrity(value: unknown): AuditEvidenceIntegrityValues {
  canonicalizeAuditEvidenceJsonValue(value);
  const bundle = requiredRecord(value, "bundle-shape");
  const snapshot = requiredRecord(bundle.snapshot, "bundle-snapshot");
  const report = requiredRecord(bundle.report, "bundle-report");
  const payload = cloneJson(value);
  if (!isRecord(payload) || !hasOwn(payload, "integrity")) {
    fail("bundle-integrity");
  }
  delete (payload as Record<string, JsonValue>).integrity;
  return {
    algorithm: "sha256",
    snapshotSha256: hashCanonicalEvidenceValue(AUDIT_SNAPSHOT_DIGEST_DOMAIN, snapshot),
    reportSha256: hashCanonicalEvidenceValue(AUDIT_REPORT_DIGEST_DOMAIN, report),
    payloadSha256: hashCanonicalEvidenceValue(AUDIT_BUNDLE_DIGEST_DOMAIN, payload)
  };
}

function recordAt(value: JsonValue, key: string): Record<string, JsonValue> | undefined {
  return isRecord(value) && isRecord(value[key]) ? value[key] : undefined;
}

function hasOwn(record: Record<string, JsonValue>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function normalizeStrings(value: JsonValue, code: string): JsonValue[] {
  if (!Array.isArray(value)) {
    fail(code);
  }
  const result = value.map((item) => {
    if (typeof item !== "string") {
      fail(code);
    }
    return item;
  });
  result.sort(compareUtf16);
  for (let index = 1; index < result.length; index += 1) {
    if (result[index] === result[index - 1]) {
      fail("bundle-array-duplicate");
    }
  }
  return result;
}

export function compareAuditEvidenceChecks(left: JsonValue, right: JsonValue): number {
  if (!isRecord(left) || !isRecord(right)) {
    fail("bundle-check");
  }
  const leftName = left.name;
  const rightName = right.name;
  if (typeof leftName !== "string" || typeof rightName !== "string") {
    fail("bundle-check");
  }
  const nameOrder = compareUtf16(leftName, rightName);
  if (nameOrder !== 0) {
    return nameOrder;
  }
  const leftAppId = left.appId;
  const rightAppId = right.appId;
  const leftSlug = left.appSlug;
  const rightSlug = right.appSlug;
  const leftKind = leftAppId !== undefined ? 1 : leftSlug !== undefined ? 2 : 0;
  const rightKind = rightAppId !== undefined ? 1 : rightSlug !== undefined ? 2 : 0;
  if (leftKind !== rightKind) {
    return leftKind - rightKind;
  }
  if (leftKind === 1) {
    if (typeof leftAppId !== "number" || typeof rightAppId !== "number") {
      fail("bundle-check");
    }
    return leftAppId - rightAppId;
  }
  if (leftKind === 2) {
    if (typeof leftSlug !== "string" || typeof rightSlug !== "string") {
      fail("bundle-check");
    }
    return compareUtf16(leftSlug, rightSlug);
  }
  return 0;
}

function normalizeChecks(value: JsonValue): JsonValue[] {
  if (!Array.isArray(value)) {
    fail("bundle-check");
  }
  const result = [...value];
  for (const item of result) {
    assertCheck(item);
  }
  result.sort(compareAuditEvidenceChecks);
  for (let index = 1; index < result.length; index += 1) {
    if (
      compareAuditEvidenceChecks(result[index - 1] as JsonValue, result[index] as JsonValue) === 0
    ) {
      fail("bundle-array-duplicate");
    }
  }
  return result;
}

function normalizeBypassSummaries(value: JsonValue): JsonValue[] {
  if (!Array.isArray(value)) {
    fail("bundle-bypass");
  }
  let total = 0;
  const result = [...value];
  for (const item of result) {
    if (!isRecord(item)) {
      fail("bundle-bypass");
    }
    const actorType = item.actorType;
    const bypassMode = item.bypassMode;
    const count = item.count;
    if (
      typeof actorType !== "string" ||
      typeof bypassMode !== "string" ||
      typeof count !== "number" ||
      !Number.isSafeInteger(count) ||
      count < 1 ||
      count > 100
    ) {
      fail("bundle-bypass");
    }
    if ((actorType === "deploy_key" || actorType === "organization_admin") && count !== 1) {
      fail("bundle-bypass-singleton");
    }
    total += count;
    if (total > 100) {
      fail("bundle-bypass-count");
    }
  }
  result.sort((left, right) => {
    if (!isRecord(left) || !isRecord(right)) {
      fail("bundle-bypass");
    }
    const leftActorType = left.actorType;
    const rightActorType = right.actorType;
    const leftBypassMode = left.bypassMode;
    const rightBypassMode = right.bypassMode;
    if (
      typeof leftActorType !== "string" ||
      typeof rightActorType !== "string" ||
      typeof leftBypassMode !== "string" ||
      typeof rightBypassMode !== "string"
    ) {
      fail("bundle-bypass");
    }
    const actorOrder = compareUtf16(leftActorType, rightActorType);
    return actorOrder || compareUtf16(leftBypassMode, rightBypassMode);
  });
  for (let index = 1; index < result.length; index += 1) {
    const previous = result[index - 1];
    const current = result[index];
    if (!isRecord(previous) || !isRecord(current)) {
      fail("bundle-bypass");
    }
    if (previous.actorType === current.actorType && previous.bypassMode === current.bypassMode) {
      fail("bundle-array-duplicate");
    }
  }
  return result;
}

function normalizeBranchBypassSummaries(value: JsonValue): JsonValue[] {
  if (!Array.isArray(value)) {
    fail("bundle-bypass");
  }
  let total = 0;
  const result = [...value];
  for (const item of result) {
    if (!isRecord(item) || typeof item.actorType !== "string") {
      fail("bundle-bypass");
    }
    const count = item.count;
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 1 || count > 100) {
      fail("bundle-bypass");
    }
    total += count;
    if (total > 100) {
      fail("bundle-bypass-count");
    }
  }
  result.sort((left, right) => {
    if (!isRecord(left) || !isRecord(right)) {
      fail("bundle-bypass");
    }
    const leftActorType = left.actorType;
    const rightActorType = right.actorType;
    if (typeof leftActorType !== "string" || typeof rightActorType !== "string") {
      fail("bundle-bypass");
    }
    return compareUtf16(leftActorType, rightActorType);
  });
  for (let index = 1; index < result.length; index += 1) {
    const previous = result[index - 1];
    const current = result[index];
    if (!isRecord(previous) || !isRecord(current)) {
      fail("bundle-bypass");
    }
    if (previous.actorType === current.actorType) {
      fail("bundle-array-duplicate");
    }
  }
  return result;
}

const REPORT_CATEGORIES = [
  "completeness",
  "integrity",
  "configuration",
  "provenance",
  "workflow"
] as const;
const REPORT_SEVERITIES = ["error", "warning"] as const;

function reportText(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    Array.from(value).length < 1 ||
    Array.from(value).length > maximum
  ) {
    fail("bundle-report-finding");
  }
  return value;
}

function assertReportFinding(value: JsonValue): void {
  const finding = requiredRecord(value, "bundle-report-finding");
  const allowed = new Set(["code", "category", "severity", "path", "line", "message"]);
  if (
    !Object.keys(finding).every((key) => allowed.has(key)) ||
    !hasOwn(finding, "code") ||
    !hasOwn(finding, "category") ||
    !hasOwn(finding, "severity") ||
    !hasOwn(finding, "message")
  ) {
    fail("bundle-report-finding");
  }
  reportText(finding.code, 128);
  reportText(finding.message, 1024);
  if (
    typeof finding.category !== "string" ||
    !REPORT_CATEGORIES.includes(finding.category as (typeof REPORT_CATEGORIES)[number])
  ) {
    fail("bundle-report-finding");
  }
  if (
    typeof finding.severity !== "string" ||
    !REPORT_SEVERITIES.includes(finding.severity as (typeof REPORT_SEVERITIES)[number])
  ) {
    fail("bundle-report-finding");
  }
  if (hasOwn(finding, "path")) {
    reportText(finding.path, 1024);
  }
  if (hasOwn(finding, "line")) {
    const line = requiredSafeInteger(finding.line, "bundle-report-finding");
    if (line < 1 || line > 1_000_000) {
      fail("bundle-report-finding");
    }
  }
}

function compareFindings(left: JsonValue, right: JsonValue): number {
  const leftFinding = requiredRecord(left, "bundle-report-finding");
  const rightFinding = requiredRecord(right, "bundle-report-finding");
  const leftText = (key: string): string =>
    typeof leftFinding[key] === "string" ? leftFinding[key] : "";
  const rightText = (key: string): string =>
    typeof rightFinding[key] === "string" ? rightFinding[key] : "";
  const leftLine =
    typeof leftFinding.line === "number" && Number.isSafeInteger(leftFinding.line)
      ? leftFinding.line
      : 0;
  const rightLine =
    typeof rightFinding.line === "number" && Number.isSafeInteger(rightFinding.line)
      ? rightFinding.line
      : 0;
  return (
    compareUtf16(leftText("code"), rightText("code")) ||
    compareUtf16(leftText("path"), rightText("path")) ||
    leftLine - rightLine ||
    compareUtf16(leftText("severity"), rightText("severity")) ||
    compareUtf16(leftText("message"), rightText("message")) ||
    compareUtf16(leftText("category"), rightText("category"))
  );
}

function normalizeFindings(value: JsonValue): JsonValue[] {
  if (!Array.isArray(value)) {
    fail("bundle-findings");
  }
  if (value.length > MAX_AUDIT_EVIDENCE_FINDINGS) {
    fail("bundle-findings-limit");
  }
  const result = [...value];
  for (const finding of result) {
    assertReportFinding(finding);
  }
  result.sort(compareFindings);
  return result;
}

function normalizeRulesets(value: JsonValue): JsonValue[] {
  if (!Array.isArray(value)) {
    fail("bundle-rulesets");
  }
  if (value.length > MAX_AUDIT_EVIDENCE_RULESETS) {
    fail("bundle-rulesets-limit");
  }
  const result = [...value];
  for (const item of result) {
    if (!isRecord(item)) {
      fail("bundle-ruleset");
    }
    const ruleset = item as Record<string, JsonValue>;
    if (typeof ruleset.id !== "number" || !Number.isSafeInteger(ruleset.id) || ruleset.id < 1) {
      fail("bundle-ruleset");
    }
    for (const key of ["refPatterns", "repositoryPatterns"] as const) {
      if (hasOwn(ruleset, key)) {
        ruleset[key] = normalizeStrings(ruleset[key] as JsonValue, "bundle-patterns");
      }
    }
    if (hasOwn(ruleset, "requiredChecks")) {
      ruleset.requiredChecks = normalizeChecks(ruleset.requiredChecks as JsonValue);
    }
    if (hasOwn(ruleset, "bypassActorSummaries")) {
      ruleset.bypassActorSummaries = normalizeBypassSummaries(
        ruleset.bypassActorSummaries as JsonValue
      );
    }
  }
  result.sort((left, right) => {
    if (!isRecord(left) || !isRecord(right)) {
      fail("bundle-ruleset");
    }
    return Number(left.id) - Number(right.id);
  });
  for (let index = 1; index < result.length; index += 1) {
    const previous = result[index - 1];
    const current = result[index];
    if (!isRecord(previous) || !isRecord(current)) {
      fail("bundle-ruleset");
    }
    if (previous.id === current.id) {
      fail("bundle-duplicate-id");
    }
  }
  return result;
}

function normalizeWorkflowArtifacts(value: JsonValue): JsonValue[] {
  if (!Array.isArray(value)) {
    fail("bundle-artifacts");
  }
  const result = [...value];
  for (const item of result) {
    if (!isRecord(item) || typeof item.path !== "string") {
      fail("bundle-artifacts");
    }
  }
  result.sort((left, right) => {
    if (!isRecord(left) || !isRecord(right)) {
      fail("bundle-artifacts");
    }
    const leftPath = left.path;
    const rightPath = right.path;
    if (typeof leftPath !== "string" || typeof rightPath !== "string") {
      fail("bundle-artifacts");
    }
    return compareUtf16(leftPath, rightPath);
  });
  for (let index = 1; index < result.length; index += 1) {
    const previous = result[index - 1];
    const current = result[index];
    if (!isRecord(previous) || !isRecord(current)) {
      fail("bundle-artifacts");
    }
    if (previous.path === current.path) {
      fail("bundle-array-duplicate");
    }
  }
  return result;
}

function normalizeOptionalStrings(record: Record<string, JsonValue>, key: string): void {
  if (hasOwn(record, key)) {
    record[key] = normalizeStrings(record[key] as JsonValue, "bundle-array");
  }
}

function hasMissingCodeConflict(value: readonly unknown[]): boolean {
  return (
    value.includes("settings-authority-incomplete") &&
    value.includes("settings-observation-mismatch")
  );
}

function normalizeOptionalChecks(record: Record<string, JsonValue>, key: string): void {
  if (hasOwn(record, key)) {
    record[key] = normalizeChecks(record[key] as JsonValue);
  }
}

function normalizeOptionalBranchBypasses(record: Record<string, JsonValue>, key: string): void {
  if (hasOwn(record, key)) {
    record[key] = normalizeBranchBypassSummaries(record[key] as JsonValue);
  }
}

export function normalizeAuditEvidenceBundle<T>(value: T): T {
  canonicalizeJsonValue(value);
  const cloned = cloneJson(value);
  if (!isRecord(cloned)) {
    fail("bundle-shape");
  }

  const collection = recordAt(cloned, "collection");
  if (collection !== undefined) {
    normalizeOptionalStrings(collection, "missing");
    if (Array.isArray(collection.missing) && hasMissingCodeConflict(collection.missing)) {
      fail("bundle-missing-conflict");
    }
  }

  const assertions = recordAt(cloned, "assertions");
  if (assertions !== undefined) {
    normalizeOptionalStrings(assertions, "protectedWorkflowPaths");
    normalizeOptionalStrings(assertions, "trustedWorkflowPaths");
  }

  const snapshot = recordAt(cloned, "snapshot");
  if (snapshot !== undefined) {
    const policy = recordAt(snapshot, "policy");
    if (policy !== undefined) {
      normalizeOptionalChecks(policy, "requiredChecks");
      normalizeOptionalStrings(policy, "workflowPaths");
    }
    const branchProtection = recordAt(snapshot, "branchProtection");
    if (branchProtection !== undefined) {
      const requiredStatusChecks = recordAt(branchProtection, "requiredStatusChecks");
      if (requiredStatusChecks !== undefined) {
        normalizeOptionalChecks(requiredStatusChecks, "checks");
      }
      const requiredReviews = recordAt(branchProtection, "requiredPullRequestReviews");
      if (requiredReviews !== undefined) {
        normalizeOptionalBranchBypasses(requiredReviews, "bypassActorSummaries");
      }
    }
    if (hasOwn(snapshot, "rulesets")) {
      snapshot.rulesets = normalizeRulesets(snapshot.rulesets as JsonValue);
    }
    const completeness = recordAt(snapshot, "completeness");
    if (completeness !== undefined) {
      normalizeOptionalStrings(completeness, "missing");
      if (Array.isArray(completeness.missing) && hasMissingCodeConflict(completeness.missing)) {
        fail("bundle-missing-conflict");
      }
    }
    if (hasOwn(snapshot, "workflows")) {
      if (!Array.isArray(snapshot.workflows)) {
        fail("bundle-workflows");
      }
      const workflows = [...snapshot.workflows];
      for (const workflow of workflows) {
        if (!isRecord(workflow) || typeof workflow.path !== "string") {
          fail("bundle-workflows");
        }
      }
      workflows.sort((left, right) => {
        if (!isRecord(left) || !isRecord(right)) {
          fail("bundle-workflows");
        }
        const leftPath = left.path;
        const rightPath = right.path;
        if (typeof leftPath !== "string" || typeof rightPath !== "string") {
          fail("bundle-workflows");
        }
        return compareUtf16(leftPath, rightPath);
      });
      for (let index = 1; index < workflows.length; index += 1) {
        const previous = workflows[index - 1];
        const current = workflows[index];
        if (!isRecord(previous) || !isRecord(current)) {
          fail("bundle-workflows");
        }
        if (previous.path === current.path) {
          fail("bundle-array-duplicate");
        }
      }
      snapshot.workflows = workflows;
    }
  }

  const artifacts = recordAt(cloned, "artifacts");
  if (artifacts !== undefined && hasOwn(artifacts, "workflows")) {
    artifacts.workflows = normalizeWorkflowArtifacts(artifacts.workflows as JsonValue);
  }

  const report = recordAt(cloned, "report");
  if (report !== undefined && hasOwn(report, "findings")) {
    report.findings = normalizeFindings(report.findings as JsonValue);
  }
  return cloned as T;
}

function assertSortedUniqueStrings(
  value: unknown,
  item: (value: unknown) => boolean,
  code: string
): string[] {
  const array = requiredArray(value, code);
  const result: string[] = [];
  for (const entry of array) {
    if (typeof entry !== "string" || !item(entry)) {
      fail(code);
    }
    result.push(entry);
  }
  for (let index = 1; index < result.length; index += 1) {
    const previous = result[index - 1];
    const current = result[index];
    if (previous === undefined || current === undefined) {
      fail(code);
    }
    const order = compareUtf16(previous, current);
    if (order >= 0) {
      fail(order === 0 ? "bundle-array-duplicate" : code);
    }
  }
  return result;
}

function assertCheckArray(value: unknown, code = "bundle-check"): void {
  const array = requiredArray(value, code);
  if (array.length > 100) {
    fail("bundle-check-limit");
  }
  let previous: JsonValue | undefined;
  for (const entry of array) {
    assertCheck(entry);
    if (previous !== undefined && compareAuditEvidenceChecks(previous, entry) >= 0) {
      fail(compareAuditEvidenceChecks(previous, entry) === 0 ? "bundle-array-duplicate" : code);
    }
    previous = entry;
  }
}

function assertObservedAt(value: unknown): void {
  const observedAt = requiredText(value, "bundle-time");
  if (!OBSERVED_AT.test(observedAt)) {
    fail("bundle-time");
  }
  const date = new Date(observedAt);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== observedAt) {
    fail("bundle-time");
  }
}

function validateSubject(bundle: Record<string, JsonValue>): {
  readonly subject: Record<string, JsonValue>;
  readonly requestedBaseSha: string;
} {
  const subject = requiredRecord(bundle.subject, "bundle-subject");
  assertClosed(
    subject,
    [
      "repositoryId",
      "owner",
      "name",
      "ownerType",
      "visibility",
      "defaultBranch",
      "requestedBaseSha",
      "observedBaseShaAtStart",
      "observedBaseShaAtEnd"
    ],
    "bundle-subject"
  );
  const repositoryId = requiredSafeInteger(subject.repositoryId, "bundle-subject");
  if (repositoryId < 1) {
    fail("bundle-subject");
  }
  const owner = requiredText(subject.owner, "bundle-subject");
  const name = requiredText(subject.name, "bundle-subject");
  if (
    owner.length > 100 ||
    name.length > 100 ||
    !/^[\u0021-\u007e]+$/u.test(owner) ||
    !/^[\u0021-\u007e]+$/u.test(name)
  ) {
    fail("bundle-subject");
  }
  if (!["organization", "user"].includes(requiredText(subject.ownerType, "bundle-subject"))) {
    fail("bundle-subject");
  }
  if (
    !["public", "private", "internal"].includes(requiredText(subject.visibility, "bundle-subject"))
  ) {
    fail("bundle-subject");
  }
  if (!boundedText(subject.defaultBranch)) {
    fail("bundle-subject");
  }
  const requestedBaseSha = requiredSha(subject.requestedBaseSha, SHA1, "bundle-subject");
  if (
    requiredSha(subject.observedBaseShaAtStart, SHA1, "bundle-subject") !== requestedBaseSha ||
    requiredSha(subject.observedBaseShaAtEnd, SHA1, "bundle-subject") !== requestedBaseSha
  ) {
    fail("bundle-revision-mismatch");
  }
  return { subject, requestedBaseSha };
}

function validateCollection(bundle: Record<string, JsonValue>): Record<string, JsonValue> {
  const collection = requiredRecord(bundle.collection, "bundle-collection");
  assertClosed(
    collection,
    [
      "apiVersion",
      "consistency",
      "observedAt",
      "durationMs",
      "status",
      "missing",
      "requestAttempts",
      "retryAttempts",
      "bounds"
    ],
    "bundle-collection"
  );
  if (
    collection.apiVersion !== "2026-03-10" ||
    collection.consistency !== "stable-double-observation-v1"
  ) {
    fail("bundle-collection");
  }
  assertObservedAt(collection.observedAt);
  const durationMs = requiredSafeInteger(collection.durationMs, "bundle-collection");
  if (durationMs < 0 || durationMs > 120_000) {
    fail("bundle-collection");
  }
  const status = requiredText(collection.status, "bundle-collection");
  if (status !== "complete" && status !== "incomplete") {
    fail("bundle-collection");
  }
  const missing = requiredArray(collection.missing, "bundle-collection");
  const missingValues = assertSortedUniqueStrings(
    missing,
    (entry) =>
      entry === "settings-authority-incomplete" || entry === "settings-observation-mismatch",
    "bundle-collection"
  );
  if (hasMissingCodeConflict(missingValues)) {
    fail("bundle-missing-conflict");
  }
  if (
    (status === "complete" && missingValues.length !== 0) ||
    (status === "incomplete" && missingValues.length === 0)
  ) {
    fail("bundle-collection");
  }
  const requestAttempts = requiredSafeInteger(collection.requestAttempts, "bundle-collection");
  const retryAttempts = requiredSafeInteger(collection.retryAttempts, "bundle-collection");
  if (
    requestAttempts < 0 ||
    requestAttempts > 768 ||
    retryAttempts < 0 ||
    retryAttempts > requestAttempts
  ) {
    fail("bundle-retry-count");
  }
  const bounds = requiredRecord(collection.bounds, "bundle-bounds");
  const boundKeys = Object.keys(BUNDLE_BOUNDS);
  assertClosed(bounds, boundKeys, "bundle-bounds");
  for (const key of boundKeys) {
    if (requiredSafeInteger(bounds[key], "bundle-bounds") !== BUNDLE_BOUNDS[key]) {
      fail("bundle-bounds");
    }
  }
  return collection;
}

function validateAssertions(bundle: Record<string, JsonValue>): {
  readonly assertions: Record<string, JsonValue>;
  readonly policyPath: string;
} {
  const assertions = requiredRecord(bundle.assertions, "bundle-assertions");
  assertClosed(
    assertions,
    ["policyPath", "protectedWorkflowPaths", "trustedWorkflowPaths"],
    "bundle-assertions"
  );
  const policyPath = requiredText(assertions.policyPath, "bundle-assertions");
  if (!repositoryPath(policyPath)) {
    fail("bundle-assertions");
  }
  assertSortedUniqueStrings(assertions.protectedWorkflowPaths, workflowPath, "bundle-assertions");
  assertSortedUniqueStrings(assertions.trustedWorkflowPaths, workflowPath, "bundle-assertions");
  return { assertions, policyPath };
}

function validateCheckProjection(value: unknown, code: string): void {
  assertCheckArray(value, code);
}

function validateBranchProtection(
  value: unknown,
  defaultBranch: string,
  collectionStatus: string
): void {
  if (value === null) {
    if (collectionStatus === "complete") {
      fail("bundle-branch-protection");
    }
    return;
  }
  const branchProtection = requiredRecord(value, "bundle-branch-protection");
  assertClosed(
    branchProtection,
    [
      "branch",
      "exists",
      "enforceAdmins",
      "allowForcePushes",
      "allowDeletions",
      "requiredStatusChecks",
      "requiredPullRequestReviews"
    ],
    "bundle-branch-protection"
  );
  if (branchProtection.branch !== defaultBranch) {
    fail("bundle-branch-protection");
  }
  requiredBoolean(branchProtection.exists, "bundle-branch-protection");
  requiredBoolean(branchProtection.enforceAdmins, "bundle-branch-protection");
  requiredBoolean(branchProtection.allowForcePushes, "bundle-branch-protection");
  requiredBoolean(branchProtection.allowDeletions, "bundle-branch-protection");

  const checks = branchProtection.requiredStatusChecks;
  if (checks !== null) {
    const requiredStatusChecks = requiredRecord(checks, "bundle-branch-protection");
    assertClosed(requiredStatusChecks, ["strict", "checks"], "bundle-branch-protection");
    requiredBoolean(requiredStatusChecks.strict, "bundle-branch-protection");
    validateCheckProjection(requiredStatusChecks.checks, "bundle-branch-protection");
  }

  const reviews = branchProtection.requiredPullRequestReviews;
  if (reviews !== null) {
    const requiredReviews = requiredRecord(reviews, "bundle-branch-protection");
    assertClosed(
      requiredReviews,
      ["requiredApprovingReviewCount", "bypassActorsKnown", "bypassActorSummaries"],
      "bundle-branch-protection"
    );
    const count = requiredSafeInteger(
      requiredReviews.requiredApprovingReviewCount,
      "bundle-branch-protection"
    );
    if (count < 0 || count > 100) {
      fail("bundle-branch-protection");
    }
    const known = requiredBoolean(requiredReviews.bypassActorsKnown, "bundle-branch-protection");
    assertBranchBypasses(requiredReviews.bypassActorSummaries);
    if (collectionStatus === "complete" && !known) {
      fail("bundle-authority-incomplete");
    }
  } else if (collectionStatus === "complete") {
    fail("bundle-authority-incomplete");
  }
}

function assertBranchBypasses(value: unknown): void {
  const summaries = requiredArray(value, "bundle-bypass");
  let total = 0;
  let previous: string | undefined;
  for (const entry of summaries) {
    const summary = requiredRecord(entry, "bundle-bypass");
    assertClosed(summary, ["actorType", "count"], "bundle-bypass");
    const actorType = requiredText(summary.actorType, "bundle-bypass");
    if (!["app", "team", "user"].includes(actorType)) {
      fail("bundle-bypass");
    }
    const count = requiredSafeInteger(summary.count, "bundle-bypass");
    if (count < 1 || count > 100) {
      fail("bundle-bypass");
    }
    total += count;
    if (total > 100) {
      fail("bundle-bypass-count");
    }
    if (previous !== undefined && compareUtf16(previous, actorType) >= 0) {
      fail(previous === actorType ? "bundle-array-duplicate" : "bundle-bypass");
    }
    previous = actorType;
  }
}

function assertRulesetBypasses(value: unknown, target: string): void {
  const summaries = requiredArray(value, "bundle-bypass");
  let total = 0;
  let previous: string | undefined;
  for (const entry of summaries) {
    const summary = requiredRecord(entry, "bundle-bypass");
    assertClosed(summary, ["actorType", "bypassMode", "count"], "bundle-bypass");
    const actorType = requiredText(summary.actorType, "bundle-bypass");
    const bypassMode = requiredText(summary.bypassMode, "bundle-bypass");
    if (
      ![
        "deploy_key",
        "integration",
        "organization_admin",
        "repository_role",
        "team",
        "user"
      ].includes(actorType) ||
      !["always", "exempt", "pull_request"].includes(bypassMode)
    ) {
      fail("bundle-bypass");
    }
    if (bypassMode === "pull_request" && target !== "branch") {
      fail("bundle-bypass");
    }
    const count = requiredSafeInteger(summary.count, "bundle-bypass");
    if (count < 1 || count > 100) {
      fail("bundle-bypass");
    }
    if ((actorType === "deploy_key" || actorType === "organization_admin") && count !== 1) {
      fail("bundle-bypass-singleton");
    }
    total += count;
    if (total > 100) {
      fail("bundle-bypass-count");
    }
    const identity = actorType + "\u0000" + bypassMode;
    if (previous !== undefined && compareUtf16(previous, identity) >= 0) {
      fail(previous === identity ? "bundle-array-duplicate" : "bundle-bypass");
    }
    previous = identity;
  }
}

function validateRuleset(
  value: JsonValue,
  ownerType: string,
  previousId: number | undefined
): number {
  const ruleset = requiredRecord(value, "bundle-ruleset");
  const allowed = [
    "id",
    "name",
    "target",
    "refPatterns",
    "repositoryPatterns",
    "enforcement",
    "bypassActorsKnown",
    "bypassActorSummaries",
    "allowForcePushes",
    "allowDeletions",
    "requiredChecks"
  ] as const;
  if (Object.keys(ruleset).some((key) => !allowed.includes(key as (typeof allowed)[number]))) {
    fail("bundle-ruleset");
  }
  const id = requiredSafeInteger(ruleset.id, "bundle-ruleset");
  if (id < 1 || (previousId !== undefined && id <= previousId)) {
    fail(previousId === id ? "bundle-duplicate-id" : "bundle-ruleset");
  }
  if (!boundedText(ruleset.name)) {
    fail("bundle-ruleset");
  }
  const target = requiredText(ruleset.target, "bundle-ruleset");
  if (!["branch", "tag", "push", "repository"].includes(target)) {
    fail("bundle-ruleset");
  }
  const refPatterns = requiredArray(ruleset.refPatterns, "bundle-ruleset");
  assertSortedUniqueStrings(refPatterns, boundedText, "bundle-ruleset");
  const hasRepositoryPatterns = hasOwn(ruleset, "repositoryPatterns");
  let repositoryPatterns: JsonValue[] = [];
  if (hasRepositoryPatterns) {
    repositoryPatterns = assertSortedUniqueStrings(
      ruleset.repositoryPatterns,
      boundedText,
      "bundle-ruleset"
    );
    if (repositoryPatterns.length === 0) {
      fail("bundle-ruleset");
    }
  }
  if ((target === "branch" || target === "tag") && refPatterns.length === 0) {
    fail("bundle-ruleset");
  }
  if ((target === "push" || target === "repository") && refPatterns.length !== 0) {
    fail("bundle-ruleset");
  }
  const enforcement = requiredText(ruleset.enforcement, "bundle-ruleset");
  if (!["active", "disabled", "evaluate"].includes(enforcement)) {
    fail("bundle-ruleset");
  }
  if (
    target === "repository" &&
    (!hasRepositoryPatterns || repositoryPatterns.length === 0 || enforcement === "evaluate")
  ) {
    fail("bundle-ruleset");
  }
  const hasForce = hasOwn(ruleset, "allowForcePushes");
  const hasDelete = hasOwn(ruleset, "allowDeletions");
  if (target === "branch" || target === "tag") {
    if (!hasForce || !hasDelete) {
      fail("bundle-ruleset");
    }
    requiredBoolean(ruleset.allowForcePushes, "bundle-ruleset");
    requiredBoolean(ruleset.allowDeletions, "bundle-ruleset");
  } else if (hasForce || hasDelete) {
    fail("bundle-ruleset");
  }
  requiredBoolean(ruleset.bypassActorsKnown, "bundle-ruleset");
  assertRulesetBypasses(ruleset.bypassActorSummaries, target);
  validateCheckProjection(ruleset.requiredChecks, "bundle-ruleset");
  if (ownerType === "user" && Array.isArray(ruleset.bypassActorSummaries)) {
    for (const summary of ruleset.bypassActorSummaries) {
      if (isRecord(summary) && summary.actorType === "organization_admin") {
        fail("bundle-owner-type");
      }
    }
  }
  return id;
}

function validateSnapshot(
  bundle: Record<string, JsonValue>,
  subject: Record<string, JsonValue>,
  requestedBaseSha: string,
  policyPath: string,
  collectionStatus: string,
  collectionMissing: readonly string[]
): Record<string, JsonValue> {
  const snapshot = requiredRecord(bundle.snapshot, "bundle-snapshot");
  assertClosed(
    snapshot,
    [
      "snapshotVersion",
      "repository",
      "baseRevision",
      "policy",
      "completeness",
      "branchProtection",
      "rulesets",
      "tagProtection",
      "workflows"
    ],
    "bundle-snapshot"
  );
  if (snapshot.snapshotVersion !== 1) {
    fail("bundle-version");
  }
  const repository = requiredRecord(snapshot.repository, "bundle-snapshot");
  assertClosed(repository, ["owner", "name", "defaultBranch"], "bundle-snapshot");
  if (
    repository.owner !== subject.owner ||
    repository.name !== subject.name ||
    repository.defaultBranch !== subject.defaultBranch
  ) {
    fail("bundle-subject-mismatch");
  }
  const baseRevision = requiredRecord(snapshot.baseRevision, "bundle-revision");
  assertClosed(
    baseRevision,
    ["sha", "policyPath", "policyRevisionSha", "policySha256", "policyLoadedFromBase"],
    "bundle-revision"
  );
  if (
    requiredSha(baseRevision.sha, SHA1, "bundle-revision") !== requestedBaseSha ||
    requiredSha(baseRevision.policyRevisionSha, SHA1, "bundle-revision") !== requestedBaseSha ||
    baseRevision.policyPath !== policyPath ||
    baseRevision.policyLoadedFromBase !== true
  ) {
    fail("bundle-revision-mismatch");
  }
  requiredSha(baseRevision.policySha256, SHA256, "bundle-revision");

  const policy = requiredRecord(snapshot.policy, "bundle-policy");
  assertClosed(policy, ["requiredChecks", "workflowPaths"], "bundle-policy");
  validateCheckProjection(policy.requiredChecks, "bundle-policy");
  assertSortedUniqueStrings(policy.workflowPaths, workflowPath, "bundle-policy");

  const completeness = requiredRecord(snapshot.completeness, "bundle-completeness");
  assertClosed(completeness, ["complete", "missing"], "bundle-completeness");
  const complete = requiredBoolean(completeness.complete, "bundle-completeness");
  const missing = assertSortedUniqueStrings(
    completeness.missing,
    (entry) =>
      entry === "settings-authority-incomplete" || entry === "settings-observation-mismatch",
    "bundle-completeness"
  );
  if (hasMissingCodeConflict(missing)) {
    fail("bundle-missing-conflict");
  }
  if (
    (collectionStatus === "complete" && (!complete || missing.length !== 0)) ||
    (collectionStatus === "incomplete" &&
      (complete || missing.join("\u0000") !== collectionMissing.join("\u0000")))
  ) {
    fail("bundle-completeness-mismatch");
  }
  const isObservationMismatch = collectionMissing.includes("settings-observation-mismatch");
  if (isObservationMismatch && snapshot.branchProtection !== null) {
    fail("bundle-mismatch-projection");
  }
  validateBranchProtection(
    snapshot.branchProtection,
    requiredText(repository.defaultBranch, "bundle-snapshot"),
    collectionStatus
  );

  const rulesets = requiredArray(snapshot.rulesets, "bundle-rulesets");
  if (rulesets.length > MAX_AUDIT_EVIDENCE_RULESETS) {
    fail("bundle-rulesets-limit");
  }
  let previousId: number | undefined;
  for (const ruleset of rulesets) {
    previousId = validateRuleset(
      ruleset,
      requiredText(subject.ownerType, "bundle-subject"),
      previousId
    );
    if (collectionStatus === "complete") {
      const object = requiredRecord(ruleset, "bundle-ruleset");
      if (object.bypassActorsKnown !== true) {
        fail("bundle-authority-incomplete");
      }
    }
  }
  if (isObservationMismatch && rulesets.length !== 0) {
    fail("bundle-mismatch-projection");
  }
  const tagProtection = requiredRecord(snapshot.tagProtection, "bundle-tag-protection");
  assertClosed(tagProtection, ["known", "allowsDeletion", "allowsUpdate"], "bundle-tag-protection");
  const tagKnown = requiredBoolean(tagProtection.known, "bundle-tag-protection");
  requiredBoolean(tagProtection.allowsDeletion, "bundle-tag-protection");
  requiredBoolean(tagProtection.allowsUpdate, "bundle-tag-protection");
  if (collectionStatus === "complete" && !tagKnown) {
    fail("bundle-authority-incomplete");
  }
  if (
    isObservationMismatch &&
    (tagKnown || tagProtection.allowsDeletion !== true || tagProtection.allowsUpdate !== true)
  ) {
    fail("bundle-mismatch-projection");
  }
  const hasUnknownAuthorityFact =
    snapshot.branchProtection === null ||
    !tagKnown ||
    rulesets.some(
      (ruleset) => requiredRecord(ruleset, "bundle-ruleset").bypassActorsKnown !== true
    ) ||
    (() => {
      const branchProtection = requiredRecord(
        snapshot.branchProtection,
        "bundle-branch-protection"
      );
      const reviews = branchProtection.requiredPullRequestReviews;
      return (
        reviews === null ||
        requiredRecord(reviews, "bundle-branch-protection").bypassActorsKnown !== true
      );
    })();
  if (collectionMissing.includes("settings-authority-incomplete") && !hasUnknownAuthorityFact) {
    fail("bundle-authority-mismatch");
  }

  const workflows = requiredArray(snapshot.workflows, "bundle-workflows");
  if (workflows.length > MAX_AUDIT_EVIDENCE_WORKFLOWS) {
    fail("bundle-workflows-limit");
  }
  let previousPath: string | undefined;
  for (const workflow of workflows) {
    const item = requiredRecord(workflow, "bundle-workflow");
    assertClosed(
      item,
      ["path", "revisionSha", "artifactSha256", "protectedFromPullRequest", "trustedRoot"],
      "bundle-workflow"
    );
    const path = requiredText(item.path, "bundle-workflow");
    if (
      !workflowPath(path) ||
      (previousPath !== undefined && compareUtf16(previousPath, path) >= 0)
    ) {
      fail(previousPath === path ? "bundle-array-duplicate" : "bundle-workflow");
    }
    previousPath = path;
    if (
      requiredSha(item.revisionSha, SHA1, "bundle-workflow") !== requestedBaseSha ||
      !SHA256.test(requiredText(item.artifactSha256, "bundle-workflow")) ||
      item.protectedFromPullRequest !== false ||
      item.trustedRoot !== false
    ) {
      fail("bundle-workflow");
    }
  }
  return snapshot;
}

function derivePolicyChecks(source: string): JsonValue[] {
  let policy: ReturnType<typeof parsePolicy>;
  try {
    policy = parsePolicy(source);
  } catch {
    fail("bundle-policy-source");
  }
  const checks: JsonValue[] = [];
  for (const rule of policy.rules) {
    for (const requirement of rule.require) {
      if (requirement.type !== "check") {
        continue;
      }
      const check = {
        name: requirement.name,
        ...(requirement.app === undefined ? {} : { appSlug: requirement.app.toLowerCase() })
      };
      checks.push(check);
    }
  }
  const unique = new Map<string, JsonValue>();
  for (const check of checks) {
    unique.set(canonicalizeAuditEvidenceJsonValue(check), check);
  }
  return normalizeChecks([...unique.values()]);
}

function validateArtifacts(
  bundle: Record<string, JsonValue>,
  requestedBaseSha: string,
  policyPath: string,
  snapshot: Record<string, JsonValue>
): void {
  const artifacts = requiredRecord(bundle.artifacts, "bundle-artifacts");
  assertClosed(artifacts, ["policy", "workflows"], "bundle-artifacts");
  const policyArtifact = requiredRecord(artifacts.policy, "bundle-artifacts");
  const policyVerified = verifyAuditEvidenceSourceArtifact(policyArtifact, "policy");
  if (policyArtifact.path !== policyPath || policyArtifact.revisionSha !== requestedBaseSha) {
    fail("bundle-artifact-binding");
  }
  const baseRevision = requiredRecord(snapshot.baseRevision, "bundle-revision");
  if (policyArtifact.sha256 !== baseRevision.policySha256 || policyVerified.bytes.byteLength < 1) {
    fail("bundle-artifact-binding");
  }
  const policy = requiredRecord(snapshot.policy, "bundle-policy");
  const derivedChecks = derivePolicyChecks(policyVerified.text);
  if (
    canonicalizeAuditEvidenceJsonValue(derivedChecks) !==
    canonicalizeAuditEvidenceJsonValue(policy.requiredChecks)
  ) {
    fail("bundle-policy-derived");
  }
  const declaredWorkflowPaths = assertSortedUniqueStrings(
    policy.workflowPaths,
    workflowPath,
    "bundle-policy"
  );
  const workflows = requiredArray(artifacts.workflows, "bundle-artifacts");
  if (workflows.length > MAX_AUDIT_EVIDENCE_WORKFLOWS) {
    fail("bundle-workflows-limit");
  }
  const snapshotWorkflows = requiredArray(snapshot.workflows, "bundle-workflows");
  const snapshotByPath = new Map<string, string>();
  for (const entry of snapshotWorkflows) {
    const workflow = requiredRecord(entry, "bundle-workflow");
    const path = requiredText(workflow.path, "bundle-workflow");
    snapshotByPath.set(path, requiredText(workflow.artifactSha256, "bundle-workflow"));
  }
  let previousPath: string | undefined;
  let aggregateBytes = policyVerified.bytes.byteLength;
  const artifactPaths: string[] = [];
  for (const artifact of workflows) {
    const item = requiredRecord(artifact, "bundle-artifacts");
    const path = requiredText(item.path, "bundle-artifacts");
    if (previousPath !== undefined && compareUtf16(previousPath, path) >= 0) {
      fail(previousPath === path ? "bundle-array-duplicate" : "bundle-artifacts");
    }
    previousPath = path;
    artifactPaths.push(path);
    const verified = verifyAuditEvidenceSourceArtifact(item, "workflow");
    if (item.revisionSha !== requestedBaseSha || snapshotByPath.get(path) !== item.sha256) {
      fail("bundle-artifact-binding");
    }
    aggregateBytes += verified.bytes.byteLength;
    if (aggregateBytes > 4_194_304) {
      fail("bundle-source-limit");
    }
  }
  if (
    workflows.length !== snapshotByPath.size ||
    workflows.some(
      (item) =>
        !snapshotByPath.has(
          requiredText(requiredRecord(item, "bundle-artifacts").path, "bundle-artifacts")
        )
    )
  ) {
    fail("bundle-artifact-binding");
  }
  if (
    artifactPaths.length !== declaredWorkflowPaths.length ||
    artifactPaths.some((path, index) => path !== declaredWorkflowPaths[index])
  ) {
    fail("bundle-artifact-binding");
  }
  const artifactPathSet = new Set(artifactPaths);
  const assertions = requiredRecord(bundle.assertions, "bundle-assertions");
  for (const key of ["protectedWorkflowPaths", "trustedWorkflowPaths"] as const) {
    const paths = requiredArray(assertions[key], "bundle-assertions");
    for (const path of paths) {
      if (typeof path !== "string" || !artifactPathSet.has(path)) {
        fail("bundle-assertions");
      }
    }
  }
}

type HydratedCheck = AuditSnapshot["policy"]["requiredChecks"][number];
type HydratedBranchActor = NonNullable<
  NonNullable<AuditSnapshot["branchProtection"]>["requiredPullRequestReviews"]
>["bypassActors"][number];
type HydratedRulesetActor = AuditSnapshot["rulesets"][number]["bypassActors"][number];

function hydrateChecks(value: JsonValue, code: string): HydratedCheck[] {
  const checks = requiredArray(value, code);
  return checks.map((entry) => {
    const check = requiredRecord(entry, code);
    return {
      name: requiredText(check.name, code),
      ...(hasOwn(check, "appId") ? { appId: requiredSafeInteger(check.appId, code) } : {}),
      ...(hasOwn(check, "appSlug") ? { appSlug: requiredText(check.appSlug, code) } : {})
    };
  });
}

function redactedActorType(actorType: string): "user" | "team" | "app" | "integration" {
  if (actorType === "user" || actorType === "team" || actorType === "integration") {
    return actorType;
  }
  return "app";
}

function hydrateBranchBypassActors(value: JsonValue): HydratedBranchActor[] {
  const summaries = requiredArray(value, "bundle-bypass");
  const actors: HydratedBranchActor[] = [];
  let index = 0;
  for (const entry of summaries) {
    const summary = requiredRecord(entry, "bundle-bypass");
    const actorType = requiredText(summary.actorType, "bundle-bypass");
    const count = requiredSafeInteger(summary.count, "bundle-bypass");
    for (let offset = 0; offset < count; offset += 1) {
      index += 1;
      actors.push({
        id: "redacted:" + actorType + ":branch:" + String(index),
        type: redactedActorType(actorType)
      });
    }
  }
  return actors;
}

function hydrateRulesetBypassActors(value: JsonValue): HydratedRulesetActor[] {
  const summaries = requiredArray(value, "bundle-bypass");
  const actors: HydratedRulesetActor[] = [];
  let index = 0;
  for (const entry of summaries) {
    const summary = requiredRecord(entry, "bundle-bypass");
    const actorType = requiredText(summary.actorType, "bundle-bypass");
    const bypassMode = requiredText(summary.bypassMode, "bundle-bypass");
    const count = requiredSafeInteger(summary.count, "bundle-bypass");
    for (let offset = 0; offset < count; offset += 1) {
      index += 1;
      actors.push({
        id: "redacted:" + actorType + ":" + bypassMode + ":" + String(index),
        type: redactedActorType(actorType),
        actorType: actorType as HydratedRulesetActor["actorType"],
        bypassMode: bypassMode as HydratedRulesetActor["bypassMode"]
      });
    }
  }
  return actors;
}

function hydrateBranchProtection(value: JsonValue): AuditSnapshot["branchProtection"] {
  if (value === null) {
    return null;
  }
  const branchProtection = requiredRecord(value, "bundle-branch-protection");
  const requiredStatusChecks =
    branchProtection.requiredStatusChecks === null ||
    branchProtection.requiredStatusChecks === undefined
      ? null
      : (() => {
          const checks = requiredRecord(
            branchProtection.requiredStatusChecks,
            "bundle-branch-protection"
          );
          return {
            strict: requiredBoolean(checks.strict, "bundle-branch-protection"),
            checks: hydrateChecks(checks.checks as JsonValue, "bundle-branch-protection")
          };
        })();
  const requiredPullRequestReviews =
    branchProtection.requiredPullRequestReviews === null ||
    branchProtection.requiredPullRequestReviews === undefined
      ? null
      : (() => {
          const reviews = requiredRecord(
            branchProtection.requiredPullRequestReviews,
            "bundle-branch-protection"
          );
          const known = requiredBoolean(reviews.bypassActorsKnown, "bundle-branch-protection");
          return {
            requiredApprovingReviewCount: requiredSafeInteger(
              reviews.requiredApprovingReviewCount,
              "bundle-branch-protection"
            ),
            bypassActors: hydrateBranchBypassActors(reviews.bypassActorSummaries as JsonValue),
            bypassActorsKnown: known
          };
        })();
  return {
    branch: requiredText(branchProtection.branch, "bundle-branch-protection"),
    exists: requiredBoolean(branchProtection.exists, "bundle-branch-protection"),
    enforceAdmins: requiredBoolean(branchProtection.enforceAdmins, "bundle-branch-protection"),
    allowForcePushes: requiredBoolean(
      branchProtection.allowForcePushes,
      "bundle-branch-protection"
    ),
    allowDeletions: requiredBoolean(branchProtection.allowDeletions, "bundle-branch-protection"),
    requiredStatusChecks,
    requiredPullRequestReviews
  };
}

function hydrateRulesets(value: JsonValue): AuditSnapshot["rulesets"] {
  return requiredArray(value, "bundle-rulesets").map((entry) => {
    const ruleset = requiredRecord(entry, "bundle-ruleset");
    return {
      id: requiredSafeInteger(ruleset.id, "bundle-ruleset"),
      name: requiredText(ruleset.name, "bundle-ruleset"),
      target: requiredText(ruleset.target, "bundle-ruleset") as
        "branch" | "tag" | "push" | "repository",
      refPatterns: assertSortedUniqueStrings(ruleset.refPatterns, boundedText, "bundle-ruleset"),
      ...(hasOwn(ruleset, "repositoryPatterns")
        ? {
            repositoryPatterns: assertSortedUniqueStrings(
              ruleset.repositoryPatterns,
              boundedText,
              "bundle-ruleset"
            )
          }
        : {}),
      enforcement: requiredText(ruleset.enforcement, "bundle-ruleset") as
        "active" | "evaluate" | "disabled",
      bypassActors: hydrateRulesetBypassActors(ruleset.bypassActorSummaries as JsonValue),
      bypassActorsKnown: requiredBoolean(ruleset.bypassActorsKnown, "bundle-ruleset"),
      ...(hasOwn(ruleset, "allowForcePushes")
        ? { allowForcePushes: requiredBoolean(ruleset.allowForcePushes, "bundle-ruleset") }
        : {}),
      ...(hasOwn(ruleset, "allowDeletions")
        ? { allowDeletions: requiredBoolean(ruleset.allowDeletions, "bundle-ruleset") }
        : {}),
      requiredChecks: hydrateChecks(ruleset.requiredChecks as JsonValue, "bundle-ruleset")
    };
  });
}

function hydrateWorkflows(
  snapshot: Record<string, JsonValue>,
  artifacts: Record<string, JsonValue>,
  requestedBaseSha: string
): AuditSnapshot["workflows"] {
  const artifactEntries = requiredArray(artifacts.workflows, "bundle-artifacts");
  const artifactsByPath = new Map<string, JsonValue>();
  for (const artifact of artifactEntries) {
    const item = requiredRecord(artifact, "bundle-artifacts");
    artifactsByPath.set(requiredText(item.path, "bundle-artifacts"), artifact);
  }
  return requiredArray(snapshot.workflows, "bundle-workflows").map((entry) => {
    const workflow = requiredRecord(entry, "bundle-workflow");
    const path = requiredText(workflow.path, "bundle-workflow");
    const artifactValue = artifactsByPath.get(path);
    if (artifactValue === undefined || artifactValue === null) {
      fail("bundle-artifact-binding");
    }
    const artifact = requiredRecord(artifactValue, "bundle-artifacts");
    const verified = verifyAuditEvidenceSourceArtifact(artifact, "workflow");
    if (
      verified.bytes.byteLength > MAX_AUDIT_EVIDENCE_SOURCE_BYTES ||
      requiredText(workflow.revisionSha, "bundle-workflow") !== requestedBaseSha ||
      requiredText(workflow.artifactSha256, "bundle-workflow") !==
        requiredText(artifact.sha256, "bundle-artifacts")
    ) {
      fail("bundle-artifact-binding");
    }
    return {
      path,
      revisionSha: requestedBaseSha,
      protectedFromPullRequest: false,
      trustedRoot: false,
      source: verified.text
    };
  });
}

function hydrateAuditSnapshot(
  bundle: Record<string, JsonValue>,
  snapshot: Record<string, JsonValue>,
  requestedBaseSha: string,
  policyPath: string
): AuditSnapshot {
  const repository = requiredRecord(snapshot.repository, "bundle-snapshot");
  const baseRevision = requiredRecord(snapshot.baseRevision, "bundle-revision");
  const policy = requiredRecord(snapshot.policy, "bundle-policy");
  const completeness = requiredRecord(snapshot.completeness, "bundle-completeness");
  const tagProtection = requiredRecord(snapshot.tagProtection, "bundle-tag-protection");
  const artifacts = requiredRecord(bundle.artifacts, "bundle-artifacts");
  return {
    version: 1,
    repository: {
      owner: requiredText(repository.owner, "bundle-snapshot"),
      name: requiredText(repository.name, "bundle-snapshot"),
      defaultBranch: requiredText(repository.defaultBranch, "bundle-snapshot")
    },
    baseRevision: {
      sha: requestedBaseSha,
      policyPath,
      policyRevisionSha: requiredSha(baseRevision.policyRevisionSha, SHA1, "bundle-revision"),
      policySha256: requiredSha(baseRevision.policySha256, SHA256, "bundle-revision"),
      policyLoadedFromBase: requiredBoolean(baseRevision.policyLoadedFromBase, "bundle-revision")
    },
    policy: {
      requiredChecks: hydrateChecks(policy.requiredChecks as JsonValue, "bundle-policy"),
      workflowPaths: assertSortedUniqueStrings(policy.workflowPaths, workflowPath, "bundle-policy")
    },
    completeness: {
      complete: requiredBoolean(completeness.complete, "bundle-completeness"),
      missing: assertSortedUniqueStrings(
        completeness.missing,
        (entry) =>
          entry === "settings-authority-incomplete" || entry === "settings-observation-mismatch",
        "bundle-completeness"
      )
    },
    branchProtection: hydrateBranchProtection(snapshot.branchProtection as JsonValue),
    rulesets: hydrateRulesets(snapshot.rulesets as JsonValue),
    tagProtection: {
      known: requiredBoolean(tagProtection.known, "bundle-tag-protection"),
      allowsDeletion: requiredBoolean(tagProtection.allowsDeletion, "bundle-tag-protection"),
      allowsUpdate: requiredBoolean(tagProtection.allowsUpdate, "bundle-tag-protection")
    },
    workflows: hydrateWorkflows(snapshot, artifacts, requestedBaseSha)
  };
}

function recomputeAuditReport(
  bundle: Record<string, JsonValue>,
  snapshot: Record<string, JsonValue>,
  requestedBaseSha: string,
  policyPath: string
): { readonly snapshot: AuditSnapshot; readonly report: AuditReport } {
  const hydratedSnapshot = hydrateAuditSnapshot(bundle, snapshot, requestedBaseSha, policyPath);
  const report = auditRepository(hydratedSnapshot);
  const savedReport = requiredRecord(bundle.report, "bundle-report");
  if (
    canonicalizeAuditEvidenceJsonValue(report) !== canonicalizeAuditEvidenceJsonValue(savedReport)
  ) {
    fail("bundle-report-recomputed");
  }
  return { snapshot: hydratedSnapshot, report };
}

function validateReport(
  bundle: Record<string, JsonValue>,
  subject: Record<string, JsonValue>,
  collectionStatus: string
): void {
  const report = requiredRecord(bundle.report, "bundle-report");
  assertClosed(
    report,
    ["auditVersion", "status", "repository", "findings", "checked"],
    "bundle-report"
  );
  const reportStatus = requiredText(report.status, "bundle-report");
  if (report.auditVersion !== 1 || !["pass", "fail", "incomplete"].includes(reportStatus)) {
    fail("bundle-report");
  }
  if (collectionStatus === "incomplete" && reportStatus !== "incomplete") {
    fail("bundle-report-status");
  }
  if (collectionStatus === "complete" && reportStatus === "incomplete") {
    fail("bundle-report-status");
  }
  const repository = requiredRecord(report.repository, "bundle-report");
  assertClosed(repository, ["owner", "name", "baseSha"], "bundle-report");
  if (
    repository.owner !== subject.owner ||
    repository.name !== subject.name ||
    repository.baseSha !== subject.requestedBaseSha
  ) {
    fail("bundle-report-binding");
  }
  const findings = requiredArray(report.findings, "bundle-report");
  if (findings.length > MAX_AUDIT_EVIDENCE_FINDINGS) {
    fail("bundle-findings-limit");
  }
  const normalizedFindings = normalizeFindings(findings);
  if (
    canonicalizeAuditEvidenceJsonValue(normalizedFindings) !==
    canonicalizeAuditEvidenceJsonValue(findings)
  ) {
    fail("bundle-report-order");
  }
  const checked = requiredArray(report.checked, "bundle-report");
  if (
    checked.length !== CHECKED_ORDER.length ||
    checked.some((entry, index) => entry !== CHECKED_ORDER[index])
  ) {
    fail("bundle-report");
  }
}

function validateIntegrity(bundle: Record<string, JsonValue>): void {
  const integrity = requiredRecord(bundle.integrity, "bundle-integrity");
  assertClosed(
    integrity,
    ["algorithm", "snapshotSha256", "reportSha256", "payloadSha256"],
    "bundle-integrity"
  );
  if (
    integrity.algorithm !== "sha256" ||
    !SHA256.test(requiredText(integrity.snapshotSha256, "bundle-integrity")) ||
    !SHA256.test(requiredText(integrity.reportSha256, "bundle-integrity")) ||
    !SHA256.test(requiredText(integrity.payloadSha256, "bundle-integrity"))
  ) {
    fail("bundle-integrity");
  }
  const expected = computeAuditEvidenceIntegrity(bundle);
  if (
    integrity.snapshotSha256 !== expected.snapshotSha256 ||
    integrity.reportSha256 !== expected.reportSha256 ||
    integrity.payloadSha256 !== expected.payloadSha256
  ) {
    fail("bundle-integrity");
  }
}

function validateAuditEvidenceBundleCore(value: unknown): {
  readonly bundle: Record<string, JsonValue>;
  readonly subject: Record<string, JsonValue>;
  readonly requestedBaseSha: string;
  readonly policyPath: string;
  readonly snapshot: Record<string, JsonValue>;
} {
  canonicalizeAuditEvidenceJsonValue(value);
  const bundle = requiredRecord(value, "bundle-shape");
  assertClosed(
    bundle,
    [
      "bundleVersion",
      "canonicalization",
      "subject",
      "collection",
      "assertions",
      "snapshot",
      "artifacts",
      "report",
      "integrity"
    ],
    "bundle-shape"
  );
  if (bundle.bundleVersion !== 1 || bundle.canonicalization !== "RFC8785") {
    fail("bundle-version");
  }
  const { subject, requestedBaseSha } = validateSubject(bundle);
  const collection = validateCollection(bundle);
  const { policyPath } = validateAssertions(bundle);
  const snapshot = validateSnapshot(
    bundle,
    subject,
    requestedBaseSha,
    policyPath,
    requiredText(collection.status, "bundle-collection"),
    assertSortedUniqueStrings(
      collection.missing,
      (entry) =>
        entry === "settings-authority-incomplete" || entry === "settings-observation-mismatch",
      "bundle-collection"
    )
  );
  validateArtifacts(bundle, requestedBaseSha, policyPath, snapshot);
  validateReport(bundle, subject, requiredText(collection.status, "bundle-collection"));
  validateIntegrity(bundle);
  return { bundle, subject, requestedBaseSha, policyPath, snapshot };
}

export interface HydratedAuditEvidenceBundle {
  readonly snapshot: AuditSnapshot;
  readonly report: AuditReport;
}

export function hydrateAuditEvidenceBundle(value: unknown): HydratedAuditEvidenceBundle {
  const validated = validateAuditEvidenceBundleCore(value);
  return recomputeAuditReport(
    validated.bundle,
    validated.snapshot,
    validated.requestedBaseSha,
    validated.policyPath
  );
}

export function validateAuditEvidenceBundle(value: unknown): void {
  hydrateAuditEvidenceBundle(value);
}
