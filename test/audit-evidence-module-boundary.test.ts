import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import * as artifact from "../src/audit-evidence-artifact.js";
import * as bundle from "../src/audit-evidence-bundle.js";
import { AuditEvidenceBundleError } from "../src/audit-evidence-bundle-primitives.js";

async function lineCount(path: string): Promise<number> {
  return (await readFile(path, "utf8")).split("\n").length;
}

describe("audit evidence module boundary", () => {
  it("separates artifacts, primitives, and hydration behind the compatible facade", async () => {
    const [facade, hydration] = await Promise.all([
      readFile("src/audit-evidence-bundle.ts", "utf8"),
      readFile("src/audit-evidence-hydration.ts", "utf8")
    ]);

    expect(await lineCount("src/audit-evidence-bundle.ts")).toBeLessThan(1_650);
    expect(await lineCount("src/audit-evidence-artifact.ts")).toBeLessThan(160);
    expect(await lineCount("src/audit-evidence-bundle-primitives.ts")).toBeLessThan(200);
    expect(await lineCount("src/audit-evidence-hydration.ts")).toBeLessThan(380);
    expect(facade).toContain('export * from "./audit-evidence-artifact.js"');
    expect(hydration).not.toContain("./audit-evidence-bundle.js");
    expect(bundle.encodeAuditEvidenceBase64url).toBe(artifact.encodeAuditEvidenceBase64url);
    expect(bundle.verifyAuditEvidenceSourceArtifact).toBe(
      artifact.verifyAuditEvidenceSourceArtifact
    );
    expect(bundle.AuditEvidenceBundleError).toBe(AuditEvidenceBundleError);
  });
});
