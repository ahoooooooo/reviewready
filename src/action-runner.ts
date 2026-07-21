import { evaluate } from "./engine.js";
import { PlatformError, ReviewReadyError } from "./errors.js";
import type { GitHubGateway } from "./github.js";
import { loadGitHubPullRequest } from "./github.js";
import { renderMarkdown } from "./report.js";

export interface ActionRuntime {
  eventName: string;
  event: unknown;
  getInput: (name: "token" | "policy-path") => string;
  createGateway: (token: string) => GitHubGateway;
  setOutput: (name: "status" | "report-json", value: string) => void;
  setFailed: (message: string) => void;
  writeSummary: (markdown: string) => Promise<void>;
}

function requiredToken(runtime: ActionRuntime): string {
  const token = runtime.getInput("token").trim();
  if (token.length === 0) {
    throw new PlatformError("GITHUB_TOKEN_MISSING", 'The action input "token" is required.');
  }
  return token;
}

export async function runAction(runtime: ActionRuntime): Promise<void> {
  try {
    if (runtime.eventName !== "pull_request" && runtime.eventName !== "pull_request_review") {
      throw new PlatformError(
        "GITHUB_EVENT_UNSUPPORTED",
        'ReviewReady must run on a "pull_request" or "pull_request_review" event.'
      );
    }

    const token = requiredToken(runtime);
    const requestedPath = runtime.getInput("policy-path").trim();
    const policyPath = requestedPath.length === 0 ? ".reviewready.yml" : requestedPath;
    const loaded = await loadGitHubPullRequest(
      runtime.event,
      policyPath,
      runtime.createGateway(token)
    );
    const result = evaluate(loaded.policy, loaded.input);

    runtime.setOutput("status", result.status);
    runtime.setOutput("report-json", JSON.stringify(result));
    await runtime.writeSummary(renderMarkdown(result));

    if (result.status === "not_ready") {
      runtime.setFailed("ReviewReady: required review evidence is missing.");
    }
  } catch (error) {
    if (error instanceof ReviewReadyError) {
      runtime.setFailed(`[${error.code}] ${error.message}`);
      return;
    }
    runtime.setFailed("[INTERNAL_ERROR] ReviewReady could not complete the action.");
  }
}
