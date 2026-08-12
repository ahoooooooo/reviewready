import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const workflow = await readFile(".github/workflows/reviewready-trusted.yml", "utf8");

describe("trusted ReviewReady workflow", () => {
  it("runs from pull_request_target with a fully immutable Action pin", () => {
    expect(workflow).toContain("pull_request_target:");
    expect(workflow).toMatch(/uses: ahooooooo\/reviewready@[0-9a-f]{40}(?:\s+#.*)?\r?\n/u);
    expect(workflow).not.toMatch(/uses: ahooooooo\/reviewready@(?:main|v1|latest)\b/u);
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
