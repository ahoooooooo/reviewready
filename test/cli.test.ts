import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { runCli, type CliIo } from "../src/cli.js";

const fixture = (...parts: string[]): string => resolve("fixtures", "basic", ...parts);

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
    expect(io.stdoutLines.join("\n")).toContain("human attestation");
  });

  it("rejects missing required options with usage guidance", async () => {
    const io = capture();
    const exitCode = await runCli(["check", "--policy", "policy.yml"], io);

    expect(exitCode).toBe(2);
    expect(io.stderrLines.join("\n")).toContain("[CLI_USAGE]");
    expect(io.stderrLines.join("\n")).toContain("--input");
  });

  it("rejects unknown commands and options", async () => {
    const commandIo = capture();
    const optionIo = capture();

    expect(await runCli(["unknown", "--policy", "policy.yml"], commandIo)).toBe(2);
    expect(await runCli(["validate", "--policy", "policy.yml", "--wat"], optionIo)).toBe(2);
    expect(commandIo.stderrLines[0]).toContain("[CLI_USAGE]");
    expect(optionIo.stderrLines[0]).toContain("Unknown option");
  });

  it("redacts unexpected file-system errors", async () => {
    const io = capture();
    io.readFile = () => Promise.reject(new Error("private machine detail"));

    expect(await runCli(["validate", "--policy", "policy.yml"], io)).toBe(2);
    expect(io.stderrLines).toEqual([
      "[INTERNAL_ERROR] ReviewReady could not complete the command."
    ]);
  });
});
