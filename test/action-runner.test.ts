import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import { runAction, type ActionRuntime } from "../src/action-runner.js";
import type { GitHubGateway } from "../src/github.js";

const baseSha = "a".repeat(40);
const headSha = "b".repeat(40);
const policy = await readFile("fixtures/basic/.reviewready.yml", "utf8");

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

function gateway(files: readonly string[] = ["src/index.ts"]): GitHubGateway {
  return {
    getFileAtRevision: () => Promise.resolve(policy),
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
  failures: string[];
  summaries: string[];
} {
  const outputs = new Map<string, string>();
  const failures: string[] = [];
  const summaries: string[] = [];
  return {
    eventName: "pull_request",
    event,
    outputs,
    failures,
    summaries,
    getInput: (name) => (name === "token" ? "test-token" : ".reviewready.yml"),
    createGateway: () => api,
    setOutput: (name, value) => outputs.set(name, value),
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
    expect(action.summaries.join("\n")).toContain("## ReviewReady: ready");
    expect(action.failures).toEqual([]);
  });

  it("fails the check with an actionable not-ready summary", async () => {
    const action = runtime(gateway(["README.md", "src/index.ts"]));
    action.event = {
      ...event,
      pull_request: { ...event.pull_request, body: "" }
    };

    await runAction(action);

    expect(action.outputs.get("status")).toBe("not_ready");
    expect(action.summaries.join("\n")).toContain("### Missing");
    expect(action.failures).toEqual(["ReviewReady: required review evidence is missing."]);
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
});
