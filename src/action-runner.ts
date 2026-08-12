import { evaluate } from "./engine.js";
import { escapeControlCharacters, PlatformError, ReviewReadyError } from "./errors.js";
import type { GitHubGateway } from "./github.js";
import { loadGitHubPullRequest } from "./github.js";
import { renderJson, renderMarkdown } from "./report.js";

export const MAX_REPORT_JSON_BYTES = 1_000_000;
export const MAX_MARKDOWN_SUMMARY_BYTES = 1_048_576;

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

function ensureActionPublicationSize(
  value: string,
  limit: number,
  code: "ACTION_REPORT_TOO_LARGE" | "ACTION_SUMMARY_TOO_LARGE",
  description: string
): void {
  if (Buffer.byteLength(value, "utf8") > limit) {
    throw new PlatformError(
      code,
      description + " exceeds the " + String(limit) + "-byte UTF-8 limit."
    );
  }
}

async function publishActionResult(
  runtime: ActionRuntime,
  status: "ready" | "not_ready",
  reportJson: string,
  summary: string
): Promise<void> {
  try {
    await runtime.writeSummary(summary);
    runtime.setOutput("report-json", reportJson);
    runtime.setOutput("status", status);
  } catch {
    throw new PlatformError(
      "ACTION_PUBLICATION_FAILED",
      "ReviewReady could not publish the Action result."
    );
  }
}

export async function runAction(runtime: ActionRuntime): Promise<void> {
  try {
    if (
      runtime.eventName !== "pull_request" &&
      runtime.eventName !== "pull_request_review" &&
      runtime.eventName !== "pull_request_target"
    ) {
      throw new PlatformError(
        "GITHUB_EVENT_UNSUPPORTED",
        'ReviewReady must run on a "pull_request", "pull_request_review", or "pull_request_target" event.'
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
    const summary = renderMarkdown(result);
    const reportJson = renderJson(result);

    ensureActionPublicationSize(
      reportJson,
      MAX_REPORT_JSON_BYTES,
      "ACTION_REPORT_TOO_LARGE",
      "The Action report-json output"
    );
    ensureActionPublicationSize(
      summary,
      MAX_MARKDOWN_SUMMARY_BYTES,
      "ACTION_SUMMARY_TOO_LARGE",
      "The Action Markdown summary"
    );
    await publishActionResult(runtime, result.status, reportJson, summary);

    if (result.status === "not_ready") {
      runtime.setFailed("ReviewReady: required review evidence is missing.");
    }
  } catch (error) {
    if (error instanceof ReviewReadyError) {
      runtime.setFailed(
        `[${escapeControlCharacters(error.code)}] ${escapeControlCharacters(error.message)}`
      );
      return;
    }
    runtime.setFailed("[INTERNAL_ERROR] ReviewReady could not complete the action.");
  }
}
