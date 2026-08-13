import { mkdtemp, readFile, rm, symlink, writeFile, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runCli, type CliIo } from "../src/cli.js";
import { createGitHubAuditClient } from "../src/github-audit-api.js";
import { collectRepositoryAuditSnapshot } from "../src/github-audit.js";
import {
  CliFileError,
  MAX_CLI_FILE_BYTES,
  classifyFileReadFailure,
  classifyFileSystemError,
  readBoundedFile
} from "../src/file-reader.js";

vi.mock("../src/github-audit-api.js", () => ({ createGitHubAuditClient: vi.fn() }));
vi.mock("../src/github-audit.js", () => ({
  MAX_AUDIT_WORKFLOW_ROOTS: 100,
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

function capture(): CliIo & { stdoutLines: string[]; stderrLines: string[] } {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  return {
    stdoutLines,
    stderrLines,
    readFile,
    stdout: (value) => stdoutLines.push(value),
    stderr: (value) => stderrLines.push(value)
  };
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
      requiredPullRequestReviews: { requiredApprovingReviewCount: 1, bypassActors: [] }
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
    expect(output).toContain("\\u001b");
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
});
