import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  auditPackageEntries,
  extractPackResult,
  loadPlannedPackageEntries
} from "../scripts/verify-package.mjs";
import { readStableArtifact } from "../scripts/package-smoke.mjs";
import { hydrateAuditEvidenceBundle } from "../src/audit-evidence-bundle.js";
import { parseCanonicalJsonBytes } from "../src/audit-evidence.js";

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
  { path: "reviewready.audit.schema.json", content: "{}" },
  { path: "reviewready.audit-evidence.schema.json", content: "{}" },
  { path: "reviewready.result.schema.json", content: "{}" },
  { path: "dist/cli.js", content: "console.log('safe');" },
  { path: "dist/cli.d.ts", content: "export {};" }
];

describe("auditPackageEntries", () => {
  it("ships a separate versioned readiness result schema", async () => {
    const schema = JSON.parse(await readFile("reviewready.result.schema.json", "utf8")) as {
      properties?: { outputVersion?: { const?: unknown } };
      required?: readonly string[];
    };

    expect(schema.properties?.outputVersion?.const).toBe(1);
    expect(schema.required).toEqual(
      expect.arrayContaining([
        "outputVersion",
        "status",
        "policyVersion",
        "triggeredRules",
        "requirements"
      ])
    );
  });

  it("builds distributable runtime files before auditing the package", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts?: { check?: string };
    };
    const checkScript = packageJson.scripts?.check;
    if (typeof checkScript !== "string") {
      throw new Error("package.json is missing the check script");
    }

    const checkSteps = checkScript.split(" && ").map((step) => step.trim());
    const buildStep = checkSteps.indexOf("npm run bundle");
    const distVerificationSteps = checkSteps.reduce<number[]>((indexes, step, index) => {
      if (step === "npm run verify:dist") {
        indexes.push(index);
      }
      return indexes;
    }, []);
    const packageAuditStep = checkSteps.indexOf("npm run test:coverage");
    const packageVerificationStep = checkSteps.indexOf("npm run verify:package");
    expect(checkSteps).toEqual(
      expect.arrayContaining([
        "npm run bundle",
        "npm run verify:dist",
        "npm run test:coverage",
        "npm run verify:package"
      ])
    );
    expect(buildStep).toBeGreaterThanOrEqual(0);
    expect(distVerificationSteps).toHaveLength(1);
    expect(distVerificationSteps[0]).toBeGreaterThan(buildStep);
    expect(packageAuditStep).toBeGreaterThanOrEqual(0);
    expect(packageVerificationStep).toBeGreaterThan(packageAuditStep);
    expect(buildStep).toBeLessThan(packageAuditStep);
    expect(distVerificationSteps[0]).toBeLessThan(packageAuditStep);
    expect(buildStep).toBeLessThan(packageVerificationStep);
  });

  it("keeps generated dist parity owned by the complete gate", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts?: { check?: string; [key: string]: unknown };
    };
    const workflow = await readFile(".github/workflows/ci.yml", "utf8");

    expect(packageJson.scripts?.["verify:dist"]).toBe("node scripts/verify-dist.mjs");
    expect(packageJson.scripts?.check).toContain("npm run verify:dist");
    expect(workflow).not.toContain("run: npm run verify:dist");
  });

  it("keeps the compatibility gate from rebuilding generated parity", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts?: { check?: string; ["check:compat"]?: string };
    };
    const workflow = await readFile(".github/workflows/ci.yml", "utf8");
    const compatibility = packageJson.scripts?.["check:compat"];

    expect(workflow).toContain("run: npm run check:compat");
    expect(compatibility).toContain("npm run bundle");
    expect(compatibility).toContain("npm run verify:dist");
  });

  it("keeps the built-in TA-2 workflow token to checkout-only scope", async () => {
    const workflow = await readFile(".github/workflows/reviewready-ta2-promotion.yml", "utf8");

    expect(workflow).toContain("permissions:\n  contents: read\n\nconcurrency:");
    for (const scope of ["pull-requests", "checks", "statuses", "issues"]) {
      expect(workflow).not.toContain("\n  " + scope + ": read");
    }
    expect(workflow).not.toMatch(
      /^\s+(?:contents|pull-requests|checks|statuses|issues):\s+write$/mu
    );
  });

  it("includes every TA-2 runtime module in the coverage gate", async () => {
    const config = await readFile("vitest.config.ts", "utf8");

    for (const module of [
      "src/audit-evidence.ts",
      "src/audit-evidence-bundle.ts",
      "src/audit-evidence-collection.ts",
      "src/cli.ts",
      "src/file-reader.ts"
    ]) {
      expect(config).toContain(`"${module}"`);
    }
  });

  it("defines a narrow CLI package surface and pins runtime dependencies", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      dependencies?: Record<string, string>;
      exports?: Record<string, unknown>;
    };

    expect(packageJson.exports).toEqual({
      ".": {
        types: "./dist/cli.d.ts",
        default: "./dist/cli.js"
      },
      "./package.json": "./package.json",
      "./reviewready.schema.json": "./reviewready.schema.json",
      "./reviewready.audit.schema.json": "./reviewready.audit.schema.json",
      "./reviewready.audit-evidence.schema.json": "./reviewready.audit-evidence.schema.json",
      "./reviewready.result.schema.json": "./reviewready.result.schema.json"
    });
    expect(
      Object.values(packageJson.dependencies ?? {}).every((value) => /^\d+\.\d+\.\d+$/u.test(value))
    ).toBe(true);
  });

  it("labels the TA-2 evidence commands as released in package version 1.0.10", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      version?: unknown;
    };
    const readme = await readFile("README.md", "utf8");

    expect(packageJson.version).toBe("1.0.10");
    expect(readme).toContain("latest published CLI and Action are v1.0.10");
    expect(readme).toContain("available in the published 1.0.10 package");
  });

  it("keeps a canonical TA-2 evidence fixture replayable", async () => {
    const bytes = await readFile("fixtures/audit/evidence-bundle-v1.json");
    const bundle = parseCanonicalJsonBytes(bytes);
    expect(hydrateAuditEvidenceBundle(bundle).report.status).toBe("pass");
  });

  it("exercises the TA-2 public surface in clean-room smoke scripts", async () => {
    const packageSmoke = await readFile("scripts/package-smoke.mjs", "utf8");
    const releasePreflight = await readFile("scripts/release-preflight.mjs", "utf8");

    expect(packageSmoke).toContain("audit");
    expect(packageSmoke).toContain("verifyInstalledSourceMaps");
    expect(packageSmoke).toContain("reviewready.audit-evidence.schema.json");
    expect(releasePreflight).toContain("audit");
    expect(releasePreflight).toContain("reviewready.audit-evidence.schema.json");
  });

  it("bounds package smoke and package manifest subprocesses", async () => {
    const packageSmoke = await readFile("scripts/package-smoke.mjs", "utf8");
    const verifyPackage = await readFile("scripts/verify-package.mjs", "utf8");

    expect(packageSmoke).toContain("const MAX_CHILD_PROCESS_MS =");
    expect(packageSmoke).toContain("timeout: MAX_CHILD_PROCESS_MS");
    expect(verifyPackage).toContain("const MAX_CHILD_PROCESS_MS =");
    expect(verifyPackage).toContain("timeout: MAX_CHILD_PROCESS_MS");
  });

  it("bounds package manifest file count, path length, and content bytes", async () => {
    const verifyPackage = await readFile("scripts/verify-package.mjs", "utf8");

    expect(verifyPackage).toContain("MAX_PACKAGE_ENTRIES");
    expect(verifyPackage).toContain("MAX_PACKAGE_PATH_BYTES");
    expect(verifyPackage).toContain("MAX_PACKAGE_FILE_BYTES");
    expect(verifyPackage).toContain("MAX_PACKAGE_TOTAL_BYTES");
  });

  it("rejects a package artifact replaced after its descriptor is opened", () => {
    const root = mkdtempSync(join(tmpdir(), "reviewready-package-artifact-race-test-"));
    const artifact = join(root, "package.tgz");
    try {
      writeFileSync(artifact, "trusted");
      expect(() =>
        readStableArtifact(artifact, () => {
          rmSync(artifact, { force: true });
          writeFileSync(artifact, "tampered");
        })
      ).toThrow("changed");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("describes TA-2 settings sampling as stable observation rather than atomic", async () => {
    const plan = await readFile("docs/exec-plans/active/post-v1.md", "utf8");

    expect(plan).toContain("stable double observation");
    expect(plan).not.toContain("atomic settings sampling");
  });

  it("uses the checked-in trusted workflow in live audit examples", async () => {
    const readme = await readFile("README.md", "utf8");

    expect(readme).toContain("--protected-workflow .github/workflows/reviewready-trusted.yml");
    expect(readme).toContain("--trusted-workflow .github/workflows/reviewready-trusted.yml");
    expect(readme).not.toContain("--protected-workflow .github/workflows/reviewready.yml");
    expect(readme).not.toContain("--trusted-workflow .github/workflows/reviewready.yml");
  });

  it("accepts the documented package surface without private metadata", () => {
    expect(auditPackageEntries(requiredEntries())).toEqual([]);
  });

  it("accepts generated source maps referenced by published runtime files", () => {
    const entries = requiredEntries();
    const runtime = entries.find((entry) => entry.path === "dist/cli.js");
    const declarations = entries.find((entry) => entry.path === "dist/cli.d.ts");
    if (!runtime || !declarations) {
      throw new Error("test fixture is missing generated runtime files");
    }
    runtime.content += "\n//# sourceMappingURL=cli.js.map\n";
    declarations.content += "\n//# sourceMappingURL=cli.d.ts.map\n";
    entries.push(
      { path: "dist/cli.js.map", content: "{}" },
      { path: "dist/cli.d.ts.map", content: "{}" }
    );

    expect(auditPackageEntries(entries)).toEqual([]);
  });

  it("declares generated source maps in the npm package surface", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      files?: unknown;
    };

    expect(packageJson.files).toEqual(expect.arrayContaining(["dist/*.js.map", "dist/*.d.ts.map"]));
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

  it("audits the exact npm dry-run package manifest from the repository", () => {
    const entries = loadPlannedPackageEntries(process.cwd());

    expect(entries.length).toBeGreaterThan(0);
    expect(auditPackageEntries(entries)).toEqual([]);
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
