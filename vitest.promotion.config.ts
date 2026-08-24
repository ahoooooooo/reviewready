import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/package-manifest-promotion.test.ts", "test/release-readiness.test.ts"]
  }
});
