import { isProxy } from "node:util/types";

import type { JsonValue } from "./audit-evidence.js";

export const SHA1 = /^[0-9a-f]{40}$/u;
export const SHA256 = /^[0-9a-f]{64}$/u;

// eslint-disable-next-line no-control-regex
const BOUNDED_TEXT = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\p{Cf}\p{Cs}]/u;
const PATH =
  /^(?!\/)(?![A-Za-z]:)(?!.*\\)(?!.*\/\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))[^/]+(?:\/[^/]+)*$/u;
const WORKFLOW =
  /^[.][gG][iI][tT][hH][uU][bB]\/[wW][oO][rR][kK][fF][lL][oO][wW][sS]\/[^/]+\.(?:[yY][mM][lL]|[yY][aA][mM][lL])$/u;

export class AuditEvidenceBundleError extends Error {
  public constructor(
    public readonly code: string,
    message = code
  ) {
    super(message);
    this.name = "AuditEvidenceBundleError";
  }
}

export function fail(code: string, message = code): never {
  throw new AuditEvidenceBundleError(code, message);
}

export function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !isProxy(value);
}

export function boundedText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Array.from(value).length >= 1 &&
    Array.from(value).length <= 512 &&
    !BOUNDED_TEXT.test(value)
  );
}

export function repositoryPath(value: unknown): value is string {
  return boundedText(value) && PATH.test(value);
}

export function workflowPath(value: unknown): value is string {
  return repositoryPath(value) && WORKFLOW.test(value);
}

export function requiredString(record: Record<string, JsonValue>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    fail("artifact-shape");
  }
  return value;
}

export function requiredNumber(record: Record<string, JsonValue>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    fail("artifact-shape");
  }
  return value;
}

export function hasExactKeys(record: Record<string, JsonValue>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return (
    Object.keys(record).length === keys.length &&
    Object.keys(record).every((key) => allowed.has(key))
  );
}

export function requiredRecord(value: unknown, code: string): Record<string, JsonValue> {
  if (!isRecord(value)) {
    fail(code);
  }
  return value;
}

export function requiredText(value: unknown, code: string): string {
  if (typeof value !== "string") {
    fail(code);
  }
  return value;
}

export function requiredBoolean(value: unknown, code: string): boolean {
  if (typeof value !== "boolean") {
    fail(code);
  }
  return value;
}

export function requiredSafeInteger(value: unknown, code: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || Object.is(value, -0)) {
    fail(code);
  }
  return value;
}

export function requiredArray(value: unknown, code: string): JsonValue[] {
  if (!Array.isArray(value)) {
    fail(code);
  }
  const result: JsonValue[] = [];
  for (const item of value as readonly unknown[]) {
    result.push(item as JsonValue);
  }
  return result;
}

export function requiredSha(value: unknown, pattern: RegExp, code: string): string {
  const text = requiredText(value, code);
  if (!pattern.test(text)) {
    fail(code);
  }
  return text;
}

export function assertClosed(
  record: Record<string, JsonValue>,
  keys: readonly string[],
  code: string
): void {
  if (!hasExactKeys(record, keys)) {
    fail(code);
  }
}

export function hasOwn(record: Record<string, JsonValue>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export function compareUtf16(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) {
      return difference;
    }
  }
  return left.length - right.length;
}

export function assertSortedUniqueStrings(
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
