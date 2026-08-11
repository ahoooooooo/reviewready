import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertActionBundleSynchronized,
  assertReleaseMetadata,
  assertReleaseProvenance,
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

  it("rejects a bundle mutation during release preflight", () => {
    expect(() => {
      assertActionBundleSynchronized("", " M dist/action/index.js");
    }).toThrow("Action bundle changed during release preflight");
  });

  it("requires package, lockfile, and changelog release metadata to agree", () => {
    expect(() => {
      assertReleaseMetadata({
        packageVersion: "1.0.5",
        lockVersion: "1.0.4",
        changelog: "## [1.0.5] - 2026-08-12"
      });
    }).toThrow("package and lockfile versions must match");
  });

  it("rejects a release whose stable Action tag drifts from the verified commit", () => {
    const commit = "a".repeat(40);
    const localSha512 = "b".repeat(128);
    const integrity = "sha512-" + Buffer.from(localSha512, "hex").toString("base64");

    expect(() => {
      assertReleaseProvenance({
        packageName: "@ahoooooo/reviewready",
        version: "1.0.5",
        packageVersion: "1.0.5",
        lockVersion: "1.0.5",
        mainCommit: commit,
        immutableTagCommit: commit,
        stableTagCommit: "c".repeat(40),
        npmVersion: "1.0.5",
        npmLatestVersion: "1.0.5",
        previousVersion: "1.0.4",
        previousNpmVersion: "1.0.4",
        localSha512,
        registryIntegrity: integrity,
        registryShasum: "d".repeat(40),
        tarballUrl: "https://registry.npmjs.org/@ahoooooo/reviewready/-/reviewready-1.0.5.tgz",
        releaseUrl: "https://github.com/ahoooooooo/reviewready/releases/tag/v1.0.5",
        releaseTarget: commit
      });
    }).toThrow("stable Action tag");
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
