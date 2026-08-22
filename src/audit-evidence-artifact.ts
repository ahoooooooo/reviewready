import { createHash } from "node:crypto";

import {
  fail,
  hasExactKeys,
  isRecord,
  repositoryPath,
  requiredNumber,
  requiredString,
  SHA1,
  SHA256,
  workflowPath
} from "./audit-evidence-bundle-primitives.js";

export const MAX_AUDIT_EVIDENCE_SOURCE_BYTES = 262_144;
export const MAX_AUDIT_EVIDENCE_BASE64URL_CHARS =
  Math.floor(MAX_AUDIT_EVIDENCE_SOURCE_BYTES / 3) * 4 +
  (MAX_AUDIT_EVIDENCE_SOURCE_BYTES % 3 === 0 ? 0 : (MAX_AUDIT_EVIDENCE_SOURCE_BYTES % 3) + 1);

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const BASE64_VALUE = new Map(
  Array.from(BASE64_ALPHABET).map((character, index) => [character, index])
);

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
