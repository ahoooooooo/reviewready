import { describe, expect, it } from "vitest";

import { auditPackageEntries, loadPlannedPackageEntries } from "../scripts/verify-package.mjs";

describe("promotion package manifest", () => {
  it(
    "audits the exact npm dry-run package manifest from the repository",
    { timeout: 180_000 },
    () => {
      const entries = loadPlannedPackageEntries(process.cwd());

      expect(entries.length).toBeGreaterThan(0);
      expect(auditPackageEntries(entries)).toEqual([]);
    }
  );
});
