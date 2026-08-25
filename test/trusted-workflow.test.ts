import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const packageManifest = JSON.parse(await readFile("package.json", "utf8")) as { version?: unknown };
const workflow = await readFile(".github/workflows/reviewready-trusted.yml", "utf8");
const readme = await readFile("README.md", "utf8");
const security = await readFile("SECURITY.md", "utf8");
const architecture = await readFile("docs/architecture.md", "utf8");
const changelog = await readFile("CHANGELOG.md", "utf8");
const canonicalRepository = `ah${"o".repeat(8)}/reviewready`;
const publishedReleaseCommit = "e9cd421ac106adb5731dd22b714701a136e937f8";

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

  it("pins the trusted and documented Action examples to the published v1.0.11 release", () => {
    expect(workflow).toContain(`uses: ${canonicalRepository}@${publishedReleaseCommit} # v1.0.11`);
    expect(readme).toContain(`uses: ${canonicalRepository}@${publishedReleaseCommit} # v1.0.11`);
    expect(workflow).not.toContain("main v1.0.6 candidate");
    expect(readme).not.toContain("v1.0.5 bootstrap pin");
  });

  it("keeps public trust-boundary docs independent of closed tracker issues", () => {
    for (const document of [readme, security, architecture]) {
      expect(document).not.toMatch(/(?:#78|#79|\/issues\/(?:78|79)\b)/u);
    }
    expect(readme).toContain("does not provide a production GitHub App");
    expect(security).toContain("does not ship a hosted");
    expect(architecture).toContain("does not provide a hosted");
  });

  it("keeps package release text authoritative and changelog-aligned", () => {
    expect(typeof packageManifest.version).toBe("string");
    const version = String(packageManifest.version);
    expect(readme).toContain("The npm registry and GitHub Releases are authoritative");
    expect(readme).not.toContain("This commit prepares the");
    expect(readme).not.toContain("candidate checklist");
    expect(readme).toContain("/v1.0.12/reviewready.schema.json");
    expect(readme).toContain(
      "The v" +
        version +
        " package includes bounded " +
        String.fromCharCode(96) +
        "audit collect" +
        String.fromCharCode(96) +
        " and offline " +
        String.fromCharCode(96) +
        "audit replay" +
        String.fromCharCode(96)
    );
    expect(changelog).toContain("## [" + version + "]");
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

  it("waits for the latest trusted CI check before evaluating readiness", () => {
    expect(workflow).toContain(
      "group: reviewready-trusted-${{ github.event.pull_request.number }}"
    );
    expect(workflow).toContain("cancel-in-progress: true");
    expect(workflow).toContain("id: wait-for-check");
    expect(workflow).toContain(
      "uses: actions/github-script@ed597411d8f924073f98dfc5c65a23a2325f34cd # v8.0.0"
    );
    expect(workflow).toContain("const maxAttempts = 60");
    expect(workflow).toContain("const delayMs = 5000");
    expect(workflow).toContain("checks.listForRef");
    expect(workflow).toContain("per_page: 100");
    expect(workflow).toContain('run?.name === "check"');
    expect(workflow).toContain('latest?.status === "completed"');
    expect(workflow.indexOf("id: wait-for-check")).toBeLessThan(
      workflow.indexOf("name: Evaluate pull-request evidence")
    );
  });
});
