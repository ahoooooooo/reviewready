import { describe, expect, it } from "vitest";

import { normalizeRepositoryPath } from "../src/input.js";

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
});
