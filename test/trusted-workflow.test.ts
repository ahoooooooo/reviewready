import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const packageManifest = JSON.parse(await readFile("package.json", "utf8")) as { version?: unknown };
const workflow = await readFile(".github/workflows/reviewready-trusted.yml", "utf8");
const readme = await readFile("README.md", "utf8");
const changelog = await readFile("CHANGELOG.md", "utf8");
const canonicalRepository = `ah${"o".repeat(8)}/reviewready`;
const publishedReleaseCommit = "bffe33502395ce27ab046efa242789d6b25333de";
const documentedAdvisoryCommit = "f21ed2e94efedb01f73e518c39765cef72c58e1c";

describe("trusted ReviewReady workflow", () => {
  it("uses the canonical GitHub repository as its immutable trust root", () => {
    expect(workflow).toContain(`uses: ${canonicalRepository}@`);
  });

  it("keeps the documented Action examples on the canonical trust root", () => {
    expect(readme).toContain(`uses: ${canonicalRepository}@`);
    expect(readme).not.toContain("uses: ahooooooo/reviewready@");
  });

  it("runs from pull_request_target with a fully immutable Action pin", () => {
    expect(workflow).toContain("pull_request_target:");
    expect(workflow).toMatch(
      new RegExp(
        `uses: ${canonicalRepository.replace("/", "\\/")}@[0-9a-f]{40}(?:\\s+#.*)?\\r?\\n`,
        "u"
      )
    );
    expect(workflow).not.toMatch(
      new RegExp(`uses: ${canonicalRepository.replace("/", "\\/")}@(?:main|v1|latest)\\b`, "u")
    );
    expect(workflow).not.toContain(
      "uses: " + canonicalRepository + "@1b6856635d122e48075f709a757d25deb865c4f0"
    );
  });

  it("pins the trusted root to the published v1.0.10 release and keeps the published advisory example immutable", () => {
    expect(workflow).toContain(`uses: ${canonicalRepository}@${publishedReleaseCommit} # v1.0.10`);
    expect(readme).toContain(`uses: ${canonicalRepository}@${documentedAdvisoryCommit} # v1.0.7`);
    expect(workflow).not.toContain("main v1.0.6 candidate");
    expect(readme).not.toContain("v1.0.5 bootstrap pin");
  });

  it("keeps the package version, README status, and changelog release aligned", () => {
    expect(typeof packageManifest.version).toBe("string");
    const version = String(packageManifest.version);
    expect(readme).toContain(`latest published CLI and Action are v${version}`);
    expect(changelog).toContain(`## [${version}]`);
  });

  it("has read-only permissions and never checks out or runs pull-request code", () => {
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("pull-requests: read");
    expect(workflow).toContain("checks: read");
    expect(workflow).toContain("statuses: read");
    expect(workflow).toContain("issues: read");
    expect(workflow).not.toContain("actions/checkout");
    expect(workflow).not.toMatch(/^\s+- run:/mu);
  });
});
