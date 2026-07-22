import { describe, expect, it } from "vitest";

import { auditPackageEntries, extractPackResult } from "../scripts/verify-package.mjs";

interface PackageAuditEntry {
  path: string;
  content: string;
}

const requiredEntries = (): PackageAuditEntry[] => [
  { path: "LICENSE", content: "MIT License" },
  { path: "README.md", content: "# ReviewReady" },
  {
    path: "package.json",
    content: JSON.stringify({
      name: "@ahoooooo/reviewready",
      version: "1.0.2",
      publishConfig: {
        access: "public",
        registry: "https://registry.npmjs.org"
      }
    })
  },
  { path: "reviewready.schema.json", content: "{}" },
  { path: "dist/cli.js", content: "console.log('safe');" },
  { path: "dist/cli.d.ts", content: "export {};" }
];

describe("auditPackageEntries", () => {
  it("accepts the documented package surface without private metadata", () => {
    expect(auditPackageEntries(requiredEntries())).toEqual([]);
  });

  it.each([
    ["email address", "contact maintainer@example.com"],
    ["Windows user path", String.raw`C:\Users\person\project`],
    ["POSIX user path", "/home/person/project"],
    ["private key", "-----BEGIN PRIVATE KEY-----"],
    ["GitHub token", `ghp_${"a".repeat(36)}`],
    ["npm token", `npm_${"a".repeat(36)}`],
    ["model provider key", `sk-ant-${"a".repeat(20)}`],
    ["AWS access key", `AKIA${"A".repeat(16)}`]
  ])("rejects a packaged %s", (_name, content) => {
    const entries = requiredEntries();
    entries.push({ path: "dist/report.js", content });

    expect(auditPackageEntries(entries)).not.toEqual([]);
  });

  it("rejects files outside the published allowlist", () => {
    const entries = requiredEntries();
    entries.push({ path: ".env", content: "SAFE=false" });

    expect(auditPackageEntries(entries)).toContain("Unexpected package file: .env");
  });

  it("rejects duplicate, unsafe, and binary package entries", () => {
    const entries = requiredEntries();
    entries.push({ path: "LICENSE", content: "duplicate" });
    entries.push({ path: "../dist/escape.js", content: "unsafe" });
    entries.push({ path: "dist/binary.js", content: "binary\0content" });

    expect(auditPackageEntries(entries)).toEqual(
      expect.arrayContaining([
        "Duplicate package file: LICENSE",
        "Unsafe package path: ../dist/escape.js",
        "Binary content is not allowed: dist/binary.js"
      ])
    );
  });

  it("rejects a package missing a required runtime file", () => {
    const entries = requiredEntries().filter((entry) => entry.path !== "dist/cli.js");

    expect(auditPackageEntries(entries)).toContain("Missing required package file: dist/cli.js");
  });

  it("rejects personal identity metadata in the package manifest", () => {
    const entries = requiredEntries();
    const manifest = entries.find((entry) => entry.path === "package.json");
    if (!manifest) {
      throw new Error("test fixture is missing package.json");
    }
    manifest.content = JSON.stringify({
      name: "@ahoooooo/reviewready",
      version: "1.0.2",
      author: "Private Person <private@example.com>",
      publishConfig: {
        access: "public",
        registry: "https://registry.npmjs.org"
      }
    });
    expect(auditPackageEntries(entries)).toEqual(
      expect.arrayContaining([
        "Personal identity field is not allowed in packaged package.json: author",
        "Sensitive email address found in package file: package.json"
      ])
    );
  });

  it.each([
    ["invalid JSON", "{", "Packaged package.json is not valid JSON"],
    ["a non-object", "null", "Packaged package.json must contain an object"]
  ])("rejects package manifests containing %s", (_name, content, expected) => {
    const entries = requiredEntries();
    const manifest = entries.find((entry) => entry.path === "package.json");
    if (!manifest) {
      throw new Error("test fixture is missing package.json");
    }
    manifest.content = content;

    expect(auditPackageEntries(entries)).toContain(expected);
  });

  it("rejects incorrect package identity and publication settings", () => {
    const entries = requiredEntries();
    const manifest = entries.find((entry) => entry.path === "package.json");
    if (!manifest) {
      throw new Error("test fixture is missing package.json");
    }
    manifest.content = JSON.stringify({
      name: "reviewready-copy",
      version: "latest",
      contributors: [],
      maintainers: [],
      publishConfig: {
        access: "restricted",
        registry: "https://example.invalid"
      }
    });

    expect(auditPackageEntries(entries)).toEqual(
      expect.arrayContaining([
        "Packaged package name must be @ahoooooo/reviewready",
        "Packaged package version must be valid semantic version text",
        "Packaged package must publish publicly to the official npm registry",
        "Personal identity field is not allowed in packaged package.json: contributors",
        "Personal identity field is not allowed in packaged package.json: maintainers"
      ])
    );
  });

  it("requires explicit public publication settings", () => {
    const entries = requiredEntries();
    const manifest = entries.find((entry) => entry.path === "package.json");
    if (!manifest) {
      throw new Error("test fixture is missing package.json");
    }
    manifest.content = JSON.stringify({
      name: "@ahoooooo/reviewready",
      version: "1.0.2"
    });

    expect(auditPackageEntries(entries)).toContain(
      "Packaged package must declare public npm publishConfig"
    );
  });
});

describe("extractPackResult", () => {
  it("accepts npm's package-name-keyed dry-run JSON", () => {
    const result = {
      files: [{ path: "package.json" }]
    };
    expect(extractPackResult({ "@ahoooooo/reviewready": result })).toBe(result);
  });

  it("accepts npm's legacy array dry-run JSON", () => {
    const result = {
      files: [{ path: "package.json" }]
    };
    expect(extractPackResult([result])).toBe(result);
  });

  it.each([null, [], [{ files: [{ missingPath: true }] }], { first: {}, second: {} }])(
    "rejects ambiguous or malformed dry-run JSON",
    (value) => {
      expect(extractPackResult(value)).toBeUndefined();
    }
  );
});
