import { mkdtemp, readFile, rm, symlink, writeFile, type FileHandle } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runCli, type CliIo } from "../src/cli.js";
import * as auditEvidenceBundleModule from "../src/audit-evidence-bundle.js";
import {
  AuditEvidenceCollectionError,
  createAuditEvidenceSnapshot,
  buildAuditEvidenceBundle,
  serializeAuditEvidenceBundle
} from "../src/audit-evidence-collection.js";
import { hydrateAuditEvidenceBundle } from "../src/audit-evidence-bundle.js";
import { createGitHubAuditClient } from "../src/github-audit-api.js";
import {
  collectRepositoryAuditEvidenceData,
  collectRepositoryAuditSnapshot,
  AuditCollectionFailure,
  type AuditEvidenceCollectionResult
} from "../src/github-audit.js";
import { decodeAuditEvidenceBase64url } from "../src/audit-evidence-bundle.js";
import { parseCanonicalJsonBytes, type JsonValue } from "../src/audit-evidence.js";
import {
  CliFileError,
  MAX_CLI_FILE_BYTES,
  classifyFileReadFailure,
  classifyFileSystemError,
  readBoundedBytes,
  readBoundedFile
} from "../src/file-reader.js";

vi.mock("../src/github-audit-api.js", () => ({ createGitHubAuditClient: vi.fn() }));
vi.mock("../src/github-audit.js", () => ({
  MAX_AUDIT_WORKFLOW_ROOTS: 100,
  AuditCollectionFailure: class AuditCollectionFailure extends Error {
    public readonly code: string;

    public constructor(code: string) {
      super(code);
      this.code = code;
    }
  },
  collectRepositoryAuditEvidenceData: vi.fn(),
  collectRepositoryAuditSnapshot: vi.fn()
}));

const fixture = (...parts: string[]): string => resolve("fixtures", "basic", ...parts);
const temporaryDirectories = new Set<string>();

afterEach(async () => {
  const directories = [...temporaryDirectories];
  temporaryDirectories.clear();
  await Promise.all(
    directories.map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "reviewready-cli-"));
  temporaryDirectories.add(directory);
  return directory;
}

function systemError(code: string): NodeJS.ErrnoException {
  const error = new Error(code + ": C:\\private\\reviewready\\fixture") as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

function capture(): CliIo & {
  stdoutLines: string[];
  stdoutByteChunks: Uint8Array[];
  stderrLines: string[];
} {
  const stdoutLines: string[] = [];
  const stdoutByteChunks: Uint8Array[] = [];
  const stderrLines: string[] = [];
  return {
    stdoutLines,
    stdoutByteChunks,
    stderrLines,
    readFile,
    stdout: (value) => stdoutLines.push(value),
    stdoutBytes: (value) => stdoutByteChunks.push(value),
    stderr: (value) => stderrLines.push(value)
  };
}

function evidenceCollectionResult(): AuditEvidenceCollectionResult {
  const bundle = parseCanonicalJsonBytes(replayBundle()) as Record<string, JsonValue>;
  const artifacts = bundle.artifacts as Record<string, JsonValue>;
  const policy = artifacts.policy as Record<string, JsonValue>;
  const policySource = new TextDecoder().decode(
    decodeAuditEvidenceBase64url(policy.contentBase64url)
  );
  return {
    snapshot: hydrateAuditEvidenceBundle(bundle).snapshot,
    repository: {
      id: 1,
      owner: "ahoooooooo",
      name: "reviewready",
      ownerType: "organization",
      visibility: "public",
      defaultBranch: "main"
    },
    policySource,
    initialBranchSha: "a".repeat(40),
    endingBranchSha: "a".repeat(40),
    requestAttempts: 1,
    retryAttempts: 0
  };
}

function replayBundle(): Uint8Array {
  const sha = "a".repeat(40);
  const source =
    'version: 1\nrules:\n  - id: attestation\n    when:\n      paths:\n        any: ["**"]\n    require:\n      - type: human_attestation\n        text: I understand and take responsibility for this change.\n';
  const policySha256 = createHash("sha256").update(source, "utf8").digest("hex");
  const bundle = buildAuditEvidenceBundle({
    repository: {
      id: 1,
      owner: "ahoooooooo",
      name: "reviewready",
      ownerType: "organization",
      visibility: "public",
      defaultBranch: "main"
    },
    initialBranchSha: sha,
    endingBranchSha: sha,
    snapshot: createAuditEvidenceSnapshot({
      version: 1,
      repository: { owner: "ahoooooooo", name: "reviewready", defaultBranch: "main" },
      baseRevision: {
        sha,
        policyPath: ".reviewready.yml",
        policyRevisionSha: sha,
        policySha256,
        policyLoadedFromBase: true
      },
      policy: { requiredChecks: [], workflowPaths: [] },
      completeness: { complete: true, missing: [] },
      branchProtection: {
        branch: "main",
        exists: true,
        enforceAdmins: true,
        allowForcePushes: false,
        allowDeletions: false,
        requiredStatusChecks: { strict: true, checks: [] },
        requiredPullRequestReviews: {
          requiredApprovingReviewCount: 1,
          bypassActors: [],
          bypassActorsKnown: true
        }
      },
      rulesets: [],
      tagProtection: { known: true, allowsDeletion: false, allowsUpdate: false },
      workflows: []
    }),
    policySource: source,
    workflowSources: [],
    protectedWorkflowPaths: [],
    trustedWorkflowPaths: [],
    observedAt: "2026-08-13T10:20:30.000Z",
    durationMs: 1,
    requestAttempts: 1,
    retryAttempts: 0
  });
  return serializeAuditEvidenceBundle(bundle);
}

describe("bounded file reader", () => {
  it("reads a regular file and closes the handle", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "policy.yml");
    await writeFile(path, "version: 1\nrules: []\n");

    await expect(readBoundedFile(path)).resolves.toBe("version: 1\nrules: []\n");
  });

  it("rejects invalid limits before touching the filesystem", async () => {
    await expect(readBoundedFile("not-used", -1)).rejects.toThrow(RangeError);
    await expect(readBoundedFile("not-used", Number.MAX_SAFE_INTEGER + 1)).rejects.toThrow(
      RangeError
    );
  });

  it("does not allow callers to raise the hard CLI byte limit", async () => {
    await expect(readBoundedFile("not-used", MAX_CLI_FILE_BYTES + 1)).rejects.toThrow(RangeError);
  });

  it("classifies filesystem and reader failures into stable reasons", () => {
    expect(classifyFileSystemError(null)).toBe("read_failed");
    expect(classifyFileSystemError({ code: "ENOTDIR" })).toBe("not_found");
    expect(classifyFileSystemError({ code: "EISDIR" })).toBe("not_regular");
    expect(classifyFileSystemError({ code: "ELOOP" })).toBe("not_regular");
    expect(classifyFileSystemError({ code: "ENODEV" })).toBe("not_regular");
    expect(classifyFileSystemError({ code: "ENXIO" })).toBe("not_regular");
    expect(classifyFileSystemError({ code: "EOVERFLOW" })).toBe("too_large");
    expect(classifyFileSystemError({ code: "EFBIG" })).toBe("too_large");
    expect(classifyFileSystemError({ code: "ERR_FS_FILE_TOO_LARGE" })).toBe("too_large");
    expect(classifyFileSystemError({ code: "unexpected" })).toBe("read_failed");
    expect(classifyFileReadFailure(new CliFileError("access_denied"))).toBe("access_denied");
    expect(classifyFileReadFailure({ code: "ENOENT" })).toBe("not_found");
  });

  it("maps a missing bounded file to a typed failure", async () => {
    const directory = await temporaryDirectory();
    await expect(readBoundedFile(join(directory, "missing.yml"))).rejects.toMatchObject({
      name: "CliFileError",
      reason: "not_found"
    });
  });

  it("rejects a file that grows after the initial size checks", async () => {
    const stats = (size: number) =>
      ({
        dev: 1,
        ino: 2,
        size,
        isFile: () => true
      }) as never;
    const close = vi.fn().mockResolvedValue(undefined);
    const handle = {
      stat: vi.fn().mockResolvedValueOnce(stats(1)).mockResolvedValueOnce(stats(2)),
      read: vi
        .fn()
        .mockImplementationOnce((buffer: Buffer, offset: number) => {
          buffer[offset] = 0x61;
          return Promise.resolve({ bytesRead: 1, buffer });
        })
        .mockResolvedValueOnce({ bytesRead: 0 }),
      close
    } as unknown as FileHandle;
    const fileSystem = {
      lstat: vi.fn().mockResolvedValueOnce(stats(1)).mockResolvedValueOnce(stats(1)),
      open: vi.fn().mockResolvedValue(handle)
    };

    await expect(readBoundedFile("growing-policy.yml", 1, fileSystem)).rejects.toMatchObject({
      name: "CliFileError",
      reason: "too_large"
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it("enforces raw byte boundaries for multibyte content", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "unicode.txt");
    await writeFile(path, "éé", "utf8");

    await expect(readBoundedFile(path, 4)).resolves.toBe("éé");
    await expect(readBoundedFile(path, 3)).rejects.toMatchObject({
      name: "CliFileError",
      reason: "too_large"
    });
  });

  it("rejects same-inode content that changes size during the read", async () => {
    const stats = (size: number) =>
      ({
        dev: 1,
        ino: 2,
        size,
        isFile: () => true
      }) as never;
    const close = vi.fn().mockResolvedValue(undefined);
    const handle = {
      stat: vi.fn().mockResolvedValueOnce(stats(3)).mockResolvedValueOnce(stats(2)),
      read: vi
        .fn()
        .mockImplementationOnce((buffer: Buffer, offset: number) => {
          buffer.fill(0x61, offset, offset + 3);
          return Promise.resolve({ bytesRead: 3, buffer });
        })
        .mockResolvedValueOnce({ bytesRead: 0 }),
      close
    } as unknown as FileHandle;
    const fileSystem = {
      lstat: vi.fn().mockResolvedValueOnce(stats(3)).mockResolvedValueOnce(stats(3)),
      open: vi.fn().mockResolvedValue(handle)
    };

    await expect(readBoundedFile("truncated-policy.yml", 3, fileSystem)).rejects.toMatchObject({
      name: "CliFileError",
      reason: "read_failed"
    });
    expect(close).toHaveBeenCalledOnce();
  });

  type StatsMutation = {
    readonly opened?: Record<string, unknown>;
    readonly current?: Record<string, unknown>;
    readonly final?: Record<string, unknown>;
  };
  const statsMutations: readonly [string, StatsMutation, string][] = [
    ["opened non-file", { opened: { isFile: () => false } }, "not_regular"],
    ["opened identity change", { opened: { dev: 2, ino: 2 } }, "not_regular"],
    ["opened growth", { opened: { size: 2 } }, "too_large"],
    ["path becomes non-file", { current: { isFile: () => false } }, "not_regular"],
    ["path identity change", { current: { dev: 2, ino: 2 } }, "not_regular"],
    ["path grows", { current: { size: 2 } }, "too_large"],
    ["final handle becomes non-file", { final: { isFile: () => false } }, "not_regular"],
    ["final handle identity changes", { final: { dev: 2, ino: 2 } }, "not_regular"]
  ];
  it.each(statsMutations)("fails closed when %s", async (_label, mutation, reason) => {
    const makeStats = (overrides: Record<string, unknown> = {}) =>
      ({ dev: 1, ino: 1, size: 1, isFile: () => true, ...overrides }) as never;
    const opened = makeStats(mutation.opened);
    const current = makeStats(mutation.current);
    const final = makeStats(mutation.final);
    const close = vi.fn().mockResolvedValue(undefined);
    const handle = {
      stat: vi.fn().mockResolvedValueOnce(opened).mockResolvedValueOnce(final),
      read: vi.fn().mockResolvedValueOnce({ bytesRead: 1 }).mockResolvedValueOnce({ bytesRead: 0 }),
      close
    } as unknown as FileHandle;
    const fileSystem = {
      lstat: vi.fn().mockResolvedValueOnce(makeStats()).mockResolvedValueOnce(current),
      open: vi.fn().mockResolvedValue(handle)
    };

    await expect(readBoundedBytes("boundary.bin", 1, fileSystem)).rejects.toMatchObject({
      name: "CliFileError",
      reason
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it("rejects a read that returns more bytes than the caller allowed", async () => {
    const stats = () => ({ dev: 1, ino: 1, size: 1, isFile: () => true }) as never;
    const close = vi.fn().mockResolvedValue(undefined);
    const handle = {
      stat: vi.fn().mockResolvedValueOnce(stats()),
      read: vi.fn().mockResolvedValueOnce({ bytesRead: 2 }),
      close
    } as unknown as FileHandle;
    const fileSystem = {
      lstat: vi.fn().mockResolvedValueOnce(stats()).mockResolvedValueOnce(stats()),
      open: vi.fn().mockResolvedValue(handle)
    };

    await expect(readBoundedBytes("overread.bin", 1, fileSystem)).rejects.toMatchObject({
      name: "CliFileError",
      reason: "too_large"
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it("still closes a handle when close itself fails", async () => {
    const stats = () => ({ dev: 1, ino: 1, size: 1, isFile: () => true }) as never;
    const close = vi.fn().mockRejectedValue(new Error("close failed"));
    const handle = {
      stat: vi.fn().mockResolvedValueOnce(stats()).mockResolvedValueOnce(stats()),
      read: vi
        .fn()
        .mockImplementationOnce((buffer: Buffer, offset: number) => {
          buffer[offset] = 0;
          return Promise.resolve({ bytesRead: 1 });
        })
        .mockResolvedValueOnce({ bytesRead: 0 }),
      close
    } as unknown as FileHandle;
    const fileSystem = {
      lstat: vi.fn().mockResolvedValueOnce(stats()).mockResolvedValueOnce(stats()),
      open: vi.fn().mockResolvedValue(handle)
    };

    const result = await readBoundedBytes("close-error.bin", 1, fileSystem);
    expect(Array.from(result)).toEqual([0]);
    expect(close).toHaveBeenCalledOnce();
  });
});

describe("runCli", () => {
  it("validates a policy with exit code 0", async () => {
    const io = capture();
    const exitCode = await runCli(["validate", "--policy", fixture(".reviewready.yml")], io);

    expect(exitCode).toBe(0);
    expect(io.stdoutLines.join("\n")).toContain("Policy is valid");
    expect(io.stderrLines).toEqual([]);
  });

  it("returns exit code 0 and versioned JSON for a ready contribution", async () => {
    const io = capture();
    const exitCode = await runCli(
      [
        "check",
        "--policy",
        fixture(".reviewready.yml"),
        "--input",
        fixture("ready.json"),
        "--json"
      ],
      io
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(io.stdoutLines.join(""))).toMatchObject({
      outputVersion: 1,
      status: "ready",
      triggeredRules: ["source-change"]
    });
    expect(io.stderrLines).toEqual([]);
  });

  it("returns exit code 1 and actionable text for missing evidence", async () => {
    const io = capture();
    const exitCode = await runCli(
      ["check", "--policy", fixture(".reviewready.yml"), "--input", fixture("not-ready.json")],
      io
    );

    expect(exitCode).toBe(1);
    expect(io.stdoutLines.join("\n")).toContain("NOT READY FOR HUMAN REVIEW");
    expect(io.stdoutLines.join("\n")).toContain('PR body section "Testing" has content');
    expect(io.stderrLines).toEqual([]);
  });

  it("returns exit code 2 without a stack trace for invalid JSON", async () => {
    const io = capture();
    io.readFile = () => Promise.resolve("{ definitely not json");
    const exitCode = await runCli(["check", "--policy", "policy.yml", "--input", "input.json"], io);

    expect(exitCode).toBe(2);
    expect(io.stderrLines.join("\n")).toContain("[INPUT_JSON_INVALID]");
    expect(io.stderrLines.join("\n")).not.toContain(" at ");
  });

  it("explains all policy rules without evaluating a PR", async () => {
    const io = capture();
    const exitCode = await runCli(["explain", "--policy", fixture(".reviewready.yml")], io);

    expect(exitCode).toBe(0);
    expect(io.stdoutLines.join("\n")).toContain("source-change");
    expect(io.stdoutLines.join("\n")).toContain("PR body contains checked task-list text");
  });

  it("rejects missing required options with usage guidance", async () => {
    const io = capture();
    const exitCode = await runCli(["check", "--policy", "policy.yml"], io);

    expect(exitCode).toBe(2);
    expect(io.stderrLines.join("\n")).toContain("[CLI_USAGE]");
    expect(io.stderrLines.join("\n")).toContain("--input");
  });

  it("rejects duplicate policy and input options before reading files", async () => {
    const io = capture();
    let reads = 0;
    io.readFile = () => {
      reads += 1;
      return Promise.resolve("version: 1\nrules: []\n");
    };

    expect(
      await runCli(
        ["check", "--policy", "trusted.yml", "--policy", "attacker.yml", "--input", "input.json"],
        io
      )
    ).toBe(2);
    expect(reads).toBe(0);
    expect(io.stderrLines.join("\n")).toContain("[CLI_USAGE]");
  });

  it("rejects unknown commands and options", async () => {
    const commandIo = capture();
    const optionIo = capture();

    expect(await runCli(["unknown", "--policy", "policy.yml"], commandIo)).toBe(2);
    expect(await runCli(["validate", "--policy", "policy.yml", "--wat"], optionIo)).toBe(2);
    expect(commandIo.stderrLines[0]).toContain("[CLI_USAGE]");
    expect(optionIo.stderrLines[0]).toContain("Unknown option");
  });

  it("rejects options that do not apply to the selected command", async () => {
    const validateIo = capture();
    const explainIo = capture();

    expect(
      await runCli(
        ["validate", "--policy", fixture(".reviewready.yml"), "--input", "missing.json"],
        validateIo
      )
    ).toBe(2);
    expect(
      await runCli(["explain", "--policy", fixture(".reviewready.yml"), "--json"], explainIo)
    ).toBe(2);
    expect(validateIo.stderrLines.join("\n")).toContain("--input");
    expect(explainIo.stderrLines.join("\n")).toContain("--json");
  });

  it("does not expose an unknown command value as a local path", async () => {
    const io = capture();
    const privatePath = "C:\\private\\secret-policy.yml";

    expect(await runCli([privatePath, "--policy", "policy.yml"], io)).toBe(2);
    expect(io.stderrLines.join("\n")).not.toContain(privatePath);
    expect(io.stderrLines.join("\n")).toContain("Unknown or missing command");
  });

  it("escapes terminal control characters in CLI errors", async () => {
    const io = capture();

    expect(await runCli(["validate", "--bad\u001b]0;owned"], io)).toBe(2);

    const message = io.stderrLines.join("\n");
    expect(message).not.toContain("\u001b");
    expect(message).toContain("\\u001b");
  });

  it("redacts unexpected file-system errors", async () => {
    const io = capture();
    io.readFile = () => Promise.reject(new Error("private machine detail"));

    expect(await runCli(["validate", "--policy", "policy.yml"], io)).toBe(2);
    expect(io.stderrLines).toEqual([
      "[INTERNAL_ERROR] ReviewReady could not complete the command."
    ]);
  });

  it("maps a missing policy file to a stable public error", async () => {
    const io = capture();
    io.readFile = () => Promise.reject(systemError("ENOENT"));

    expect(await runCli(["validate", "--policy", "C:\\private\\policy.yml"], io)).toBe(2);
    expect(io.stderrLines).toEqual(["[POLICY_FILE_NOT_FOUND] Policy file was not found."]);
  });

  it("maps a missing input file without exposing its path", async () => {
    const io = capture();
    io.readFile = (path) =>
      path === "policy.yml"
        ? readFile(fixture(".reviewready.yml"), "utf8")
        : Promise.reject(systemError("ENOENT"));

    expect(
      await runCli(["check", "--policy", "policy.yml", "--input", "C:\\private\\input.json"], io)
    ).toBe(2);
    expect(io.stderrLines).toEqual(["[INPUT_FILE_NOT_FOUND] Input file was not found."]);
  });

  it.each(["EACCES", "EPERM"])("maps %s to a stable access error", async (code) => {
    const io = capture();
    io.readFile = () => Promise.reject(systemError(code));

    expect(await runCli(["validate", "--policy", "C:\\private\\policy.yml"], io)).toBe(2);
    expect(io.stderrLines).toEqual([
      "[POLICY_FILE_ACCESS_DENIED] Policy file could not be read because access was denied."
    ]);
  });

  it("rejects directories as policy files", async () => {
    const directory = await temporaryDirectory();
    const io = capture();
    io.readFile = (path) => readBoundedFile(path);

    expect(await runCli(["validate", "--policy", directory], io)).toBe(2);
    expect(io.stderrLines).toEqual([
      "[POLICY_FILE_NOT_REGULAR] Policy file must be a regular file."
    ]);
  });

  it("rejects an oversized file before loading its complete contents", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "oversized.yml");
    await writeFile(path, Buffer.alloc(MAX_CLI_FILE_BYTES + 1, 0x61));

    const io = capture();
    io.readFile = (filePath) => readBoundedFile(filePath);

    expect(await runCli(["validate", "--policy", path], io)).toBe(2);
    expect(io.stderrLines).toEqual([
      "[POLICY_FILE_TOO_LARGE] Policy file exceeds the CLI raw-byte limit."
    ]);
  });

  it("rejects an oversized normalized input before parsing JSON", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "oversized.json");
    await writeFile(path, Buffer.alloc(MAX_CLI_FILE_BYTES + 1, 0x20));

    const io = capture();
    io.readFile = (filePath) => readBoundedFile(filePath);

    expect(
      await runCli(["check", "--policy", fixture(".reviewready.yml"), "--input", path], io)
    ).toBe(2);
    expect(io.stderrLines).toEqual([
      "[INPUT_FILE_TOO_LARGE] Input file exceeds the CLI raw-byte limit."
    ]);
  });

  it("rejects symlinks instead of reading their target as input", async () => {
    const directory = await temporaryDirectory();
    const target = join(directory, "target.yml");
    const link = join(directory, "link.yml");
    await writeFile(target, "version: 1\nrules: []\n");

    try {
      await symlink(target, link, "file");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (process.platform === "win32" && (code === "EPERM" || code === "EACCES")) {
        return;
      }
      throw error;
    }

    const io = capture();
    io.readFile = (path) => readBoundedFile(path);

    expect(await runCli(["validate", "--policy", link], io)).toBe(2);
    expect(io.stderrLines).toEqual([
      "[POLICY_FILE_NOT_REGULAR] Policy file must be a regular file."
    ]);
  });
});

describe("audit command", () => {
  const snapshot = JSON.stringify({
    version: 1,
    repository: { owner: "ahoooooooo", name: "reviewready", defaultBranch: "main" },
    baseRevision: {
      sha: "a".repeat(40),
      policyPath: ".reviewready.yml",
      policyRevisionSha: "a".repeat(40),
      policyLoadedFromBase: true
    },
    policy: { requiredChecks: [], workflowPaths: [] },
    completeness: { complete: true, missing: [] },
    branchProtection: {
      branch: "main",
      exists: true,
      enforceAdmins: true,
      allowForcePushes: false,
      allowDeletions: false,
      requiredStatusChecks: { strict: true, checks: [] },
      requiredPullRequestReviews: {
        requiredApprovingReviewCount: 1,
        bypassActors: [],
        bypassActorsKnown: true
      }
    },
    rulesets: [],
    tagProtection: { known: true, allowsDeletion: false, allowsUpdate: false },
    workflows: []
  });

  it("runs without a policy and returns versioned audit JSON", async () => {
    const io = capture();
    io.readFile = () => Promise.resolve(snapshot);

    expect(await runCli(["audit", "--input", "audit.json", "--json"], io)).toBe(0);
    expect(JSON.parse(io.stdoutLines.join(""))).toMatchObject({ auditVersion: 1, status: "pass" });
    expect(io.stderrLines).toEqual([]);
  });

  it("rejects an unbounded workflow-root option list before live collection", async () => {
    const io = capture();
    const args = ["audit", "--github", "octocat/demo", "--token-env", "REVIEWREADY_TEST_TOKEN"];
    for (let index = 0; index < 101; index += 1) {
      args.push("--trusted-workflow", ".github/workflows/trusted-" + String(index) + ".yml");
    }

    process.env.REVIEWREADY_TEST_TOKEN = "secret-token";
    try {
      expect(await runCli(args, io)).toBe(2);
    } finally {
      delete process.env.REVIEWREADY_TEST_TOKEN;
    }
    expect(io.stderrLines.join("\n")).toContain("workflow root limit");
  });

  it("collects a live audit without accepting a token on the command line", async () => {
    const io = capture();
    const liveSnapshot = JSON.parse(snapshot) as unknown;
    vi.mocked(createGitHubAuditClient).mockReturnValue({} as never);
    vi.mocked(collectRepositoryAuditSnapshot).mockResolvedValue(liveSnapshot as never);
    process.env.REVIEWREADY_TEST_TOKEN = "secret-token";

    try {
      expect(
        await runCli(
          [
            "audit",
            "--github",
            "octocat/demo",
            "--ref",
            "main",
            "--token-env",
            "REVIEWREADY_TEST_TOKEN",
            "--protected-workflow",
            ".github/workflows/reviewready.yml",
            "--trusted-workflow",
            ".github/workflows/reviewready.yml",
            "--json"
          ],
          io
        )
      ).toBe(0);
    } finally {
      delete process.env.REVIEWREADY_TEST_TOKEN;
    }

    expect(createGitHubAuditClient).toHaveBeenCalledWith("secret-token");
    expect(collectRepositoryAuditSnapshot).toHaveBeenCalledWith(
      "octocat",
      "demo",
      expect.anything(),
      expect.objectContaining({
        branch: "main",
        protectedWorkflowPaths: [".github/workflows/reviewready.yml"],
        trustedWorkflowPaths: [".github/workflows/reviewready.yml"]
      })
    );
  });

  it("maps an oversized environment token to a stable CLI input error", async () => {
    const io = capture();
    vi.mocked(createGitHubAuditClient).mockClear();
    process.env.REVIEWREADY_TEST_TOKEN = "x".repeat(16_385);

    try {
      expect(
        await runCli(
          [
            "audit",
            "collect",
            "--github",
            "ahoooooooo/reviewready",
            "--revision",
            "a".repeat(40),
            "--token-env",
            "REVIEWREADY_TEST_TOKEN"
          ],
          io
        )
      ).toBe(2);
    } finally {
      delete process.env.REVIEWREADY_TEST_TOKEN;
    }

    expect(io.stderrLines.join("\n")).toContain("CLI_GITHUB_TOKEN_INVALID");
    expect(createGitHubAuditClient).not.toHaveBeenCalled();
  });

  it("collects an evidence bundle through the raw stdout sink", async () => {
    const io = capture();
    vi.mocked(createGitHubAuditClient).mockReturnValue({} as never);
    vi.mocked(collectRepositoryAuditEvidenceData).mockResolvedValue(evidenceCollectionResult());
    process.env.REVIEWREADY_TEST_TOKEN = "secret-token";

    try {
      expect(
        await runCli(
          [
            "audit",
            "collect",
            "--github",
            "ahoooooooo/reviewready",
            "--revision",
            "a".repeat(40),
            "--token-env",
            "REVIEWREADY_TEST_TOKEN"
          ],
          io
        )
      ).toBe(0);
    } finally {
      delete process.env.REVIEWREADY_TEST_TOKEN;
    }

    expect(io.stdoutLines).toEqual([]);
    expect(io.stdoutByteChunks).toHaveLength(1);
    const emitted = io.stdoutByteChunks[0];
    if (emitted === undefined) {
      throw new Error("evidence bytes were not emitted");
    }
    expect(() => parseCanonicalJsonBytes(emitted)).not.toThrow();
    expect(collectRepositoryAuditEvidenceData).toHaveBeenCalledWith(
      "ahoooooooo",
      "reviewready",
      expect.anything(),
      expect.objectContaining({ revision: "a".repeat(40) })
    );
  });

  it("does not write a bundle before final replay validation succeeds", async () => {
    const io = capture();
    vi.mocked(createGitHubAuditClient).mockReturnValue({} as never);
    vi.mocked(collectRepositoryAuditEvidenceData).mockResolvedValue(evidenceCollectionResult());
    const hydrateSpy = vi
      .spyOn(auditEvidenceBundleModule, "hydrateAuditEvidenceBundle")
      .mockImplementation(() => {
        throw new Error("replay mismatch");
      });
    process.env.REVIEWREADY_TEST_TOKEN = "secret-token";

    try {
      expect(
        await runCli(
          [
            "audit",
            "collect",
            "--github",
            "ahoooooooo/reviewready",
            "--revision",
            "a".repeat(40),
            "--token-env",
            "REVIEWREADY_TEST_TOKEN"
          ],
          io
        )
      ).toBe(2);
    } finally {
      delete process.env.REVIEWREADY_TEST_TOKEN;
      hydrateSpy.mockRestore();
    }

    expect(io.stdoutByteChunks).toEqual([]);
    expect(io.stderrLines.join("\n")).toContain("AUDIT_EVIDENCE_COLLECTION_FAILED");
  });

  it("maps unsupported remote audit semantics to a stable redacted CLI error", async () => {
    const io = capture();
    vi.mocked(createGitHubAuditClient).mockReturnValue({} as never);
    vi.mocked(collectRepositoryAuditEvidenceData).mockRejectedValue(
      new AuditCollectionFailure("evidence-unsupported-semantics")
    );
    process.env.REVIEWREADY_TEST_TOKEN = "secret-token";

    try {
      expect(
        await runCli(
          [
            "audit",
            "collect",
            "--github",
            "ahoooooooo/reviewready",
            "--revision",
            "a".repeat(40),
            "--token-env",
            "REVIEWREADY_TEST_TOKEN"
          ],
          io
        )
      ).toBe(2);
    } finally {
      delete process.env.REVIEWREADY_TEST_TOKEN;
    }

    expect(io.stderrLines.join("\n")).toContain("AUDIT_EVIDENCE_UNSUPPORTED_SEMANTICS");
    expect(io.stderrLines.join("\n")).not.toContain("evidence-unsupported-semantics");
    expect(io.stderrLines.join("\n")).not.toContain("secret-token");
  });

  it("uses audit-specific wording for invalid snapshot JSON", async () => {
    const io = capture();
    io.readFile = () => Promise.resolve("{");

    expect(await runCli(["audit", "--input", "audit.json"], io)).toBe(2);
    expect(io.stderrLines.join("\n")).toContain("Audit input is not valid JSON.");
    expect(io.stderrLines.join("\n")).not.toContain("Pull-request input");
  });

  it("returns incomplete audits with exit code 2 and supports SARIF", async () => {
    const io = capture();
    io.readFile = () => Promise.resolve("{}");

    expect(await runCli(["audit", "--input", "audit.json", "--sarif"], io)).toBe(2);
    const sarif = JSON.parse(io.stdoutLines.join("")) as { version?: unknown };
    expect(sarif.version).toBe("2.1.0");
    expect(io.stderrLines).toEqual([]);
  });

  it("escapes control characters in audit terminal output", async () => {
    const io = capture();
    const hostile = snapshot.replace(
      '"requiredChecks":[]',
      '"requiredChecks": [{"name":"\\u001b]0;owned","appId":1}]'
    );
    io.readFile = () => Promise.resolve(hostile);

    expect(await runCli(["audit", "--input", "audit.json"], io)).toBe(2);
    const output = io.stdoutLines.join("\n");
    expect(output).not.toContain("\u001b");
    expect(output).not.toContain("\\u001b");
    expect(output).toContain("AUDIT_INPUT_INVALID");
  });

  it("rejects readiness-only and conflicting audit options", async () => {
    const policyIo = capture();
    const conflictIo = capture();

    expect(
      await runCli(["audit", "--policy", "policy.yml", "--input", "audit.json"], policyIo)
    ).toBe(2);
    expect(await runCli(["audit", "--input", "audit.json", "--json", "--sarif"], conflictIo)).toBe(
      2
    );
    expect(policyIo.stderrLines.join("\n")).toContain("--policy");
    expect(conflictIo.stderrLines.join("\n")).toContain("mutually exclusive");
  });

  it("replays a canonical evidence bundle without contacting GitHub", async () => {
    const io = capture();
    const bytes = replayBundle();
    io.readBytes = () => Promise.resolve(bytes);

    expect(await runCli(["audit", "replay", "--bundle", "audit.bundle", "--json"], io)).toBe(0);
    expect(JSON.parse(io.stdoutLines.join(""))).toMatchObject({
      auditVersion: 1,
      status: "pass"
    });
    expect(io.stderrLines).toEqual([]);
  });

  it("rejects replay when the supplied bundle digest does not match", async () => {
    const io = capture();
    io.readBytes = () => Promise.resolve(replayBundle());

    expect(
      await runCli(
        [
          "audit",
          "replay",
          "--bundle",
          "audit.bundle",
          "--bundle-sha256",
          "0".repeat(64),
          "--json"
        ],
        io
      )
    ).toBe(2);
    expect(io.stderrLines.join("\n")).toContain("digest mismatch");
  });

  it("accepts an uppercase form of the correct bundle digest", async () => {
    const io = capture();
    const bytes = replayBundle();
    io.readBytes = () => Promise.resolve(bytes);
    const digest = createHash("sha256").update(bytes).digest("hex").toUpperCase();

    expect(
      await runCli(
        ["audit", "replay", "--bundle", "audit.bundle", "--bundle-sha256", digest, "--json"],
        io
      )
    ).toBe(0);
    expect(JSON.parse(io.stdoutLines.join(""))).toMatchObject({
      auditVersion: 1,
      status: "pass"
    });
  });

  it("rejects missing values and invalid option combinations before file access", async () => {
    const cases: readonly (readonly [string[], string])[] = [
      [["validate", "--policy"], "requires a path"],
      [["validate", "--policy", "--json"], "requires a path"],
      [["check", "--policy", "one", "--input"], "requires a path"],
      [["check", "--policy", "one", "--input", "two", "--input", "three"], "only once"],
      [["audit", "--github", "one", "--github", "two"], "only once"],
      [["audit", "replay", "--bundle", "one", "--bundle", "two"], "only once"],
      [
        ["audit", "collect", "--revision", "a".repeat(40), "--revision", "b".repeat(40)],
        "only once"
      ],
      [["audit", "--ref", "main", "--ref", "develop"], "only once"],
      [["audit", "--policy-path", "one", "--policy-path", "two"], "only once"],
      [["audit", "--token-env", "ONE", "--token-env", "TWO"], "only once"],
      [["validate", "--bundle", "bundle"], "only valid"],
      [["audit", "replay"], "requires"],
      [["audit", "replay", "--bundle", "bundle", "--input", "input"], "only --bundle"],
      [["audit", "collect"], "requires"],
      [["audit", "collect", "--github", "owner/repo", "--revision", "short"], "40-character"],
      [
        ["audit", "collect", "--github", "owner/repo", "--revision", "a".repeat(40), "--json"],
        "without a renderer"
      ],
      [["audit", "--bundle", "bundle"], "collect or audit replay"],
      [["validate", "--github", "owner/repo"], "only valid with"],
      [["audit", "--github", "owner/repo", "--input", "input"], "mutually exclusive"],
      [["audit", "--ref", "main"], "require --github"],
      [["audit"], "either"],
      [["explain", "--policy", "policy", "--sarif"], "only valid with"],
      [["audit", "--input", "input", "--json", "--sarif"], "mutually exclusive"]
    ];

    for (const [argv, message] of cases) {
      const io = capture();
      expect(await runCli(argv, io)).toBe(2);
      expect(io.stderrLines.join("\n")).toContain(message);
    }
  });

  it("validates live targets, token environment names, and all file failure mappings", async () => {
    const invalidTarget = capture();
    expect(await runCli(["audit", "--github", "not a target"], invalidTarget)).toBe(2);
    expect(invalidTarget.stderrLines.join("\n")).toContain("owner/repo");

    const invalidTokenEnv = capture();
    expect(
      await runCli(["audit", "--github", "owner/repo", "--token-env", "not-valid"], invalidTokenEnv)
    ).toBe(2);
    expect(invalidTokenEnv.stderrLines.join("\n")).toContain("token environment name");

    const readFailed = capture();
    readFailed.readFile = () => Promise.reject(new CliFileError("read_failed"));
    expect(await runCli(["validate", "--policy", "private.yml"], readFailed)).toBe(2);
    expect(readFailed.stderrLines.join("\n")).toContain("POLICY_FILE_READ_FAILED");

    const missingBundle = capture();
    expect(await runCli(["audit", "replay", "--bundle", "private.bundle"], missingBundle)).toBe(2);
    expect(missingBundle.stderrLines.join("\n")).toContain("AUDIT_BUNDLE_FILE_NOT_FOUND");

    const invalidBundle = capture();
    invalidBundle.readBytes = () => Promise.resolve(new TextEncoder().encode("{}"));
    expect(await runCli(["audit", "replay", "--bundle", "bundle"], invalidBundle)).toBe(2);
    expect(invalidBundle.stderrLines.join("\n")).toContain("AUDIT_BUNDLE_INVALID");
  });

  it("maps revision instability, unknown collection failures, and missing raw sinks", async () => {
    const revisionIo = capture();
    vi.mocked(createGitHubAuditClient).mockReturnValue({} as never);
    vi.mocked(collectRepositoryAuditEvidenceData).mockRejectedValue(
      new AuditCollectionFailure("evidence-revision-not-stable")
    );
    process.env.REVIEWREADY_TEST_TOKEN = "secret-token";
    try {
      expect(
        await runCli(
          [
            "audit",
            "collect",
            "--github",
            "owner/repo",
            "--revision",
            "a".repeat(40),
            "--token-env",
            "REVIEWREADY_TEST_TOKEN"
          ],
          revisionIo
        )
      ).toBe(2);
    } finally {
      delete process.env.REVIEWREADY_TEST_TOKEN;
    }
    expect(revisionIo.stderrLines.join("\n")).toContain("AUDIT_EVIDENCE_REVISION_UNSTABLE");

    const unknownIo = capture();
    vi.mocked(collectRepositoryAuditEvidenceData).mockRejectedValue(
      new AuditEvidenceCollectionError("unexpected")
    );
    process.env.REVIEWREADY_TEST_TOKEN = "secret-token";
    try {
      expect(
        await runCli(
          [
            "audit",
            "collect",
            "--github",
            "owner/repo",
            "--revision",
            "a".repeat(40),
            "--token-env",
            "REVIEWREADY_TEST_TOKEN"
          ],
          unknownIo
        )
      ).toBe(2);
    } finally {
      delete process.env.REVIEWREADY_TEST_TOKEN;
    }
    expect(unknownIo.stderrLines.join("\n")).toContain("AUDIT_EVIDENCE_COLLECTION_FAILED");

    const noRawSink = capture();
    Object.defineProperty(noRawSink, "stdoutBytes", {
      configurable: true,
      value: undefined,
      writable: true
    });
    vi.mocked(collectRepositoryAuditEvidenceData).mockResolvedValue(evidenceCollectionResult());
    process.env.REVIEWREADY_TEST_TOKEN = "secret-token";
    try {
      expect(
        await runCli(
          [
            "audit",
            "collect",
            "--github",
            "owner/repo",
            "--revision",
            "a".repeat(40),
            "--token-env",
            "REVIEWREADY_TEST_TOKEN"
          ],
          noRawSink
        )
      ).toBe(2);
    } finally {
      delete process.env.REVIEWREADY_TEST_TOKEN;
    }
    expect(noRawSink.stderrLines.join("\n")).toContain("AUDIT_RAW_OUTPUT_UNAVAILABLE");
  });

  it("exercises the bounded default CLI I/O sinks", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      expect(await runCli(["validate", "--policy", fixture(".reviewready.yml")])).toBe(0);
      const directory = await temporaryDirectory();
      const bundlePath = join(directory, "audit.bundle");
      await writeFile(bundlePath, replayBundle());
      expect(await runCli(["audit", "replay", "--bundle", bundlePath])).toBe(0);

      vi.mocked(createGitHubAuditClient).mockReturnValue({} as never);
      vi.mocked(collectRepositoryAuditEvidenceData).mockResolvedValue(evidenceCollectionResult());
      process.env.REVIEWREADY_TEST_TOKEN = "secret-token";
      try {
        expect(
          await runCli([
            "audit",
            "collect",
            "--github",
            "owner/repo",
            "--revision",
            "a".repeat(40),
            "--token-env",
            "REVIEWREADY_TEST_TOKEN"
          ])
        ).toBe(0);
      } finally {
        delete process.env.REVIEWREADY_TEST_TOKEN;
      }
      expect(await runCli(["unknown"])).toBe(2);
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });
});
