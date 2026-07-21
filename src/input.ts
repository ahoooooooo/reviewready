import { z } from "zod";

import { checkConclusions, type PullRequestInput } from "./domain.js";
import { InputError } from "./errors.js";

const shortText = z.string().min(1).max(500);

const inputSchema = z
  .object({
    version: z.literal(1),
    changedFiles: z.array(z.string().max(4096)).max(3000),
    body: z.string().max(1_000_000),
    labels: z.array(shortText).max(100),
    linkedIssues: z.array(z.number().int().positive()).max(100),
    checks: z
      .array(
        z
          .object({
            name: shortText,
            conclusion: z.enum(checkConclusions),
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
            maintainer: z.boolean()
          })
          .strict()
      )
      .max(1000)
  })
  .strict();

export function normalizeRepositoryPath(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  const unsafe =
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//u.test(normalized) ||
    normalized.includes("\0") ||
    normalized.split("/").some((segment) => segment === "" || segment === "." || segment === "..");

  if (unsafe) {
    throw new InputError(
      "INPUT_UNSAFE_PATH",
      `Changed file path "${value}" must be a repository-relative path without traversal.`
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

  return {
    ...parsed.data,
    changedFiles: [...new Set(parsed.data.changedFiles.map(normalizeRepositoryPath))],
    labels: [...new Set(parsed.data.labels)],
    linkedIssues: [...new Set(parsed.data.linkedIssues)]
  };
}
