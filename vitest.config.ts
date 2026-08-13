import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: [
        "src/engine.ts",
        "src/input.ts",
        "src/matcher.ts",
        "src/policy.ts",
        "src/github.ts",
        "src/github-api.ts",
        "src/audit.ts",
        "src/github-audit.ts",
        "src/github-audit-api.ts"
      ],
      thresholds: {
        perFile: true,
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90
      }
    },
    include: ["test/**/*.test.ts"]
  }
});
