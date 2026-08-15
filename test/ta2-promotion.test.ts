import { readFile } from "node:fs/promises";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { createHash } from "node:crypto";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  PROMOTION_EVENT_NAMES,
  PROMOTION_REPOSITORY,
  PROMOTION_REF,
  PROMOTION_TRUSTED_WORKFLOW,
  runPromotion,
  validatePromotionEnvironment
} from "../scripts/ta2-promotion.mjs";

const sha = "a".repeat(40);
const runnerTemp = process.platform === "win32" ? "D:/runner-temp" : "/tmp/runner-temp";

function environment(): Record<string, string> {
  return {
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REPOSITORY: PROMOTION_REPOSITORY,
    GITHUB_REF: PROMOTION_REF,
    GITHUB_WORKFLOW_REF:
      PROMOTION_REPOSITORY + "/.github/workflows/reviewready-ta2-promotion.yml@" + PROMOTION_REF,
    GITHUB_SHA: sha,
    GITHUB_TOKEN: "read-only-token",
    RUNNER_TEMP: runnerTemp
  };
}

function bundleBytes(padding = ""): Buffer {
  return Buffer.from(
    JSON.stringify({
      bundleVersion: 1,
      canonicalization: "RFC8785",
      subject: {},
      collection: { padding },
      assertions: {},
      snapshot: {},
      artifacts: {},
      report: {},
      integrity: {}
    }),
    "utf8"
  );
}

function reportBytes(status: "pass" | "fail" | "incomplete" = "pass"): Buffer {
  return Buffer.from(
    JSON.stringify({
      auditVersion: 1,
      status,
      repository: { owner: "ahoooooooo", name: "reviewready", baseSha: sha },
      findings: [],
      checked: []
    }) + "\n",
    "utf8"
  );
}

function parentVisibleChildPath(path: string, childEnvironment: NodeJS.ProcessEnv): string {
  const childDescriptorPrefix = "/proc/self/fd/3/";
  if (!path.startsWith(childDescriptorPrefix)) {
    return path;
  }
  if (typeof childEnvironment.RUNNER_TEMP !== "string") {
    throw new Error("runner temp is missing");
  }
  return join(childEnvironment.RUNNER_TEMP, "reviewready-ta2", basename(path));
}

describe("trusted TA-2 promotion entrypoint", () => {
  it("accepts only the fixed repository, main ref, exact SHA, and bounded token", () => {
    expect(validatePromotionEnvironment(environment(), [])).toEqual({
      repository: PROMOTION_REPOSITORY,
      revision: sha,
      outputRoot: join(runnerTemp, "reviewready-ta2")
    });
  });

  it.each([
    ["repository", { GITHUB_REPOSITORY: "attacker/repo" }],
    ["ref", { GITHUB_REF: "refs/heads/feature" }],
    ["event", { GITHUB_EVENT_NAME: "pull_request" }],
    ["sha", { GITHUB_SHA: "not-a-sha" }],
    ["token", { GITHUB_TOKEN: "" }],
    ["runner temp", { RUNNER_TEMP: "relative-temp" }]
  ])("rejects an untrusted %s promotion environment", (_name, override) => {
    expect(() => validatePromotionEnvironment({ ...environment(), ...override }, [])).toThrow(
      "trusted TA-2 promotion environment"
    );
  });

  it("rejects all caller arguments so policy and workflow roots cannot be selected", () => {
    expect(() =>
      validatePromotionEnvironment(environment(), ["--policy-path", "attacker.yml"])
    ).toThrow("trusted TA-2 promotion accepts no arguments");
  });

  it("keeps the production workflow base-only and fixes the policy/workflow roots", async () => {
    const workflow = await readFile(".github/workflows/reviewready-ta2-promotion.yml", "utf8");
    const promotion = await readFile("scripts/ta2-promotion.mjs", "utf8");

    expect(workflow).toContain("branches: [main]");
    expect(workflow).not.toContain("pull_request");
    expect(workflow).toContain("node scripts/ta2-promotion.mjs");
    expect(workflow).toContain("GITHUB_TOKEN: " + "$" + "{{ secrets.GITHUB_TOKEN }}");
    expect(promotion).toContain(PROMOTION_TRUSTED_WORKFLOW);
    expect(workflow).toContain("contents: read");
    for (const event of PROMOTION_EVENT_NAMES) {
      expect(workflow).toContain(event);
    }
  });

  it("collects once, writes bounded evidence, and replays twice without a token", () => {
    const root = mkdtempSync(join(tmpdir(), "reviewready-ta2-promotion-test-"));
    const calls: Array<{ args: string[]; environment: NodeJS.ProcessEnv }> = [];
    try {
      const manifest = runPromotion({ ...environment(), RUNNER_TEMP: root }, [], process.cwd(), {
        runNode: (_projectRoot, args, childEnvironment) => {
          calls.push({ args: [...args], environment: childEnvironment });
          return args.includes("collect") ? bundleBytes() : reportBytes();
        }
      });

      expect(calls).toHaveLength(3);
      expect(calls[0]?.args).toEqual(
        expect.arrayContaining([
          "audit",
          "collect",
          "--github",
          PROMOTION_REPOSITORY,
          "--revision",
          sha,
          "--policy-path",
          ".reviewready.yml",
          "--protected-workflow",
          PROMOTION_TRUSTED_WORKFLOW,
          "--trusted-workflow",
          PROMOTION_TRUSTED_WORKFLOW
        ])
      );
      expect(calls[1]?.environment.GITHUB_TOKEN).toBeUndefined();
      expect(calls[2]?.environment.GITHUB_TOKEN).toBeUndefined();
      expect(readFileSync(join(root, "reviewready-ta2", "evidence-bundle-v1.json"), "utf8")).toBe(
        bundleBytes().toString("utf8")
      );
      expect(manifest.status).toBe("pass");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== "linux")(
    "passes the opened output directory to a real replay child process",
    () => {
      const root = mkdtempSync(join(tmpdir(), "reviewready-ta2-child-fd-test-"));
      const projectRoot = join(root, "project");
      mkdirSync(join(projectRoot, "dist"), { recursive: true });
      const bundle = bundleBytes().toString("utf8");
      const report = reportBytes().toString("utf8");
      writeFileSync(
        join(projectRoot, "dist", "cli.js"),
        "if (process.argv.includes('collect')) {" +
          "process.stdout.write(" +
          JSON.stringify(bundle) +
          ");} else {process.stdout.write(" +
          JSON.stringify(report) +
          ");}"
      );
      try {
        expect(
          runPromotion(
            { ...environment(), RUNNER_TEMP: join(root, "runner-temp") },
            [],
            projectRoot
          )
        ).toMatchObject({ status: "pass" });
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  );

  it("allows a collection bundle above the replay output bound", () => {
    const root = mkdtempSync(join(tmpdir(), "reviewready-ta2-large-bundle-test-"));
    const projectRoot = join(root, "project");
    mkdirSync(join(projectRoot, "dist"), { recursive: true });
    writeFileSync(
      join(projectRoot, "dist", "cli.js"),
      'if (process.argv.includes("collect")) {\n' +
        '  process.stdout.write(JSON.stringify({bundleVersion:1,canonicalization:"RFC8785",subject:{},collection:{padding:"b".repeat(1024 * 1024)},assertions:{},snapshot:{},artifacts:{},report:{},integrity:{}}));\n' +
        "} else {\n" +
        '  process.stdout.write(JSON.stringify({auditVersion:1,status:"pass",repository:{owner:"ahoooooooo",name:"reviewready",baseSha:"' +
        sha +
        '"},findings:[],checked:[]}) + "\\n");\n' +
        "}\n"
    );
    try {
      const manifest = runPromotion(
        { ...environment(), RUNNER_TEMP: join(root, "runner-temp") },
        [],
        projectRoot
      );

      expect(manifest.bundleBytes).toBeGreaterThan(1024 * 1024);
      expect(manifest.bundleBytes).toBeLessThan(8 * 1024 * 1024);
      expect(manifest.status).toBe("pass");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts valid non-pass audit statuses and their semantic exit codes", () => {
    const root = mkdtempSync(join(tmpdir(), "reviewready-ta2-status-test-"));
    const projectRoot = join(root, "project");
    mkdirSync(join(projectRoot, "dist"), { recursive: true });
    writeFileSync(
      join(projectRoot, "dist", "cli.js"),
      'if (process.argv.includes("collect")) {\n' +
        '  process.stdout.write(JSON.stringify({bundleVersion:1,canonicalization:"RFC8785",subject:{},collection:{},assertions:{},snapshot:{},artifacts:{},report:{},integrity:{}}));\n' +
        "  process.exitCode = 1;\n" +
        "} else {\n" +
        '  process.stdout.write(JSON.stringify({auditVersion:1,status:"incomplete",repository:{owner:"ahoooooooo",name:"reviewready",baseSha:"' +
        sha +
        '"},findings:[],checked:[]}) + "\\n");\n' +
        "  process.exitCode = 2;\n" +
        "}\n"
    );
    try {
      const manifest = runPromotion(
        { ...environment(), RUNNER_TEMP: join(root, "runner-temp") },
        [],
        projectRoot
      );

      expect(manifest.status).toBe("incomplete");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")(
    "rejects symlinked evidence output without modifying its target",
    () => {
      const root = mkdtempSync(join(tmpdir(), "reviewready-ta2-symlink-test-"));
      const runnerTemp = join(root, "runner-temp");
      const outputRoot = join(runnerTemp, "reviewready-ta2");
      const outside = join(root, "outside.json");
      mkdirSync(outputRoot, { recursive: true });
      writeFileSync(outside, "keep");
      symlinkSync(outside, join(outputRoot, "evidence-bundle-v1.json"), "file");

      try {
        expect(() =>
          runPromotion({ ...environment(), RUNNER_TEMP: runnerTemp }, [], process.cwd(), {
            runNode: (_projectRoot, args) =>
              args.includes("collect") ? bundleBytes() : reportBytes()
          })
        ).toThrow("evidence");
        expect(readFileSync(outside, "utf8")).toBe("keep");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  );

  it("rejects pre-existing evidence output without overwriting it", () => {
    const root = mkdtempSync(join(tmpdir(), "reviewready-ta2-existing-test-"));
    const runnerTemp = join(root, "runner-temp");
    const outputRoot = join(runnerTemp, "reviewready-ta2");
    mkdirSync(outputRoot, { recursive: true });
    const bundlePath = join(outputRoot, "evidence-bundle-v1.json");
    writeFileSync(bundlePath, "keep");

    try {
      expect(() =>
        runPromotion({ ...environment(), RUNNER_TEMP: runnerTemp }, [], process.cwd(), {
          runNode: (_projectRoot, args) =>
            args.includes("collect") ? bundleBytes() : reportBytes()
        })
      ).toThrow("evidence");
      expect(readFileSync(bundlePath, "utf8")).toBe("keep");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a malformed bundle even when replay output claims pass", () => {
    const root = mkdtempSync(join(tmpdir(), "reviewready-ta2-malformed-test-"));
    try {
      expect(() =>
        runPromotion(
          { ...environment(), RUNNER_TEMP: join(root, "runner-temp") },
          [],
          process.cwd(),
          {
            runNode: (_projectRoot, args) =>
              args.includes("collect") ? Buffer.from("not-a-bundle") : reportBytes()
          }
        )
      ).toThrow("bundle");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a bundle file mutated while replay is running", () => {
    const root = mkdtempSync(join(tmpdir(), "reviewready-ta2-bundle-race-test-"));
    let replayCalls = 0;
    try {
      expect(() =>
        runPromotion(
          { ...environment(), RUNNER_TEMP: join(root, "runner-temp") },
          [],
          process.cwd(),
          {
            runNode: (_projectRoot, args, childEnvironment) => {
              if (args.includes("collect")) {
                return bundleBytes();
              }
              replayCalls += 1;
              if (replayCalls === 1) {
                const bundleArgumentIndex = args.indexOf("--bundle");
                const bundlePath = args[bundleArgumentIndex + 1];
                if (typeof bundlePath !== "string") {
                  throw new Error("bundle path was not passed");
                }
                writeFileSync(
                  parentVisibleChildPath(bundlePath, childEnvironment),
                  bundleBytes("tampered")
                );
              }
              return reportBytes();
            }
          }
        )
      ).toThrow("changed");
      expect(
        existsSync(join(root, "runner-temp", "reviewready-ta2", "evidence-bundle-v1.json"))
      ).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("binds replay to the staged bundle digest", () => {
    const root = mkdtempSync(join(tmpdir(), "reviewready-ta2-bundle-digest-test-"));
    try {
      expect(() =>
        runPromotion(
          { ...environment(), RUNNER_TEMP: join(root, "runner-temp") },
          [],
          process.cwd(),
          {
            runNode: (_projectRoot, args, childEnvironment) => {
              if (args.includes("collect")) {
                return bundleBytes();
              }
              const bundleArgumentIndex = args.indexOf("--bundle");
              const bundlePath = args[bundleArgumentIndex + 1];
              if (typeof bundlePath !== "string") {
                throw new Error("bundle path was not passed");
              }
              const parentBundlePath = parentVisibleChildPath(bundlePath, childEnvironment);
              const alternate = bundleBytes("alternate");
              writeFileSync(parentBundlePath, alternate);
              try {
                const digestArgumentIndex = args.indexOf("--bundle-sha256");
                const expectedDigest = args[digestArgumentIndex + 1];
                if (digestArgumentIndex >= 0 && typeof expectedDigest === "string") {
                  const actualDigest = createHash("sha256").update(alternate).digest("hex");
                  if (actualDigest !== expectedDigest) {
                    throw new Error("bundle digest mismatch");
                  }
                }
              } finally {
                writeFileSync(parentBundlePath, bundleBytes());
              }
              return reportBytes();
            }
          }
        )
      ).toThrow("digest");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not leave a staged bundle after replay validation fails", () => {
    const root = mkdtempSync(join(tmpdir(), "reviewready-ta2-staged-cleanup-test-"));
    try {
      expect(() =>
        runPromotion(
          { ...environment(), RUNNER_TEMP: join(root, "runner-temp") },
          [],
          process.cwd(),
          {
            runNode: (_projectRoot, args) =>
              args.includes("collect")
                ? bundleBytes()
                : Buffer.from(
                    JSON.stringify({
                      auditVersion: 1,
                      status: "pass",
                      repository: { owner: "ahoooooooo", name: "reviewready", baseSha: sha },
                      findings: []
                    }),
                    "utf8"
                  )
          }
        )
      ).toThrow("replay");
      expect(
        existsSync(join(root, "runner-temp", "reviewready-ta2", "evidence-bundle-v1.json"))
      ).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("removes replay evidence when manifest persistence fails", () => {
    const root = mkdtempSync(join(tmpdir(), "reviewready-ta2-manifest-failure-test-"));
    const runnerTemp = join(root, "runner-temp");
    const outputRoot = join(runnerTemp, "reviewready-ta2");
    const manifestPath = join(outputRoot, "manifest.json");
    mkdirSync(outputRoot, { recursive: true });
    writeFileSync(manifestPath, "keep");
    try {
      expect(() =>
        runPromotion({ ...environment(), RUNNER_TEMP: runnerTemp }, [], process.cwd(), {
          runNode: (_projectRoot, args) =>
            args.includes("collect") ? bundleBytes() : reportBytes()
        })
      ).toThrow("evidence");
      expect(readFileSync(manifestPath, "utf8")).toBe("keep");
      expect(existsSync(join(outputRoot, "evidence-bundle-v1.json"))).toBe(false);
      expect(existsSync(join(outputRoot, "replay.json"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects final evidence mutated immediately after it is written", () => {
    const root = mkdtempSync(join(tmpdir(), "reviewready-ta2-final-race-test-"));
    let mutated = false;
    try {
      expect(() =>
        runPromotion(
          { ...environment(), RUNNER_TEMP: join(root, "runner-temp") },
          [],
          process.cwd(),
          {
            runNode: (_projectRoot, args) =>
              args.includes("collect") ? bundleBytes() : reportBytes(),
            afterEvidenceWrite: (path) => {
              if (path.endsWith("evidence-bundle-v1.json") && !path.endsWith(".pending")) {
                mutated = true;
                rmSync(path, { force: true });
                writeFileSync(path, bundleBytes("tampered"));
              }
            }
          }
        )
      ).toThrow("changed");
      expect(mutated).toBe(true);
      expect(
        readFileSync(
          join(root, "runner-temp", "reviewready-ta2", "evidence-bundle-v1.json"),
          "utf8"
        )
      ).toBe(bundleBytes("tampered").toString("utf8"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("revalidates final evidence after replay evidence is written", () => {
    const root = mkdtempSync(join(tmpdir(), "reviewready-ta2-replay-final-race-test-"));
    const finalPath = join(root, "runner-temp", "reviewready-ta2", "evidence-bundle-v1.json");
    try {
      expect(() =>
        runPromotion(
          { ...environment(), RUNNER_TEMP: join(root, "runner-temp") },
          [],
          process.cwd(),
          {
            runNode: (_projectRoot, args) =>
              args.includes("collect") ? bundleBytes() : reportBytes(),
            afterEvidenceWrite: (path) => {
              if (path.endsWith("replay.json")) {
                rmSync(finalPath, { force: true });
                writeFileSync(finalPath, bundleBytes("after-replay"));
              }
            }
          }
        )
      ).toThrow("changed");
      expect(readFileSync(finalPath, "utf8")).toBe(bundleBytes("after-replay").toString("utf8"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("revalidates final and replay evidence after manifest persistence", () => {
    const root = mkdtempSync(join(tmpdir(), "reviewready-ta2-manifest-race-test-"));
    const finalPath = join(root, "runner-temp", "reviewready-ta2", "evidence-bundle-v1.json");
    try {
      expect(() =>
        runPromotion(
          { ...environment(), RUNNER_TEMP: join(root, "runner-temp") },
          [],
          process.cwd(),
          {
            runNode: (_projectRoot, args) =>
              args.includes("collect") ? bundleBytes() : reportBytes(),
            beforeManifestWrite: () => {
              rmSync(finalPath, { force: true });
              writeFileSync(finalPath, bundleBytes("after-manifest"));
            }
          }
        )
      ).toThrow("changed");
      expect(readFileSync(finalPath, "utf8")).toBe(bundleBytes("after-manifest").toString("utf8"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not delete a replacement final file during failed cleanup", () => {
    const root = mkdtempSync(join(tmpdir(), "reviewready-ta2-final-cleanup-owner-test-"));
    const finalPath = join(root, "runner-temp", "reviewready-ta2", "evidence-bundle-v1.json");
    try {
      let failure: unknown;
      try {
        runPromotion(
          { ...environment(), RUNNER_TEMP: join(root, "runner-temp") },
          [],
          process.cwd(),
          {
            runNode: (_projectRoot, args) =>
              args.includes("collect") ? bundleBytes() : reportBytes(),
            afterEvidenceWrite: (path) => {
              if (path.endsWith("evidence-bundle-v1.json") && !path.endsWith(".pending")) {
                rmSync(path, { force: true });
                writeFileSync(path, bundleBytes("competitor"));
              }
            }
          }
        );
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toContain("cleanup incomplete");
      expect(readFileSync(finalPath, "utf8")).toBe(bundleBytes("competitor").toString("utf8"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not unlink a replacement pending file", () => {
    const root = mkdtempSync(join(tmpdir(), "reviewready-ta2-pending-owner-test-"));
    const pendingPath = join(
      root,
      "runner-temp",
      "reviewready-ta2",
      "evidence-bundle-v1.json.pending"
    );
    try {
      expect(() =>
        runPromotion(
          { ...environment(), RUNNER_TEMP: join(root, "runner-temp") },
          [],
          process.cwd(),
          {
            runNode: (_projectRoot, args) =>
              args.includes("collect") ? bundleBytes() : reportBytes(),
            afterEvidenceWrite: (path) => {
              if (path.endsWith("evidence-bundle-v1.json") && !path.endsWith(".pending")) {
                rmSync(pendingPath, { force: true });
                writeFileSync(pendingPath, "competitor");
              }
            }
          }
        )
      ).toThrow("changed");
      expect(readFileSync(pendingPath, "utf8")).toBe("competitor");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed when a pending file is replaced after ownership verification", () => {
    const root = mkdtempSync(join(tmpdir(), "reviewready-ta2-pending-toctou-test-"));
    const pendingPath = join(
      root,
      "runner-temp",
      "reviewready-ta2",
      "evidence-bundle-v1.json.pending"
    );
    try {
      expect(() =>
        runPromotion(
          { ...environment(), RUNNER_TEMP: join(root, "runner-temp") },
          [],
          process.cwd(),
          {
            runNode: (_projectRoot, args) =>
              args.includes("collect") ? bundleBytes() : reportBytes(),
            beforeEvidenceUnlink: (path) => {
              if (path === pendingPath) {
                writeFileSync(path, "race-after-ownership");
              }
            }
          }
        )
      ).toThrow("changed");
      expect(readFileSync(pendingPath, "utf8")).toBe("race-after-ownership");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("preserves a pending evidence file that existed before promotion", () => {
    const root = mkdtempSync(join(tmpdir(), "reviewready-ta2-pending-preserve-test-"));
    const runnerTemp = join(root, "runner-temp");
    const outputRoot = join(runnerTemp, "reviewready-ta2");
    const pendingPath = join(outputRoot, "evidence-bundle-v1.json.pending");
    mkdirSync(outputRoot, { recursive: true });
    writeFileSync(pendingPath, "keep");
    try {
      expect(() =>
        runPromotion({ ...environment(), RUNNER_TEMP: runnerTemp }, [], process.cwd(), {
          runNode: (_projectRoot, args) =>
            args.includes("collect") ? bundleBytes() : reportBytes()
        })
      ).toThrow("new regular file");
      expect(readFileSync(pendingPath, "utf8")).toBe("keep");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("canonicalizes an uppercase GitHub SHA before replay binding", () => {
    const root = mkdtempSync(join(tmpdir(), "reviewready-ta2-uppercase-sha-test-"));
    try {
      expect(
        runPromotion(
          { ...environment(), GITHUB_SHA: "A".repeat(40), RUNNER_TEMP: join(root, "runner-temp") },
          [],
          process.cwd(),
          {
            runNode: (_projectRoot, args) =>
              args.includes("collect") ? bundleBytes() : reportBytes()
          }
        )
      ).toMatchObject({ revision: sha });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed when the output root is replaced after the pre-write identity check", () => {
    const root = mkdtempSync(join(tmpdir(), "reviewready-ta2-pre-write-race-test-"));
    const runnerTemp = join(root, "runner-temp");
    const outputRoot = join(runnerTemp, "reviewready-ta2");
    const outside = join(root, "outside");
    mkdirSync(outside, { recursive: true });
    let replaced = false;
    try {
      expect(() =>
        runPromotion({ ...environment(), RUNNER_TEMP: runnerTemp }, [], process.cwd(), {
          runNode: (_projectRoot, args) =>
            args.includes("collect") ? bundleBytes() : reportBytes(),
          beforeEvidenceWrite: (path) => {
            if (!replaced && path.endsWith("evidence-bundle-v1.json.pending")) {
              replaced = true;
              rmSync(outputRoot, { recursive: true, force: true });
              symlinkSync(outside, outputRoot, process.platform === "win32" ? "junction" : "dir");
            }
          }
        })
      ).toThrow("output");
      expect(replaced).toBe(true);
      expect(existsSync(join(outside, "evidence-bundle-v1.json.pending"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== "linux")(
    "does not write outside the opened output directory after a post-check root replacement",
    () => {
      const root = mkdtempSync(join(tmpdir(), "reviewready-ta2-post-check-race-test-"));
      const runnerTemp = join(root, "runner-temp");
      const outputRoot = join(runnerTemp, "reviewready-ta2");
      const outside = join(root, "outside");
      mkdirSync(outside, { recursive: true });
      let replaced = false;
      try {
        expect(() =>
          runPromotion({ ...environment(), RUNNER_TEMP: runnerTemp }, [], process.cwd(), {
            runNode: (_projectRoot, args) =>
              args.includes("collect") ? bundleBytes() : reportBytes(),
            beforeEvidenceOpen: (path) => {
              if (!replaced && path.endsWith("evidence-bundle-v1.json.pending")) {
                replaced = true;
                rmSync(outputRoot, { recursive: true, force: true });
                symlinkSync(outside, outputRoot, "dir");
              }
            }
          })
        ).toThrow("output");
        expect(replaced).toBe(true);
        expect(existsSync(join(outside, "evidence-bundle-v1.json.pending"))).toBe(false);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  );

  it("removes a partial evidence file when writing the file fails", () => {
    const root = mkdtempSync(join(tmpdir(), "reviewready-ta2-partial-write-test-"));
    const runnerTemp = join(root, "runner-temp");
    const pendingPath = join(runnerTemp, "reviewready-ta2", "evidence-bundle-v1.json.pending");
    let failed = false;
    try {
      expect(() =>
        runPromotion({ ...environment(), RUNNER_TEMP: runnerTemp }, [], process.cwd(), {
          runNode: (_projectRoot, args) =>
            args.includes("collect") ? bundleBytes() : reportBytes(),
          writeEvidenceBytes: (descriptor) => {
            if (!failed) {
              failed = true;
              writeFileSync(descriptor, Buffer.from("partial", "utf8"));
              throw new Error("simulated evidence write failure");
            }
          }
        })
      ).toThrow("new regular file");
      expect(failed).toBe(true);
      expect(existsSync(pendingPath)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports incomplete cleanup when a partial evidence file cannot be removed", () => {
    const root = mkdtempSync(join(tmpdir(), "reviewready-ta2-partial-cleanup-test-"));
    const runnerTemp = join(root, "runner-temp");
    const pendingPath = join(runnerTemp, "reviewready-ta2", "evidence-bundle-v1.json.pending");
    try {
      expect(() =>
        runPromotion({ ...environment(), RUNNER_TEMP: runnerTemp }, [], process.cwd(), {
          runNode: (_projectRoot, args) =>
            args.includes("collect") ? bundleBytes() : reportBytes(),
          writeEvidenceBytes: (descriptor) => {
            writeFileSync(descriptor, Buffer.from("partial", "utf8"));
            throw new Error("simulated evidence write failure");
          },
          beforeEvidencePartialCleanup: () => {
            throw new Error("simulated cleanup failure");
          }
        })
      ).toThrow("cleanup incomplete");
      expect(existsSync(pendingPath)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports cleanup incomplete when evidence changes after descriptor close", () => {
    const root = mkdtempSync(join(tmpdir(), "reviewready-ta2-close-race-test-"));
    const runnerTemp = join(root, "runner-temp");
    const pendingPath = join(runnerTemp, "reviewready-ta2", "evidence-bundle-v1.json.pending");
    let raced = false;
    try {
      expect(() =>
        runPromotion({ ...environment(), RUNNER_TEMP: runnerTemp }, [], process.cwd(), {
          runNode: (_projectRoot, args) =>
            args.includes("collect") ? bundleBytes() : reportBytes(),
          afterEvidenceClose: (path) => {
            if (!raced && path === pendingPath) {
              raced = true;
              rmSync(path, { force: true });
              writeFileSync(path, "competitor");
            }
          }
        })
      ).toThrow("cleanup incomplete");
      expect(raced).toBe(true);
      expect(readFileSync(pendingPath, "utf8")).toBe("competitor");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects an output directory replaced after validation", () => {
    const root = mkdtempSync(join(tmpdir(), "reviewready-ta2-race-test-"));
    const runnerTemp = join(root, "runner-temp");
    const outputRoot = join(runnerTemp, "reviewready-ta2");
    const outside = join(root, "outside");
    mkdirSync(outside, { recursive: true });
    let replaced = false;
    try {
      expect(() =>
        runPromotion({ ...environment(), RUNNER_TEMP: runnerTemp }, [], process.cwd(), {
          runNode: (_projectRoot, args) => {
            if (args.includes("collect") && !replaced) {
              replaced = true;
              rmSync(outputRoot, { recursive: true, force: true });
              symlinkSync(outside, outputRoot, process.platform === "win32" ? "junction" : "dir");
              return bundleBytes();
            }
            return reportBytes();
          }
        })
      ).toThrow("output");
      expect(existsSync(join(outside, "evidence-bundle-v1.json"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
