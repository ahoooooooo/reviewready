import type { PullRequestInput } from "./domain.js";
import { evaluate } from "./engine.js";
import { InputError, PlatformError } from "./errors.js";
import { parsePolicy } from "./policy.js";
import { renderText } from "./report.js";

export const STARTER_POLICY_PATH = ".reviewready.yml";

export const STARTER_POLICY = `# ReviewReady checks evidence presence, not correctness or approval.
version: 1
rules:
  - id: source-change
    description: Source changes need test notes and a linked issue.
    when:
      paths:
        any: ["src/**"]
    require:
      - type: pr_body_section
        heading: Testing
      - type: linked_issue
`;

export const DEMO_READY_INPUT = {
  version: 1,
  changedFiles: ["src/index.ts"],
  body: "## Testing\n\nnpm test passed.",
  labels: [],
  linkedIssues: [42],
  checks: [],
  reviews: []
} satisfies PullRequestInput;

export const DEMO_NOT_READY_INPUT = {
  version: 1,
  changedFiles: ["src/index.ts"],
  body: "",
  labels: [],
  linkedIssues: [],
  checks: [],
  reviews: []
} satisfies PullRequestInput;

export type CreateNewFile = (path: string, content: string) => Promise<void>;

function fileSystemErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null
    ? (error as NodeJS.ErrnoException).code
    : undefined;
}

export async function initializeStarterPolicy(createFile: CreateNewFile): Promise<void> {
  try {
    await createFile(STARTER_POLICY_PATH, STARTER_POLICY);
  } catch (error) {
    const code = fileSystemErrorCode(error);
    if (code === "EEXIST") {
      throw new InputError(
        "INIT_ALREADY_EXISTS",
        "A .reviewready.yml file already exists; no file was overwritten."
      );
    }
    if (code === "EACCES" || code === "EPERM" || code === "EROFS") {
      throw new PlatformError(
        "INIT_FILE_ACCESS_DENIED",
        "The starter policy could not be created because the directory is not writable.",
        { cause: error }
      );
    }
    throw new PlatformError("INIT_WRITE_FAILED", "The starter policy could not be created.", {
      cause: error
    });
  }
}

export function renderDemo(): string {
  const policy = parsePolicy(STARTER_POLICY);
  const ready = evaluate(policy, DEMO_READY_INPUT);
  const notReady = evaluate(policy, DEMO_NOT_READY_INPUT);

  return [
    "ReviewReady demo (offline and deterministic)",
    "READY EXAMPLE",
    renderText(ready),
    "MISSING-EVIDENCE EXAMPLE",
    renderText(notReady),
    "Demo complete. Run `reviewready init` in a repository to create a starter policy."
  ].join("\n\n");
}
