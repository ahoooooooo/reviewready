import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

const configuredCoverageDirectory = process.env.REVIEWREADY_COVERAGE_DIRECTORY?.trim();
const coverageDirectory =
  configuredCoverageDirectory ||
  (process.env.CI !== undefined
    ? "coverage"
    : join(tmpdir(), "reviewready-coverage-" + String(process.pid)));

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      reportsDirectory: coverageDirectory,
      include: [
        "src/engine.ts",
        "src/input.ts",
        "src/matcher.ts",
        "src/policy.ts",
        "src/github.ts",
        "src/github-api.ts",
        "src/audit.ts",
        "src/github-audit.ts",
        "src/github-audit-api.ts",
        "src/audit-evidence.ts",
        "src/audit-evidence-bundle.ts",
        "src/audit-evidence-collection.ts",
        "src/cli.ts",
        "src/file-reader.ts",
        "src/ta3-ingress.ts"
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
