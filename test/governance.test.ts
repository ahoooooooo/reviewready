import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("open-source governance baseline", () => {
  it("publishes ownership, decision, maintainer, support, and conduct paths", async () => {
    const [codeowners, governance, maintainers, support, contributing] = await Promise.all([
      readFile(".github/CODEOWNERS", "utf8"),
      readFile("GOVERNANCE.md", "utf8"),
      readFile("MAINTAINERS.md", "utf8"),
      readFile("SUPPORT.md", "utf8"),
      readFile("CONTRIBUTING.md", "utf8")
    ]);

    expect(codeowners).toMatch(/^\* @ahoooooooo$/mu);
    expect(codeowners).toContain("/.github/workflows/ @ahoooooooo");
    expect(codeowners).toContain("/SECURITY.md @ahoooooooo");

    for (const path of ["MAINTAINERS.md", "CODE_OF_CONDUCT.md", "SUPPORT.md", "SECURITY.md"]) {
      expect(governance).toContain(path);
    }
    expect(maintainers).toContain("@ahoooooooo");
    expect(maintainers).toContain("GOVERNANCE.md");
    expect(support).toContain("GitHub Discussions");
    expect(support).toContain("SECURITY.md");
    expect(contributing).toContain("GOVERNANCE.md");
    expect(contributing).toContain("SUPPORT.md");
  });

  it("routes every governance file through the trust-boundary policy", async () => {
    const policy = await readFile(".reviewready.yml", "utf8");

    for (const path of [
      "CODE_OF_CONDUCT.md",
      "CONTRIBUTING.md",
      "GOVERNANCE.md",
      "MAINTAINERS.md",
      "ROADMAP.md",
      "SECURITY.md",
      "SUPPORT.md"
    ]) {
      expect(policy).toContain(`- "${path}"`);
    }
  });
});
