import { describe, expect, it } from "vitest";

import { normalizeInput, normalizeRepositoryPath } from "../src/input.js";

function validInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    changedFiles: ["src/index.ts"],
    body: "",
    labels: [],
    linkedIssues: [],
    checks: [],
    reviews: [],
    ...overrides
  };
}

describe("normalizeRepositoryPath", () => {
  it.each(["README.md", "src/index.ts", ".github/workflows/ci.yml"])(
    "accepts a Git repository path with POSIX separators: %s",
    (path) => {
      expect(normalizeRepositoryPath(path)).toBe(path);
    }
  );

  it("rejects a literal backslash instead of rewriting Git data", () => {
    expect(() => normalizeRepositoryPath(String.raw`vendor\escape.ts`)).toThrow(
      expect.objectContaining({ code: "INPUT_GIT_PATH_INVALID" })
    );
  });

  it.each(["", "/etc/passwd", "../secret", "src/../secret", "C:/secret"])(
    "rejects unsafe repository path: %s",
    (path) => {
      expect(() => normalizeRepositoryPath(path)).toThrow(
        expect.objectContaining({ code: "INPUT_UNSAFE_PATH" })
      );
    }
  );

  it("rejects an expanded rename path set beyond the bounded total", () => {
    expect(() =>
      normalizeInput(
        validInput({
          changedFiles: Array.from({ length: 3000 }, (_, index) => `new/${String(index)}.ts`),
          previousChangedFiles: ["old/original.ts"]
        })
      )
    ).toThrow(expect.objectContaining({ code: "INPUT_TOO_MANY_PATHS" }));
  });

  it("deduplicates overlapping rename paths before enforcing the expanded bound", () => {
    const normalized = normalizeInput(
      validInput({
        changedFiles: Array.from({ length: 3000 }, (_, index) => `path/${String(index)}.ts`),
        previousChangedFiles: ["path/0.ts"]
      })
    );

    expect(normalized.changedFiles).toHaveLength(3000);
    expect(normalized.previousChangedFiles).toEqual(["path/0.ts"]);
  });

  it("validates unsafe previous rename paths at the input boundary", () => {
    expect(() => normalizeInput(validInput({ previousChangedFiles: ["../secret.ts"] }))).toThrow(
      expect.objectContaining({ code: "INPUT_UNSAFE_PATH" })
    );
  });

  it("reports malformed normalized input through the stable input error", () => {
    expect(() => normalizeInput(validInput({ version: 2 }))).toThrow(
      expect.objectContaining({ code: "INPUT_SCHEMA_INVALID" })
    );
  });
});
