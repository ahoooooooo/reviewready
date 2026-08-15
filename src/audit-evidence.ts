import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";

export const MAX_AUDIT_EVIDENCE_JSON_BYTES = 8 * 1024 * 1024;
export const MAX_AUDIT_EVIDENCE_JSON_DEPTH = 32;
export const MAX_AUDIT_EVIDENCE_OBJECT_MEMBERS = 20_000;
export const MAX_AUDIT_EVIDENCE_ARRAY_ELEMENTS = 20_000;
export const MAX_AUDIT_EVIDENCE_JSON_TOKENS = 100_000;
export const MAX_AUDIT_EVIDENCE_STRING_BYTES = 6 * 1024 * 1024;
export const MAX_AUDIT_EVIDENCE_NUMBER_CHARS = 32;

export const AUDIT_SNAPSHOT_DIGEST_DOMAIN = "reviewready:audit-snapshot:v1";
export const AUDIT_REPORT_DIGEST_DOMAIN = "reviewready:audit-report:v1";
export const AUDIT_BUNDLE_DIGEST_DOMAIN = "reviewready:audit-bundle:v1";

const DIGEST_DOMAINS = new Set<string>([
  AUDIT_SNAPSHOT_DIGEST_DOMAIN,
  AUDIT_REPORT_DIGEST_DOMAIN,
  AUDIT_BUNDLE_DIGEST_DOMAIN
]);
const encoder = new TextEncoder();
const JSON_NUMBER_START = /[0-9-]/u;
const JSON_NUMBER_CONTINUATION = /[0-9.eE+-]/u;

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { readonly [key: string]: JsonValue };

export class AuditEvidenceJsonError extends Error {
  public constructor(
    public readonly code: string,
    message = code
  ) {
    super(message);
    this.name = "AuditEvidenceJsonError";
  }
}

function fail(code: string, message = code): never {
  throw new AuditEvidenceJsonError(code, message);
}

function isJsonWhitespace(character: string | undefined): boolean {
  return character === " " || character === "\t" || character === "\n" || character === "\r";
}

function isAsciiDigit(character: string | undefined): boolean {
  return character !== undefined && character >= "0" && character <= "9";
}

function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return true;
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function compareUtf16(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftCode = left.charCodeAt(index);
    const rightCode = right.charCodeAt(index);
    if (leftCode !== rightCode) {
      return leftCode - rightCode;
    }
  }
  return left.length - right.length;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  try {
    if (left.byteLength !== right.byteLength) {
      return false;
    }
    for (let index = 0; index < left.byteLength; index += 1) {
      if (left[index] !== right[index]) {
        return false;
      }
    }
    return true;
  } catch {
    fail("json-input");
  }
}

function copyBoundedBytes(
  value: Uint8Array,
  maximum: number,
  sizeCode: string,
  inputCode: string
): Uint8Array {
  try {
    if (!(value instanceof Uint8Array)) {
      fail(inputCode);
    }
    const intrinsicLength = intrinsicByteLength(value, inputCode);
    if (intrinsicLength > maximum) {
      fail(sizeCode);
    }
    const sliced = Uint8Array.prototype.slice.call(value);
    const copy = new Uint8Array(sliced);
    if (intrinsicByteLength(copy, inputCode) !== intrinsicLength) {
      fail(inputCode);
    }
    return copy;
  } catch (error) {
    if (error instanceof AuditEvidenceJsonError) {
      throw error;
    }
    fail(inputCode);
  }
}

function intrinsicByteLength(value: Uint8Array, inputCode: string): number {
  const descriptor = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(Uint8Array.prototype),
    "byteLength"
  );
  if (descriptor?.get === undefined) {
    fail(inputCode);
  }
  const length: unknown = descriptor.get.call(value);
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) {
    fail(inputCode);
  }
  return length;
}

function stringBytes(value: string): number {
  if (hasLoneSurrogate(value)) {
    fail("json-surrogate");
  }
  const length = encoder.encode(value).byteLength;
  if (length > MAX_AUDIT_EVIDENCE_STRING_BYTES) {
    fail("json-string-bytes");
  }
  return length;
}

function isRecordPrototype(value: object): boolean {
  const prototype = Reflect.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

function isCanonicalArrayIndex(key: string, length: number): boolean {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(key)) {
    return false;
  }
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < length && String(index) === key;
}

class CanonicalState {
  private tokenCount = 0;
  private objectMemberCount = 0;
  private arrayElementCount = 0;
  private outputBytes = 0;
  public constructor(public readonly integerOnly: boolean) {}

  public token(): void {
    this.tokenCount += 1;
    if (this.tokenCount > MAX_AUDIT_EVIDENCE_JSON_TOKENS) {
      fail("json-tokens");
    }
  }

  public objectMember(): void {
    this.objectMemberCount += 1;
    if (this.objectMemberCount > MAX_AUDIT_EVIDENCE_OBJECT_MEMBERS) {
      fail("json-object-members");
    }
  }

  public arrayElement(): void {
    this.arrayElementCount += 1;
    if (this.arrayElementCount > MAX_AUDIT_EVIDENCE_ARRAY_ELEMENTS) {
      fail("json-array-elements");
    }
  }

  public fragment(value: string): string {
    this.outputBytes += encoder.encode(value).byteLength;
    if (this.outputBytes > MAX_AUDIT_EVIDENCE_JSON_BYTES) {
      fail("json-size");
    }
    return value;
  }

  public punctuation(value: string): void {
    this.token();
    this.fragment(value);
  }

  public string(value: string): string {
    stringBytes(value);
    this.token();
    const serialized = JSON.stringify(value);
    if (typeof serialized !== "string") {
      fail("json-string");
    }
    return this.fragment(serialized);
  }
}

function jsonNumber(value: number, state: CanonicalState): string {
  if (
    !Number.isFinite(value) ||
    (state.integerOnly && (Object.is(value, -0) || !Number.isSafeInteger(value)))
  ) {
    fail("json-number");
  }
  const serialized = JSON.stringify(value);
  if (typeof serialized !== "string" || serialized.length > MAX_AUDIT_EVIDENCE_NUMBER_CHARS) {
    fail("json-number");
  }
  state.token();
  return state.fragment(serialized);
}

function canonicalizeValue(
  value: unknown,
  depth: number,
  state: CanonicalState,
  active: Set<object>
): string {
  if (depth > MAX_AUDIT_EVIDENCE_JSON_DEPTH) {
    fail("json-depth");
  }
  if (value === null) {
    state.token();
    return state.fragment("null");
  }
  if (typeof value === "boolean") {
    state.token();
    return state.fragment(value ? "true" : "false");
  }
  if (typeof value === "string") {
    return state.string(value);
  }
  if (typeof value === "number") {
    return jsonNumber(value, state);
  }
  if (typeof value !== "object") {
    fail("json-value");
  }
  if (isProxy(value)) {
    fail("json-proxy");
  }
  if (active.has(value)) {
    fail("json-cycle");
  }
  active.add(value);
  try {
    if (Array.isArray(value)) {
      const length = value.length;
      if (!Number.isSafeInteger(length) || length < 0) {
        fail("json-array");
      }
      if (length > MAX_AUDIT_EVIDENCE_ARRAY_ELEMENTS) {
        fail("json-array-elements");
      }
      const ownKeys = Reflect.ownKeys(value);
      if (
        ownKeys.length !== length + 1 ||
        ownKeys.some(
          (key) =>
            typeof key !== "string" || (key !== "length" && !isCanonicalArrayIndex(key, length))
        )
      ) {
        fail("json-array");
      }
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      if (
        lengthDescriptor === undefined ||
        !("value" in lengthDescriptor) ||
        lengthDescriptor.value !== length
      ) {
        fail("json-array");
      }
      const arrayItems: unknown[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (descriptor === undefined || !("value" in descriptor)) {
          fail("json-array");
        }
        arrayItems.push(descriptor.value);
      }
      state.punctuation("[");
      const items: string[] = [];
      for (let index = 0; index < arrayItems.length; index += 1) {
        state.arrayElement();
        if (index > 0) {
          state.punctuation(",");
        }
        items.push(canonicalizeValue(arrayItems[index], depth + 1, state, active));
      }
      state.punctuation("]");
      return "[" + items.join(",") + "]";
    }
    if (!isRecordPrototype(value)) {
      fail("json-object");
    }
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== "string")) {
      fail("json-object");
    }
    const entries: Array<{ name: string; value: unknown }> = [];
    for (const key of ownKeys) {
      const name = key as string;
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
        fail("json-object");
      }
      entries.push({ name, value: descriptor.value });
    }
    if (entries.length > MAX_AUDIT_EVIDENCE_OBJECT_MEMBERS) {
      fail("json-object-members");
    }
    entries.sort((left, right) => compareUtf16(left.name, right.name));
    state.punctuation("{");
    const members: string[] = [];
    for (let index = 0; index < entries.length; index += 1) {
      state.objectMember();
      if (index > 0) {
        state.punctuation(",");
      }
      const entry = entries[index];
      if (entry === undefined) {
        fail("json-object");
      }
      const key = state.string(entry.name);
      state.punctuation(":");
      const child = canonicalizeValue(entry.value, depth + 1, state, active);
      members.push(key + ":" + child);
    }
    state.punctuation("}");
    return "{" + members.join(",") + "}";
  } finally {
    active.delete(value);
  }
}

export function canonicalizeJsonValue(value: unknown): string {
  try {
    return canonicalizeValue(value, 1, new CanonicalState(false), new Set<object>());
  } catch (error) {
    if (error instanceof AuditEvidenceJsonError) {
      throw error;
    }
    fail("json-value");
  }
}

export function canonicalizeAuditEvidenceJsonValue(value: unknown): string {
  try {
    return canonicalizeValue(value, 1, new CanonicalState(true), new Set<object>());
  } catch (error) {
    if (error instanceof AuditEvidenceJsonError) {
      throw error;
    }
    fail("json-value");
  }
}

class StrictJsonParser {
  private index = 0;
  private tokenCount = 0;
  private objectMemberCount = 0;
  private arrayElementCount = 0;

  public constructor(private readonly source: string) {}

  public parse(): JsonValue {
    this.skipWhitespace();
    if (this.index >= this.source.length) {
      fail("json-empty");
    }
    const value = this.parseValue(1);
    this.skipWhitespace();
    if (this.index !== this.source.length) {
      fail("json-trailing");
    }
    return value;
  }

  private token(): void {
    this.tokenCount += 1;
    if (this.tokenCount > MAX_AUDIT_EVIDENCE_JSON_TOKENS) {
      fail("json-tokens");
    }
  }

  private objectMember(): void {
    this.objectMemberCount += 1;
    if (this.objectMemberCount > MAX_AUDIT_EVIDENCE_OBJECT_MEMBERS) {
      fail("json-object-members");
    }
  }

  private arrayElement(): void {
    this.arrayElementCount += 1;
    if (this.arrayElementCount > MAX_AUDIT_EVIDENCE_ARRAY_ELEMENTS) {
      fail("json-array-elements");
    }
  }

  private skipWhitespace(): void {
    while (isJsonWhitespace(this.source[this.index])) {
      this.index += 1;
    }
  }

  private consume(character: string): void {
    if (this.source[this.index] !== character) {
      fail("json-syntax");
    }
    this.index += 1;
    this.token();
  }

  private parseValue(depth: number): JsonValue {
    if (depth > MAX_AUDIT_EVIDENCE_JSON_DEPTH) {
      fail("json-depth");
    }
    const character = this.source[this.index];
    if (character === "{") {
      return this.parseObject(depth);
    }
    if (character === "[") {
      return this.parseArray(depth);
    }
    if (character === '"') {
      return this.parseStringToken();
    }
    if (character === "t") {
      return this.parseLiteral("true", true);
    }
    if (character === "f") {
      return this.parseLiteral("false", false);
    }
    if (character === "n") {
      return this.parseLiteral("null", null);
    }
    if (character !== undefined && JSON_NUMBER_START.test(character)) {
      return this.parseNumber();
    }
    fail("json-syntax");
  }

  private parseLiteral<T extends boolean | null>(literal: string, value: T): T {
    if (this.source.slice(this.index, this.index + literal.length) !== literal) {
      fail("json-syntax");
    }
    this.index += literal.length;
    this.token();
    return value;
  }

  private parseStringToken(): string {
    const start = this.index;
    if (this.source[this.index] !== '"') {
      fail("json-syntax");
    }
    this.index += 1;
    while (this.index < this.source.length) {
      const character = this.source[this.index];
      if (character === '"') {
        this.index += 1;
        const raw = this.source.slice(start, this.index);
        let value: unknown = undefined;
        try {
          value = JSON.parse(raw) as unknown;
        } catch {
          fail("json-syntax");
        }
        if (typeof value !== "string") {
          fail("json-syntax");
        }
        if (hasLoneSurrogate(value)) {
          fail("json-surrogate");
        }
        stringBytes(value);
        this.token();
        return value;
      }
      if (character === "\\") {
        const escape = this.source[this.index + 1];
        if (escape === "u") {
          for (let offset = 2; offset < 6; offset += 1) {
            const digit = this.source[this.index + offset];
            if (digit === undefined || !/^[0-9a-fA-F]$/u.test(digit)) {
              fail("json-syntax");
            }
          }
          this.index += 6;
        } else if (escape !== undefined && '"\\/bfnrt'.includes(escape)) {
          this.index += 2;
        } else {
          fail("json-syntax");
        }
        continue;
      }
      if (character === undefined) {
        fail("json-syntax");
      }
      if (character.charCodeAt(0) <= 0x1f) {
        fail("json-syntax");
      }
      this.index += 1;
    }
    fail("json-syntax");
  }

  private parseNumber(): number {
    const start = this.index;
    let nonIntegerSyntax = false;
    if (this.source[this.index] === "-") {
      this.index += 1;
    }
    const first = this.source[this.index];
    if (first === "0") {
      this.index += 1;
      if (isAsciiDigit(this.source[this.index])) {
        fail("json-number");
      }
    } else if (first !== undefined && first >= "1" && first <= "9") {
      this.index += 1;
      while (isAsciiDigit(this.source[this.index])) {
        this.index += 1;
      }
    } else {
      fail("json-number");
    }
    if (this.source[this.index] === ".") {
      nonIntegerSyntax = true;
      this.index += 1;
      const fractionStart = this.index;
      while (isAsciiDigit(this.source[this.index])) {
        this.index += 1;
      }
      if (this.index === fractionStart) {
        fail("json-number");
      }
    }
    if (this.source[this.index] === "e" || this.source[this.index] === "E") {
      nonIntegerSyntax = true;
      this.index += 1;
      if (this.source[this.index] === "+" || this.source[this.index] === "-") {
        this.index += 1;
      }
      const exponentStart = this.index;
      while (isAsciiDigit(this.source[this.index])) {
        this.index += 1;
      }
      if (this.index === exponentStart) {
        fail("json-number");
      }
    }
    const raw = this.source.slice(start, this.index);
    if (raw.length > MAX_AUDIT_EVIDENCE_NUMBER_CHARS) {
      fail("json-number");
    }
    if (nonIntegerSyntax) {
      fail("json-number");
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || Object.is(value, -0) || !Number.isSafeInteger(value)) {
      fail("json-number");
    }
    const continuation = this.source[this.index];
    if (continuation !== undefined && JSON_NUMBER_CONTINUATION.test(continuation)) {
      fail("json-number");
    }
    this.token();
    return value;
  }

  private parseObject(depth: number): { readonly [key: string]: JsonValue } {
    this.consume("{");
    const result = Object.create(null) as Record<string, JsonValue>;
    this.skipWhitespace();
    if (this.source[this.index] === "}") {
      this.consume("}");
      return result;
    }
    for (;;) {
      if (this.source[this.index] !== '"') {
        fail("json-syntax");
      }
      const name = this.parseStringToken();
      if (Object.prototype.hasOwnProperty.call(result, name)) {
        fail("json-duplicate-key");
      }
      this.skipWhitespace();
      this.consume(":");
      this.skipWhitespace();
      const value = this.parseValue(depth + 1);
      this.objectMember();
      Object.defineProperty(result, name, {
        configurable: true,
        enumerable: true,
        value,
        writable: true
      });
      this.skipWhitespace();
      if (this.source[this.index] === "}") {
        this.consume("}");
        return result;
      }
      if (this.source[this.index] !== ",") {
        fail("json-syntax");
      }
      this.consume(",");
      this.skipWhitespace();
    }
  }

  private parseArray(depth: number): JsonValue[] {
    this.consume("[");
    const result: JsonValue[] = [];
    this.skipWhitespace();
    if (this.source[this.index] === "]") {
      this.consume("]");
      return result;
    }
    for (;;) {
      const value = this.parseValue(depth + 1);
      this.arrayElement();
      result.push(value);
      this.skipWhitespace();
      if (this.source[this.index] === "]") {
        this.consume("]");
        return result;
      }
      if (this.source[this.index] !== ",") {
        fail("json-syntax");
      }
      this.consume(",");
      this.skipWhitespace();
    }
  }
}

export function parseStrictJsonBytes(bytes: Uint8Array): JsonValue {
  const raw = copyBoundedBytes(bytes, MAX_AUDIT_EVIDENCE_JSON_BYTES, "json-size", "json-input");
  if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
    fail("json-bom");
  }
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    fail("json-utf8");
  }
  return new StrictJsonParser(source).parse();
}

export function parseCanonicalJsonBytes(bytes: Uint8Array): JsonValue {
  const raw = copyBoundedBytes(bytes, MAX_AUDIT_EVIDENCE_JSON_BYTES, "json-size", "json-input");
  const value = parseStrictJsonBytes(raw);
  const canonical = encoder.encode(canonicalizeAuditEvidenceJsonValue(value));
  if (!sameBytes(raw, canonical)) {
    fail("json-noncanonical");
  }
  return value;
}

export function hashAuditEvidenceDomain(domain: string, bytes: Uint8Array): string {
  if (!DIGEST_DOMAINS.has(domain)) {
    fail("hash-domain-invalid");
  }
  const raw = copyBoundedBytes(
    bytes,
    MAX_AUDIT_EVIDENCE_JSON_BYTES,
    "hash-input-invalid",
    "hash-input-invalid"
  );
  return createHash("sha256")
    .update(encoder.encode(domain))
    .update(Uint8Array.of(0))
    .update(raw)
    .digest("hex");
}
