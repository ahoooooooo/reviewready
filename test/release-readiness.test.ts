import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  normalizePackagedPath,
  runReleasePreflight,
  sha512Hex
} from "../scripts/release-preflight.mjs";

describe("release readiness metadata", () => {
  it("documents the package candidate version in the changelog", async () => {
    const packageManifest = JSON.parse(await readFile("package.json", "utf8")) as {
      version?: unknown;
    };
    const version = packageManifest.version;
    const changelog = await readFile("CHANGELOG.md", "utf8");

    expect(typeof version).toBe("string");
    expect(changelog).toContain(`## [${String(version)}]`);
  });

  it("keeps release artifact hashing deterministic and rejects unsafe tar paths", () => {
    expect(sha512Hex("ReviewReady")).toHaveLength(128);
    expect(normalizePackagedPath("package/dist/cli.js")).toBe("package/dist/cli.js");
    expect(() => normalizePackagedPath("package/../outside.js")).toThrow("unsafe package path");
  });

  it("runs the exact artifact and clean-room preflight against a requested artifact directory", async () => {
    const artifactDirectory = await mkdtemp(join(tmpdir(), "reviewready-preflight-test-"));
    try {
      const result = runReleasePreflight(process.cwd(), artifactDirectory);

      expect(result.fileCount).toBeGreaterThan(0);
      expect(result.sha512).toMatch(/^[0-9a-f]{128}$/u);
    } finally {
      await rm(artifactDirectory, { recursive: true, force: true });
    }
  }, 120_000);
});
