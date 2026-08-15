import { describe, expect, it } from "vitest";

import {
  MAX_AUDIT_EVIDENCE_JSON_BYTES,
  canonicalizeJsonValue,
  canonicalizeAuditEvidenceJsonValue,
  hashAuditEvidenceDomain,
  parseCanonicalJsonBytes,
  parseStrictJsonBytes
} from "../src/audit-evidence.js";

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function expectCode(action: () => unknown, code: string): void {
  expect(action).toThrow(expect.objectContaining({ code }));
}

describe("audit evidence strict JSON and canonicalization", () => {
  it("canonicalizes object properties using RFC 8785 ordering", () => {
    const value = parseStrictJsonBytes(bytes('{"z":0,"a":1,"m":{"b":2,"a":3}}'));

    expect(canonicalizeJsonValue(value)).toBe('{"a":1,"m":{"a":3,"b":2},"z":0}');
  });

  it("rejects noncanonical raw bytes during canonical replay parsing", () => {
    expectCode(() => parseCanonicalJsonBytes(bytes('{ "a": 1 }\n')), "json-noncanonical");
    expectCode(() => parseCanonicalJsonBytes(bytes('{"b":2,"a":1}')), "json-noncanonical");
  });

  it("rejects duplicate decoded object names", () => {
    expectCode(() => parseStrictJsonBytes(bytes('{"a":1,"\\u0061":2}')), "json-duplicate-key");
  });

  it("rejects BOM, invalid UTF-8, and lone surrogate strings", () => {
    expectCode(
      () => parseStrictJsonBytes(Uint8Array.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d])),
      "json-bom"
    );
    expectCode(() => parseStrictJsonBytes(Uint8Array.from([0x7b, 0xff, 0x7d])), "json-utf8");
    expectCode(() => parseStrictJsonBytes(bytes('{"value":"\\ud800"}')), "json-surrogate");
  });

  it("accepts exactly 100000 lexical tokens and rejects one more", () => {
    const members = Array.from(
      { length: 20_000 },
      (_, index) => `"k${String(index)}":${index === 19_999 ? "0" : "[]"}`
    ).join(",");
    const atLimit = bytes(`{${members}}`);
    expect(() => parseStrictJsonBytes(atLimit)).not.toThrow();

    const memberLimitMembers = Array.from(
      { length: 20_000 },
      (_, index) => '"k' + String(index) + '":0'
    ).join(",");
    expectCode(
      () => parseStrictJsonBytes(bytes('{"extra":0,' + memberLimitMembers + "}")),
      "json-object-members"
    );
  });

  it("enforces depth and collection member bounds", () => {
    const depth32 = "[".repeat(31) + "0" + "]".repeat(31);
    const depth33 = "[".repeat(32) + "0" + "]".repeat(32);
    expect(() => parseStrictJsonBytes(bytes(depth32))).not.toThrow();
    expectCode(() => parseStrictJsonBytes(bytes(depth33)), "json-depth");
    const deepestEmptyContainer = "[".repeat(31) + "[]" + "]".repeat(31);
    expect(() => parseStrictJsonBytes(bytes(deepestEmptyContainer))).not.toThrow();

    const array = `[${Array.from({ length: 20_001 }, () => "0").join(",")}]`;
    expectCode(() => parseStrictJsonBytes(bytes(array)), "json-array-elements");
  });

  it("enforces total object members and array elements across nested containers", () => {
    const objectMembers = Array.from(
      { length: 19_999 },
      (_, index) => '"k' + String(index) + '":0'
    ).join(",");
    expectCode(
      () => parseStrictJsonBytes(bytes('{"root":{' + objectMembers + ',"nested":{"a":0,"b":0}}}')),
      "json-object-members"
    );
    const tokenLimitMembers = Array.from(
      { length: 20_000 },
      (_, index) => '"k' + String(index) + '":' + (index === 19_999 ? "[]" : "[]")
    ).join(",");
    expectCode(() => parseStrictJsonBytes(bytes("{" + tokenLimitMembers + "}")), "json-tokens");

    const arrayMembers = Array.from({ length: 19_999 }, () => "0").join(",");
    expectCode(
      () => parseStrictJsonBytes(bytes("[" + arrayMembers + ",[0,0]]")),
      "json-array-elements"
    );
  });

  it("rejects fractional and exponent number tokens for bundle JSON", () => {
    for (const value of ["1.0", "1e2", "9007199254740991.1"]) {
      expectCode(() => parseStrictJsonBytes(bytes(value)), "json-number");
    }
  });

  it("enforces total collection bounds while canonicalizing runtime values", () => {
    const objectValue: Record<string, unknown> = Object.fromEntries(
      Array.from({ length: 19_999 }, (_, index) => ["k" + String(index), 0])
    );
    objectValue.nested = { a: 0, b: 0 };
    expectCode(() => canonicalizeJsonValue(objectValue), "json-object-members");

    const arrayValue: unknown[] = Array.from({ length: 19_999 }, () => 0);
    arrayValue.push([0, 0]);
    expectCode(() => canonicalizeJsonValue(arrayValue), "json-array-elements");
  });

  it("rejects unsafe numeric values and canonicalizes safe integers", () => {
    expect(canonicalizeJsonValue({ value: 42 })).toBe('{"value":42}');
    expect(canonicalizeJsonValue({ value: 1.5 })).toBe('{"value":1.5}');
    expect(canonicalizeJsonValue({ value: 1e-7 })).toBe('{"value":1e-7}');
    expectCode(() => canonicalizeAuditEvidenceJsonValue({ value: 1.5 }), "json-number");
    expectCode(() => canonicalizeAuditEvidenceJsonValue({ value: 1e-7 }), "json-number");
    expect(canonicalizeJsonValue({ value: -0 })).toBe('{"value":0}');
    expectCode(() => canonicalizeAuditEvidenceJsonValue({ value: -0 }), "json-number");
    expectCode(
      () => canonicalizeAuditEvidenceJsonValue({ value: Number.MAX_SAFE_INTEGER + 1 }),
      "json-number"
    );
  });

  it("bounds canonical output and rejects hidden array properties", () => {
    const chunk = "x".repeat(4 * 1024 * 1024);
    expectCode(() => canonicalizeJsonValue([chunk, chunk]), "json-size");

    const hidden = [1];
    Object.defineProperty(hidden, "hidden", { enumerable: false, value: 2 });
    expectCode(() => canonicalizeJsonValue(hidden), "json-array");

    const symbol = [1];
    Object.defineProperty(symbol, Symbol("hidden"), { value: 2 });
    expectCode(() => canonicalizeJsonValue(symbol), "json-array");
  });

  it("does not trust a spoofed typed-array byteLength", () => {
    const payload = new Uint8Array(MAX_AUDIT_EVIDENCE_JSON_BYTES + 1);
    Object.defineProperty(payload, "byteLength", { configurable: true, value: 0 });
    expectCode(
      () => hashAuditEvidenceDomain("reviewready:audit-report:v1", payload),
      "hash-input-invalid"
    );
  });

  it("rejects proxy-backed runtime values before canonicalization", () => {
    const proxy = new Proxy({ value: 1 }, {});
    expectCode(() => canonicalizeJsonValue(proxy), "json-proxy");
  });

  it("domain-separates audit evidence hashes", () => {
    const payload = bytes("payload");
    expect(hashAuditEvidenceDomain("reviewready:audit-report:v1", payload)).toMatch(
      /^[0-9a-f]{64}$/u
    );
    expect(hashAuditEvidenceDomain("reviewready:audit-report:v1", payload)).not.toBe(
      hashAuditEvidenceDomain("reviewready:audit-bundle:v1", payload)
    );
  });

  it("rejects an invalid digest domain", () => {
    expectCode(() => hashAuditEvidenceDomain("unknown-domain", bytes("x")), "hash-domain-invalid");
  });

  it("rejects unsupported runtime shapes and preserves descriptor safety", () => {
    expectCode(() => canonicalizeJsonValue(undefined), "json-value");
    expectCode(() => canonicalizeJsonValue(Symbol("value")), "json-value");
    expectCode(() => canonicalizeJsonValue(Object.create({ inherited: 1 })), "json-object");
    expectCode(
      () => canonicalizeJsonValue(Object.create(null, { value: { value: 1 } })),
      "json-object"
    );
    expectCode(
      () =>
        canonicalizeJsonValue(
          Object.defineProperty({}, "value", { enumerable: true, get: () => 1 })
        ),
      "json-object"
    );

    const nonEnumerable = {};
    Object.defineProperty(nonEnumerable, "value", { enumerable: false, value: 1 });
    expectCode(() => canonicalizeJsonValue(nonEnumerable), "json-object");

    const hole = [] as unknown[];
    hole.length = 1;
    expectCode(() => canonicalizeJsonValue(hole), "json-array");

    const accessorArray = [1];
    Object.defineProperty(accessorArray, "0", {
      configurable: true,
      enumerable: true,
      get: () => 1
    });
    expectCode(() => canonicalizeJsonValue(accessorArray), "json-array");

    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expectCode(() => canonicalizeJsonValue(cycle), "json-cycle");
    expectCode(() => parseStrictJsonBytes({} as unknown as Uint8Array), "json-input");
  });

  it("parses valid JSON branches and rejects strict syntax variants", () => {
    const parsed = parseStrictJsonBytes(
      bytes(String.raw`{"a":[true,false,null,-1,0,42],"s":"\b\f\n\r\t\/\\\"\u0061"}`)
    );
    expect(parsed).toEqual({
      a: [true, false, null, -1, 0, 42],
      s: '\b\f\n\r\t/\\"a'
    });
    expect(parseStrictJsonBytes(bytes("{}"))).toEqual(Object.create(null));
    expect(parseStrictJsonBytes(bytes("[]"))).toEqual([]);

    const cases: readonly [string, string][] = [
      ["", "json-empty"],
      [" ", "json-empty"],
      ["truex", "json-trailing"],
      ["tru", "json-syntax"],
      ["{", "json-syntax"],
      ["[", "json-syntax"],
      ["{x:1}", "json-syntax"],
      ['{"a" 1}', "json-syntax"],
      ['{"a":1 "b":2}', "json-syntax"],
      ["[1 2]", "json-syntax"],
      ["[1,]", "json-syntax"],
      ['{"a":1,}', "json-syntax"],
      ["1.", "json-number"],
      ["1e", "json-number"],
      ["1e+", "json-number"],
      ["01", "json-number"],
      ["-", "json-number"],
      ["-.", "json-number"],
      ["1e2", "json-number"],
      ["1.0", "json-number"],
      ["-0", "json-number"],
      ["9007199254740992", "json-number"],
      ["9".repeat(33), "json-number"]
    ];
    for (const [source, code] of cases) {
      expectCode(() => parseStrictJsonBytes(bytes(source)), code);
    }
  });

  it("rejects malformed strings and invalid byte boundaries", () => {
    for (const source of ['"unterminated', '"\\q"', '"\\u12"', '"\\u12xz"']) {
      expectCode(() => parseStrictJsonBytes(bytes(source)), "json-syntax");
    }
    expectCode(() => parseStrictJsonBytes(bytes('"line\nfeed"')), "json-syntax");
    expectCode(() => parseStrictJsonBytes(bytes('"\\udc00"')), "json-surrogate");
    expectCode(() => parseStrictJsonBytes(Uint8Array.from([0xc3, 0x28])), "json-utf8");
    expectCode(() => parseCanonicalJsonBytes(bytes("null\n")), "json-noncanonical");
  });
});
