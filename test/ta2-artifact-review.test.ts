import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { reviewSavedEvidence } from "../scripts/ta2-artifact-review.mjs";

const repository = "ahoooooooo/reviewready";
const revision = "a".repeat(40);

function bundleBytes(): Buffer {
  return Buffer.from(
    JSON.stringify({
      bundleVersion: 1,
      canonicalization: "RFC8785",
      subject: {},
      collection: {},
      assertions: {},
      snapshot: {},
      artifacts: {},
      report: {},
      integrity: {}
    }),
    "utf8"
  );
}

function replayBytes(status: "pass" | "fail" | "incomplete" = "pass"): Buffer {
  return Buffer.from(
    JSON.stringify({
      auditVersion: 1,
      status,
      repository: { owner: "ahoooooooo", name: "reviewready", baseSha: revision },
      findings: [],
      checked: []
    }) + "\n",
    "utf8"
  );
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function writeEvidence(root: string, status: "pass" | "fail" | "incomplete" = "pass") {
  const bundle = bundleBytes();
  const replay = replayBytes(status);
  writeFileSync(join(root, "evidence-bundle-v1.json"), bundle);
  writeFileSync(join(root, "replay.json"), replay);
  writeFileSync(
    join(root, "manifest.json"),
    JSON.stringify({
      version: 1,
      repository,
      revision,
      policyPath: ".reviewready.yml",
      protectedWorkflowPaths: [".github/workflows/reviewready-trusted.yml"],
      trustedWorkflowPaths: [".github/workflows/reviewready-trusted.yml"],
      bundleBytes: bundle.byteLength,
      bundleSha256: sha256(bundle),
      replayBytes: replay.byteLength,
      replaySha256: sha256(replay),
      status
    }) + "\n"
  );
  return { bundle, replay };
}

describe("saved TA-2 evidence review", () => {
  it("validates the exact saved files and replays without credentials", () => {
    const root = mkdtempSync(join(tmpdir(), "reviewready-ta2-artifact-review-test-"));
    const { bundle, replay } = writeEvidence(root);
    const calls: Array<{ args: readonly string[]; environment: NodeJS.ProcessEnv }> = [];
    try {
      const result = reviewSavedEvidence(root, repository, revision, {
        runReplay: (args, environment) => {
          calls.push({ args, environment });
          return { output: replay, exitCode: 0 };
        }
      });

      expect(result.status).toBe("pass");
      expect(result.bundleSha256).toBe(sha256(bundle));
      expect(calls).toHaveLength(1);
      expect(calls[0]?.args).toEqual([
        "audit",
        "replay",
        "--bundle",
        join(root, "evidence-bundle-v1.json"),
        "--bundle-sha256",
        sha256(bundle),
        "--json"
      ]);
      expect(calls[0]?.environment.GITHUB_TOKEN).toBeUndefined();
      expect(calls[0]?.environment.NODE_OPTIONS).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts fail and incomplete audit findings without changing their meaning", () => {
    for (const status of ["fail", "incomplete"] as const) {
      const root = mkdtempSync(join(tmpdir(), "reviewready-ta2-artifact-status-test-"));
      const { replay } = writeEvidence(root, status);
      try {
        expect(
          reviewSavedEvidence(root, repository, revision, {
            runReplay: () => ({ output: replay, exitCode: status === "fail" ? 1 : 2 })
          }).status
        ).toBe(status);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it.each(["extra file", "tampered replay", "manifest digest mismatch"])(
    "rejects a saved evidence directory with %s",
    (caseName) => {
      const root = mkdtempSync(join(tmpdir(), "reviewready-ta2-artifact-invalid-test-"));
      const { replay } = writeEvidence(root);
      try {
        if (caseName === "extra file") {
          writeFileSync(join(root, "unexpected.txt"), "untrusted");
        } else if (caseName === "tampered replay") {
          writeFileSync(join(root, "replay.json"), Buffer.concat([replay, Buffer.from("x")]));
        } else {
          const manifestPath = join(root, "manifest.json");
          const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
            replaySha256: string;
          };
          manifest.replaySha256 = "0".repeat(64);
          writeFileSync(manifestPath, JSON.stringify(manifest));
        }
        expect(() =>
          reviewSavedEvidence(root, repository, revision, {
            runReplay: () => ({ output: replay, exitCode: 0 })
          })
        ).toThrow();
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  );

  it("rejects replay output whose bytes or exit class differ from the saved result", () => {
    for (const mode of ["bytes", "exit"] as const) {
      const root = mkdtempSync(join(tmpdir(), "reviewready-ta2-artifact-replay-race-test-"));
      const { replay } = writeEvidence(root);
      try {
        expect(() =>
          reviewSavedEvidence(root, repository, revision, {
            runReplay: () => ({
              output: mode === "bytes" ? Buffer.concat([replay, Buffer.from("tampered")]) : replay,
              exitCode: mode === "exit" ? 1 : 0
            })
          })
        ).toThrow();
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it.skipIf(process.platform === "win32")("rejects symlinked evidence files", () => {
    const root = mkdtempSync(join(tmpdir(), "reviewready-ta2-artifact-symlink-test-"));
    const outside = mkdtempSync(join(tmpdir(), "reviewready-ta2-artifact-symlink-target-"));
    try {
      writeEvidence(root);
      rmSync(join(root, "replay.json"));
      writeFileSync(join(outside, "replay.json"), replayBytes());
      symlinkSync(join(outside, "replay.json"), join(root, "replay.json"), "file");
      expect(() =>
        reviewSavedEvidence(root, repository, revision, {
          runReplay: () => ({ output: replayBytes(), exitCode: 0 })
        })
      ).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
