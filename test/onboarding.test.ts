import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import { runCli, type CliIo } from "../src/cli.js";
import { evaluate } from "../src/engine.js";
import {
  DEMO_NOT_READY_INPUT,
  DEMO_READY_INPUT,
  initializeStarterPolicy,
  renderDemo,
  STARTER_POLICY,
  STARTER_POLICY_PATH
} from "../src/onboarding.js";
import { parsePolicy } from "../src/policy.js";

function errorWithCode(code: string): NodeJS.ErrnoException {
  const error = new Error("private local path") as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

function capture(createFile?: (path: string, content: string) => Promise<void>): CliIo & {
  stdoutLines: string[];
  stderrLines: string[];
} {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  return {
    readFile,
    stdout: (value) => stdoutLines.push(value),
    stderr: (value) => stderrLines.push(value),
    ...(createFile === undefined ? {} : { createFile }),
    stdoutLines,
    stderrLines
  };
}

describe("next-minor onboarding", () => {
  it("keeps the built-in demo and checked-in examples deterministic", async () => {
    const [examplePolicy, readySource, notReadySource] = await Promise.all([
      readFile("examples/quickstart/.reviewready.yml", "utf8"),
      readFile("examples/quickstart/ready.json", "utf8"),
      readFile("examples/quickstart/not-ready.json", "utf8")
    ]);
    const policy = parsePolicy(STARTER_POLICY);

    expect(examplePolicy).toBe(STARTER_POLICY);
    expect(JSON.parse(readySource)).toEqual(DEMO_READY_INPUT);
    expect(JSON.parse(notReadySource)).toEqual(DEMO_NOT_READY_INPUT);
    expect(evaluate(policy, DEMO_READY_INPUT).status).toBe("ready");
    expect(evaluate(policy, DEMO_NOT_READY_INPUT).status).toBe("not_ready");
  });

  it("renders both expected outcomes without reading or writing files", async () => {
    const createFile = vi.fn<NonNullable<CliIo["createFile"]>>();
    const io = capture(createFile);
    io.readFile = vi.fn(() => Promise.reject(new Error("unexpected read")));

    expect(await runCli(["demo"], io)).toBe(0);
    expect(io.stdoutLines.join("\n")).toContain("READY EXAMPLE");
    expect(io.stdoutLines.join("\n")).toContain("READY FOR HUMAN REVIEW");
    expect(io.stdoutLines.join("\n")).toContain("MISSING-EVIDENCE EXAMPLE");
    expect(io.stdoutLines.join("\n")).toContain("NOT READY FOR HUMAN REVIEW");
    expect(io.stderrLines).toEqual([]);
    expect(io.readFile).not.toHaveBeenCalled();
    expect(createFile).not.toHaveBeenCalled();
    expect(renderDemo()).toBe(io.stdoutLines[0]);
  });

  it("creates one starter policy without touching any other path", async () => {
    const createFile = vi.fn<NonNullable<CliIo["createFile"]>>().mockResolvedValue(undefined);
    const io = capture(createFile);

    expect(await runCli(["init"], io)).toBe(0);
    expect(createFile).toHaveBeenCalledOnce();
    expect(createFile).toHaveBeenCalledWith(STARTER_POLICY_PATH, STARTER_POLICY);
    expect(io.stdoutLines).toEqual([
      "Created .reviewready.yml without overwriting existing files. Next: reviewready validate --policy .reviewready.yml"
    ]);
    expect(io.stderrLines).toEqual([]);
  });

  it("refuses to overwrite an existing policy and redacts local failures", async () => {
    const existing = capture(() => Promise.reject(errorWithCode("EEXIST")));
    const unexpected = capture(() => Promise.reject(new Error("C:\\private\\project")));

    expect(await runCli(["init"], existing)).toBe(2);
    expect(existing.stderrLines).toEqual([
      "[INIT_ALREADY_EXISTS] A .reviewready.yml file already exists; no file was overwritten."
    ]);
    expect(await runCli(["init"], unexpected)).toBe(2);
    expect(unexpected.stderrLines).toEqual([
      "[INIT_WRITE_FAILED] The starter policy could not be created."
    ]);
    expect(unexpected.stderrLines.join("\n")).not.toContain("private");
  });

  it.each(["EACCES", "EPERM", "EROFS"])(
    "maps %s to a stable non-writable-directory error",
    async (code) => {
      const io = capture(() => Promise.reject(errorWithCode(code)));

      expect(await runCli(["init"], io)).toBe(2);
      expect(io.stderrLines).toEqual([
        "[INIT_FILE_ACCESS_DENIED] The starter policy could not be created because the directory is not writable."
      ]);
    }
  );

  it("fails closed when the host does not expose exclusive file creation", async () => {
    const io = capture();

    expect(await runCli(["init"], io)).toBe(2);
    expect(io.stderrLines).toEqual([
      "[INIT_WRITE_UNAVAILABLE] The current CLI environment cannot create a starter policy."
    ]);
  });

  it("rejects readiness and audit options for onboarding commands", async () => {
    for (const argv of [
      ["init", "--policy", "policy.yml"],
      ["init", "--protected-workflow", "workflow.yml"],
      ["demo", "--json"],
      ["demo", "--sarif"]
    ]) {
      const io = capture(vi.fn<NonNullable<CliIo["createFile"]>>());
      expect(await runCli(argv, io)).toBe(2);
      expect(io.stderrLines.join("\n")).toContain("does not accept options");
    }
  });

  it("maps non-Error initialization failures without leaking values", async () => {
    await expect(
      initializeStarterPolicy(() => {
        // An injected host adapter can reject with any JavaScript value.
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        return Promise.reject("private value");
      })
    ).rejects.toMatchObject({ code: "INIT_WRITE_FAILED" });
  });
});
