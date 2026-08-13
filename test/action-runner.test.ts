import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import { evaluate } from "../src/engine.js";
import { runAction, type ActionRuntime } from "../src/action-runner.js";
import { runCli } from "../src/cli.js";
import type { GitHubGateway } from "../src/github.js";
import { parsePolicy } from "../src/policy.js";
import { renderJson, renderMarkdown } from "../src/report.js";

const baseSha = "a".repeat(40);
const headSha = "b".repeat(40);
const policy = await readFile("fixtures/basic/.reviewready.yml", "utf8");
const reportJsonLimitBytes = 1_000_000;
const markdownSummaryLimitBytes = 1_048_576;

const event = {
  repository: { name: "demo", owner: { login: "octocat" } },
  pull_request: {
    number: 42,
    body: [
      "## Testing",
      "Ran the unit tests.",
      "",
      "- [x] I understand and take responsibility for this change."
    ].join("\n"),
    labels: [],
    base: { sha: baseSha },
    head: { sha: headSha }
  }
};

function evaluationInput() {
  return {
    version: 1,
    changedFiles: ["src/index.ts"],
    body: "",
    labels: [],
    linkedIssues: [],
    checks: [],
    reviews: []
  };
}

function reportJsonLimitPolicy(): string {
  const rules = Array.from({ length: 95 }, (_, ruleIndex) => {
    const requirements = Array.from({ length: 50 }, (_, requirementIndex) => {
      const suffix = String(ruleIndex * 50 + requirementIndex).padStart(4, "0");
      return "{type: pr_body_section, heading: h" + suffix + "éé}";
    });
    const id = "r" + String(ruleIndex).padStart(2, "0") + "x".repeat(61);
    return (
      "- {id: " +
      id +
      ", when: {paths: {any: [src/**]}}, require: [" +
      requirements.join(", ") +
      "]}"
    );
  });
  return "version: 1\nrules:\n" + rules.join("\n") + "\n";
}

function markdownSummaryLimitPolicy(): string {
  const rules = Array.from({ length: 10 }, (_, ruleIndex) => {
    const requirements = Array.from({ length: 50 }, (_, requirementIndex) => {
      const index = ruleIndex * 50 + requirementIndex;
      const suffix = "é".repeat(index < 18 ? 80 : 0) + String(index).padStart(4, "0");
      const heading = "&".repeat(410) + suffix;
      return "{type: pr_body_section, heading: '" + heading + "'}";
    });
    return (
      "- {id: r" +
      String(ruleIndex) +
      ", when: {paths: {any: [src/**]}}, require: [" +
      requirements.join(", ") +
      "]}"
    );
  });
  return "version: 1\nrules:\n" + rules.join("\n") + "\n";
}

function gateway(
  files: readonly string[] = ["src/index.ts"],
  body: string = event.pull_request.body,
  policySource: string = policy
): GitHubGateway {
  return {
    getPullRequestSnapshot: () =>
      Promise.resolve({
        number: event.pull_request.number,
        baseSha,
        headSha,
        updatedAt: "2026-08-11T00:00:00Z",
        body,
        labels: []
      }),
    getFileAtRevision: () => Promise.resolve(policySource),
    listPullRequestFiles: () => Promise.resolve(files),
    listCheckRuns: () =>
      Promise.resolve([{ name: "test", conclusion: "success", app: "github-actions" }]),
    listPullRequestReviews: () => Promise.resolve([]),
    getRepositoryPermission: () => Promise.resolve("none"),
    listClosingIssueNumbers: () => Promise.resolve([7])
  };
}

function runtime(api: GitHubGateway): ActionRuntime & {
  outputs: Map<string, string>;
  outputCalls: string[];
  failures: string[];
  summaries: string[];
} {
  const outputs = new Map<string, string>();
  const outputCalls: string[] = [];
  const failures: string[] = [];
  const summaries: string[] = [];
  return {
    eventName: "pull_request",
    event,
    outputs,
    outputCalls,
    failures,
    summaries,
    getInput: (name) => (name === "token" ? "test-token" : ".reviewready.yml"),
    createGateway: () => api,
    setOutput: (name, value) => {
      outputCalls.push(name);
      outputs.set(name, value);
    },
    setFailed: (message) => failures.push(message),
    writeSummary: (markdown) => {
      summaries.push(markdown);
      return Promise.resolve();
    }
  };
}

describe("runAction", () => {
  it("publishes ready outputs and a job summary", async () => {
    const action = runtime(gateway());

    await runAction(action);

    expect(action.outputs.get("status")).toBe("ready");
    expect(JSON.parse(action.outputs.get("report-json") ?? "{}")).toMatchObject({
      outputVersion: 1,
      status: "ready"
    });
    expect(action.outputCalls).toEqual(["report-json", "status"]);
    expect(action.summaries.join("\n")).toContain("## ReviewReady: ready");
    expect(action.failures).toEqual([]);
  });

  it("keeps Action report-json semantically equal to CLI --json", async () => {
    const action = runtime({
      ...gateway(["src/index.ts"], event.pull_request.body, policy),
      listClosingIssueNumbers: () => Promise.resolve([42])
    });

    await runAction(action);

    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runCli(
      [
        "check",
        "--policy",
        "fixtures/basic/.reviewready.yml",
        "--input",
        "fixtures/basic/ready.json",
        "--json"
      ],
      {
        readFile,
        stdout: (value) => stdout.push(value),
        stderr: (value) => stderr.push(value)
      }
    );

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(JSON.parse(action.outputs.get("report-json") ?? "{}")).toEqual(
      JSON.parse(stdout.join(""))
    );
  });

  it("fails the check with an actionable not-ready summary", async () => {
    const action = runtime(gateway(["README.md", "src/index.ts"], ""));
    action.event = {
      ...event,
      pull_request: { ...event.pull_request, body: "" }
    };

    await runAction(action);

    expect(action.outputs.get("status")).toBe("not_ready");
    expect(action.summaries.join("\n")).toContain("### Missing");
    expect(action.failures).toEqual(["ReviewReady: required review evidence is missing."]);
  });

  it("does not publish readiness outputs when writing the summary fails", async () => {
    const action = runtime(gateway());
    action.writeSummary = () => Promise.reject(new Error("summary failed"));

    await runAction(action);

    expect(action.outputs).toEqual(new Map());
    expect(action.failures).toEqual([
      "[ACTION_PUBLICATION_FAILED] ReviewReady could not publish the Action result."
    ]);
  });

  it("rejects an over-limit report-json payload before writing to any Action sink", async () => {
    const oversizedPolicy = reportJsonLimitPolicy();
    const report = evaluate(parsePolicy(oversizedPolicy), evaluationInput());
    const json = renderJson(report);
    expect(json.length).toBeLessThan(reportJsonLimitBytes);
    expect(Buffer.byteLength(json, "utf8")).toBeGreaterThan(reportJsonLimitBytes);

    const action = runtime(gateway(["src/index.ts"], event.pull_request.body, oversizedPolicy));

    await runAction(action);

    expect(action.outputCalls).toEqual([]);
    expect(action.outputs).toEqual(new Map());
    expect(action.summaries).toEqual([]);
    expect(action.failures).toEqual([
      "[ACTION_REPORT_TOO_LARGE] The Action report-json output exceeds the 1000000-byte UTF-8 limit."
    ]);
  });

  it("rejects an over-limit Markdown summary before writing to any Action sink", async () => {
    const oversizedPolicy = markdownSummaryLimitPolicy();
    const report = evaluate(parsePolicy(oversizedPolicy), evaluationInput());
    const markdown = renderMarkdown(report);
    expect(markdown.length).toBeLessThan(markdownSummaryLimitBytes);
    expect(Buffer.byteLength(markdown, "utf8")).toBeGreaterThan(markdownSummaryLimitBytes);

    const action = runtime(gateway(["src/index.ts"], event.pull_request.body, oversizedPolicy));

    await runAction(action);

    expect(action.outputCalls).toEqual([]);
    expect(action.outputs).toEqual(new Map());
    expect(action.summaries).toEqual([]);
    expect(action.failures).toEqual([
      "[ACTION_SUMMARY_TOO_LARGE] The Action Markdown summary exceeds the 1048576-byte UTF-8 limit."
    ]);
  });

  it("does not publish status when the report-json output write fails", async () => {
    const action = runtime(gateway());
    action.setOutput = (name, value) => {
      action.outputCalls.push(name);
      if (name === "report-json") {
        throw new Error("report output failed");
      }
      action.outputs.set(name, value);
    };

    await runAction(action);

    expect(action.outputCalls).toEqual(["report-json"]);
    expect(action.outputs).toEqual(new Map());
    expect(action.summaries).toHaveLength(1);
    expect(action.failures).toEqual([
      "[ACTION_PUBLICATION_FAILED] ReviewReady could not publish the Action result."
    ]);
  });

  it("does not leave status=ready when the status output write fails", async () => {
    const action = runtime(gateway());
    action.setOutput = (name, value) => {
      action.outputCalls.push(name);
      if (name === "status") {
        throw new Error("status output failed");
      }
      action.outputs.set(name, value);
    };

    await runAction(action);

    expect(action.outputCalls).toEqual(["report-json", "status"]);
    expect(action.outputs.has("status")).toBe(false);
    expect(action.outputs.has("report-json")).toBe(true);
    expect(action.summaries).toHaveLength(1);
    expect(action.failures).toEqual([
      "[ACTION_PUBLICATION_FAILED] ReviewReady could not publish the Action result."
    ]);
  });

  it("rejects other event types before creating an API client", async () => {
    const action = runtime(gateway());
    const createGateway = vi.fn(() => gateway());
    action.eventName = "push";
    action.createGateway = createGateway;

    await runAction(action);

    expect(createGateway).not.toHaveBeenCalled();
    expect(action.failures[0]).toContain("[GITHUB_EVENT_UNSUPPORTED]");
  });

  it("rejects merge-group events instead of guessing per-PR evidence", async () => {
    const action = runtime(gateway());
    const createGateway = vi.fn(() => gateway());
    action.eventName = "merge_group";
    action.createGateway = createGateway;

    await runAction(action);

    expect(createGateway).not.toHaveBeenCalled();
    expect(action.failures[0]).toContain("[GITHUB_EVENT_UNSUPPORTED]");
  });

  it("accepts pull_request_target for trusted metadata-only evaluation", async () => {
    const action = runtime(gateway());
    action.eventName = "pull_request_target";

    await runAction(action);

    expect(action.outputs.get("status")).toBe("ready");
    expect(action.failures).toEqual([]);
  });

  it("reevaluates successfully when a review event arrives", async () => {
    const action = runtime(gateway());
    action.eventName = "pull_request_review";

    await runAction(action);

    expect(action.outputs.get("status")).toBe("ready");
    expect(action.failures).toEqual([]);
  });

  it("rejects an empty token before creating an API client", async () => {
    const action = runtime(gateway());
    const createGateway = vi.fn(() => gateway());
    action.getInput = () => "";
    action.createGateway = createGateway;

    await runAction(action);

    expect(createGateway).not.toHaveBeenCalled();
    expect(action.failures[0]).toContain("[GITHUB_TOKEN_MISSING]");
  });

  it("does not expose exception details or tokens in failure messages", async () => {
    const action = runtime(gateway());
    action.createGateway = () => {
      throw new Error("test-token must stay secret");
    };

    await runAction(action);

    expect(action.failures).toEqual([
      "[INTERNAL_ERROR] ReviewReady could not complete the action."
    ]);
  });

  it("escapes terminal control characters in Action failure messages", async () => {
    const action = runtime(gateway());
    action.createGateway = () => ({
      ...gateway(),
      getFileAtRevision: () =>
        Promise.resolve(policy.replace("src/**", "../secret\u001b]0;owned/**"))
    });

    await runAction(action);

    expect(action.failures[0]).not.toContain("\u001b");
    expect(action.failures[0]).toContain("\\u001b");
  });
});
