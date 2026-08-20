import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { recordFailure, resolveFailure, triageFailures } from "../scripts/agent-failure.mjs";

function logPath() {
  return join(mkdtempSync(join(tmpdir(), "reviewready-agent-failure-test-")), "failures.ndjson");
}

const baseFailure = {
  command: "npm run check",
  evidence: "EPERM opening node_modules/.vite-temp",
  failureClass: "environment",
  impact: "P1",
  next: "defer-external",
  stage: "proof",
  symptom: "Vitest config loader cannot write its temporary module"
} as const;

describe("agent failure batch log", () => {
  it("records bounded redacted failures without retrying", () => {
    const path = logPath();
    const entry = recordFailure({
      ...baseFailure,
      command: "npm run check --token=ghp_secret_should_not_survive",
      evidence: "provider token npm_123456789012345678901234567890123456 was not used",
      logPath: path
    });

    expect(entry).toMatchObject({
      failureClass: "environment",
      retryAllowed: false,
      status: "open"
    });
    const raw = readFileSync(path, "utf8");
    expect(raw).not.toContain("ghp_secret_should_not_survive");
    expect(raw).not.toContain("npm_123456789012345678901234567890123456");
  });

  it("redacts common bearer, key, URL, and provider token formats", () => {
    const path = logPath();
    const entry = recordFailure({
      ...baseFailure,
      command:
        "curl https://user:password@example.invalid --header " +
        "Authorization: Bearer " +
        "bearer-secret-value-1234567890",
      evidence:
        "api_key=api-secret-value access_token=access-secret-value " +
        "AKIAIOSFODNN7EXAMPLE sk-" +
        "secret-openai-value-1234567890 xoxb-" +
        "secret-slack-value-1234567890",
      logPath: path
    });

    expect(entry.command).not.toContain("password@example.invalid");
    expect(entry.command).not.toContain("bearer-secret-value-1234567890");
    expect(entry.evidence).not.toContain("api-secret-value");
    expect(entry.evidence).not.toContain("access-secret-value");
    expect(entry.evidence).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(entry.evidence).not.toContain("secret-openai-value-1234567890");
    expect(entry.evidence).not.toContain("secret-slack-value-1234567890");
  });

  it("groups repeated fingerprints for one batch repair", () => {
    const path = logPath();
    const first = recordFailure({ ...baseFailure, logPath: path });
    const second = recordFailure({ ...baseFailure, logPath: path });

    expect(second.fingerprint).toBe(first.fingerprint);
    expect(triageFailures(path)).toMatchObject({
      openGroups: [
        {
          count: 2,
          failureClass: "environment",
          fingerprint: first.fingerprint,
          status: "open"
        }
      ]
    });
  });

  it("resolves a batch without deleting its evidence", () => {
    const path = logPath();
    const entry = recordFailure({ ...baseFailure, logPath: path });
    resolveFailure({
      fingerprint: entry.fingerprint,
      logPath: path,
      resolution: "Use the runner config loader in the local gate"
    });

    expect(triageFailures(path)).toMatchObject({ openGroups: [] });
    expect(readFileSync(path, "utf8").split(/\r?\n/gu).filter(Boolean)).toHaveLength(2);
  });

  it("reopens a resolved fingerprint when the same failure recurs", () => {
    const path = logPath();
    const entry = recordFailure({ ...baseFailure, logPath: path });
    resolveFailure({
      fingerprint: entry.fingerprint,
      logPath: path,
      resolution: "Applied the bounded repair and verified it"
    });
    recordFailure({ ...baseFailure, logPath: path });

    expect(triageFailures(path)).toMatchObject({
      openGroups: [
        {
          count: 2,
          fingerprint: entry.fingerprint,
          status: "open"
        }
      ],
      resolvedGroups: []
    });
  });

  it("accepts the documented kebab-case command options", () => {
    const path = logPath();
    const entry = recordFailure({
      command: "node scripts/auth-status.mjs",
      evidence: "connected_context_required",
      failureClass: "environment",
      impact: "P2",
      logPath: path,
      next: "defer-external",
      stage: "proof",
      symptom: "credential context is unavailable"
    });

    expect(entry.fingerprint).toMatch(/^[0-9a-f]{24}$/u);
  });

  it("accepts the documented kebab-case options through the CLI", () => {
    const path = logPath();
    const output = execFileSync(
      process.execPath,
      [
        "scripts/agent-failure.mjs",
        "record",
        "--failure-class",
        "environment",
        "--impact",
        "P2",
        "--stage",
        "proof",
        "--next",
        "defer-external",
        "--command",
        "node scripts/auth-status.mjs",
        "--symptom",
        "connected context required",
        "--evidence",
        "sandbox",
        "--log",
        path
      ],
      { cwd: process.cwd(), encoding: "utf8" }
    );

    expect(JSON.parse(output)).toMatchObject({ failureClass: "environment", status: "open" });
  });
});
