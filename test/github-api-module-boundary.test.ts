import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

async function lineCount(path: string): Promise<number> {
  return (await readFile(path, "utf8")).split("\n").length;
}

describe("GitHub API module boundary", () => {
  it("keeps transport, retry, and pagination responsibilities independently bounded", async () => {
    const [transport, boundaries, pagination] = await Promise.all([
      readFile("src/github-api.ts", "utf8"),
      readFile("src/github-api-boundaries.ts", "utf8"),
      readFile("src/github-api-pagination.ts", "utf8")
    ]);

    expect(await lineCount("src/github-api.ts")).toBeLessThan(800);
    expect(await lineCount("src/github-api-boundaries.ts")).toBeLessThan(200);
    expect(await lineCount("src/github-api-pagination.ts")).toBeLessThan(320);
    expect(transport).toContain('from "./github-api-boundaries.js"');
    expect(transport).toContain('from "./github-api-pagination.js"');
    expect(boundaries).not.toContain("@actions/github");
    expect(pagination).not.toContain("@actions/github");
  });
});
