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
        "src/github-api-boundaries.ts",
        "src/github-api-pagination.ts",
        "src/audit.ts",
        "src/github-audit.ts",
        "src/github-audit-api.ts",
        "src/github-audit-api-mappers.ts",
        "src/github-audit-api-primitives.ts",
        "src/audit-evidence.ts",
        "src/audit-evidence-artifact.ts",
        "src/audit-evidence-bundle.ts",
        "src/audit-evidence-bundle-primitives.ts",
        "src/audit-evidence-collection.ts",
        "src/audit-evidence-hydration.ts",
        "src/cli.ts",
        "src/file-reader.ts",
        "src/ta3-ingress-contracts.ts",
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
