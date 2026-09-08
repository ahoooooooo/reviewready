#!/usr/bin/env node
// @ts-check

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

const projectRoot = resolve(import.meta.dirname, "..");
const maximumChildProcessMs = 5_000;
/** @type {import("../src/domain.js").Policy} */
const policy = {
  version: 1,
  rules: [
    {
      id: "bounded-markdown",
      when: { paths: { any: ["src/**"] } },
      require: [{ type: "pr_body_section", heading: "Testing" }]
    }
  ]
};
const body = ["## Testing", "Visible evidence <div" + " ".repeat(4_000)].join("\n");
const overBudgetPrefix = "## Testing\nVisible evidence <div";
const overBudgetBody = overBudgetPrefix + " ".repeat(1_000_000 - overBudgetPrefix.length);
const input = {
  version: 1,
  changedFiles: ["src/index.ts"],
  body,
  labels: [],
  linkedIssues: [],
  checks: [],
  reviews: []
};

if (process.argv[2] === "--engine") {
  const { evaluate } = await import("../dist/engine.js");
  const result = evaluate(policy, input);
  if (result.status !== "ready") throw new Error("engine regression case changed classification");
  try {
    evaluate(policy, { ...input, body: overBudgetBody });
    throw new Error("engine accepted Markdown beyond the raw HTML operation budget");
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "INPUT_MARKDOWN_SCAN_BUDGET_EXCEEDED"
    ) {
      throw error;
    }
  }
  process.exit(0);
}

if (process.argv[2] === "--action") {
  const { runAction } = await import("../dist/action-runner.js");
  /** @param {string} actionBody */
  async function executeAction(actionBody) {
    /** @type {Map<string, string>} */
    const outputs = new Map();
    /** @type {string[]} */
    const failures = [];
    await runAction({
      eventName: "pull_request",
      event: {
        repository: { name: "demo", owner: { login: "octocat" } },
        pull_request: {
          number: 42,
          body: actionBody,
          labels: [],
          base: { sha: "a".repeat(40) },
          head: { sha: "b".repeat(40) }
        }
      },
      getInput: (name) => (name === "token" ? "test-token" : ".reviewready.yml"),
      createGateway: () => ({
        getPullRequestSnapshot: () =>
          Promise.resolve({
            number: 42,
            baseSha: "a".repeat(40),
            headSha: "b".repeat(40),
            updatedAt: "2026-09-08T00:00:00Z",
            body: actionBody,
            labels: []
          }),
        getFileAtRevision: () => Promise.resolve(JSON.stringify(policy)),
        listPullRequestFiles: () => Promise.resolve(["src/index.ts"]),
        listCheckRuns: () => Promise.resolve([]),
        listPullRequestReviews: () => Promise.resolve([]),
        getRepositoryPermission: () => Promise.resolve("none"),
        listClosingIssueNumbers: () => Promise.resolve([])
      }),
      setOutput: (name, value) => outputs.set(name, value),
      setFailed: (message) => failures.push(message),
      writeSummary: () => Promise.resolve()
    });
    return { outputs, failures };
  }
  const normal = await executeAction(body);
  if (normal.failures.length > 0 || normal.outputs.get("status") !== "ready") {
    throw new Error("Action-runner regression case changed classification");
  }
  const overBudget = await executeAction(overBudgetBody);
  if (
    overBudget.outputs.has("status") ||
    !overBudget.failures.some((message) =>
      message.includes("[INPUT_MARKDOWN_SCAN_BUDGET_EXCEEDED]")
    )
  ) {
    throw new Error("Action-runner did not fail closed beyond the raw HTML operation budget");
  }
  process.exit(0);
}

/**
 * @param {string} name
 * @param {readonly string[]} args
 * @param {number} [expectedStatus]
 * @param {string} [expectedStderr]
 */
function runBounded(name, args, expectedStatus = 0, expectedStderr) {
  const result = spawnSync(process.execPath, args, {
    cwd: projectRoot,
    encoding: "utf8",
    timeout: maximumChildProcessMs,
    windowsHide: true
  });
  if (result.error !== undefined) {
    throw new Error(`${name} exceeded the ${String(maximumChildProcessMs)} ms process limit`);
  }
  if (result.status !== expectedStatus) {
    throw new Error(`${name} exited ${String(result.status)}: ${result.stderr.trim()}`);
  }
  if (expectedStderr !== undefined && !result.stderr.includes(expectedStderr)) {
    throw new Error(`${name} did not emit the expected bounded failure`);
  }
}

runBounded("compiled engine", [import.meta.filename, "--engine"]);

const fixtureRoot = mkdtempSync(join(tmpdir(), "reviewready-markdown-bounds-"));
try {
  const policyPath = join(fixtureRoot, "policy.json");
  const inputPath = join(fixtureRoot, "input.json");
  const overBudgetInputPath = join(fixtureRoot, "over-budget-input.json");
  writeFileSync(policyPath, JSON.stringify(policy), "utf8");
  writeFileSync(inputPath, JSON.stringify(input), "utf8");
  writeFileSync(overBudgetInputPath, JSON.stringify({ ...input, body: overBudgetBody }), "utf8");
  runBounded("compiled CLI", [
    join(projectRoot, "dist", "cli.js"),
    "check",
    "--policy",
    policyPath,
    "--input",
    inputPath,
    "--json"
  ]);
  runBounded(
    "compiled CLI over-budget input",
    [
      join(projectRoot, "dist", "cli.js"),
      "check",
      "--policy",
      policyPath,
      "--input",
      overBudgetInputPath
    ],
    2,
    "[INPUT_MARKDOWN_SCAN_BUDGET_EXCEEDED]"
  );
  runBounded("compiled Action runner", [import.meta.filename, "--action"]);
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}

process.stdout.write("Bounded Markdown engine, CLI, and Action-runner checks passed.\n");
