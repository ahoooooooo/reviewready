import { z } from "zod";

import { checkConclusions, type PullRequestInput } from "./domain.js";
import { InputError } from "./errors.js";

const shortText = z.string().min(1).max(500);
const MAX_EXPANDED_PATHS = 3000;

const inputSchema = z
  .object({
    version: z.literal(1),
    changedFiles: z.array(z.string().max(4096)).max(3000),
    previousChangedFiles: z.array(z.string().max(4096)).max(3000).optional(),
    body: z.string().max(1_000_000),
    labels: z.array(shortText).max(100),
    linkedIssues: z.array(z.number().int().positive()).max(100),
    checks: z
      .array(
        z
          .object({
            name: shortText,
            conclusion: z.enum(checkConclusions).nullable(),
            app: shortText.optional()
          })
          .strict()
      )
      .max(1000),
    reviews: z
      .array(
        z
          .object({
            login: shortText,
            state: z.enum(["approved", "changes_requested", "commented", "dismissed"]),
            maintainer: z.boolean(),
            submittedAt: z.iso.datetime({ offset: true }).optional()
          })
          .strict()
      )
      .max(1000)
  })
  .strict();

export function normalizeRepositoryPath(value: string): string {
  if (value.includes("\\")) {
    throw new InputError(
      "INPUT_GIT_PATH_INVALID",
      "Repository paths must use '/' separators; literal backslashes are not valid Git paths."
    );
  }

  const normalized = value;
  const unsafe =
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//u.test(normalized) ||
    normalized.includes("\0") ||
    normalized.split("/").some((segment) => segment === "" || segment === "." || segment === "..");

  if (unsafe) {
    throw new InputError(
      "INPUT_UNSAFE_PATH",
      "Changed file paths must be repository-relative paths without traversal."
    );
  }
  return normalized;
}

export function normalizeInput(value: unknown): PullRequestInput {
  const parsed = inputSchema.safeParse(value);
  if (!parsed.success) {
    const details = parsed.error.issues
      .slice(0, 10)
      .map(
        (issue) => `${issue.path.length === 0 ? "<root>" : issue.path.join(".")}: ${issue.message}`
      )
      .join("; ");
    throw new InputError("INPUT_SCHEMA_INVALID", `Pull-request input is invalid: ${details}`);
  }

  const changedFiles = [...new Set(parsed.data.changedFiles.map(normalizeRepositoryPath))];
  const previousChangedFiles =
    parsed.data.previousChangedFiles === undefined
      ? undefined
      : [...new Set(parsed.data.previousChangedFiles.map(normalizeRepositoryPath))];
  const expandedPaths = new Set([...changedFiles, ...(previousChangedFiles ?? [])]);
  if (expandedPaths.size > MAX_EXPANDED_PATHS) {
    throw new InputError(
      "INPUT_TOO_MANY_PATHS",
      `Changed and previous repository paths exceed the expanded path limit of ${String(MAX_EXPANDED_PATHS)}.`
    );
  }

  return {
    ...parsed.data,
    changedFiles,
    ...(previousChangedFiles === undefined ? {} : { previousChangedFiles }),
    labels: [...new Set(parsed.data.labels)],
    linkedIssues: [...new Set(parsed.data.linkedIssues)]
  };
}
