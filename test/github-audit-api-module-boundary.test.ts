import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import * as facade from "../src/github-audit-api.js";
import { mapBranchProtection, mapRuleset } from "../src/github-audit-api-mappers.js";
import { AuditApiFailure } from "../src/github-audit-api-primitives.js";

async function lineCount(path: string): Promise<number> {
  return (await readFile(path, "utf8")).split("\n").length;
}

describe("GitHub audit API module boundary", () => {
  it("keeps the public facade stable while isolating response mappers", async () => {
    const [transport, mappers] = await Promise.all([
      readFile("src/github-audit-api.ts", "utf8"),
      readFile("src/github-audit-api-mappers.ts", "utf8")
    ]);

    expect(await lineCount("src/github-audit-api.ts")).toBeLessThan(1_350);
    expect(await lineCount("src/github-audit-api-mappers.ts")).toBeLessThan(800);
    expect(await lineCount("src/github-audit-api-primitives.ts")).toBeLessThan(130);
    expect(transport).not.toContain("function mapRuleset(");
    expect(mappers).not.toContain("./github-audit-api.js");
    expect(Object.keys(facade).sort()).toEqual(["AuditApiFailure", "createGitHubAuditClient"]);
    expect(facade.AuditApiFailure).toBe(AuditApiFailure);
  });
});

function expectCode(operation: () => unknown, code: string): void {
  expect(operation).toThrow(expect.objectContaining({ code }));
}

function branchProtection(requiredStatusChecks: unknown): Record<string, unknown> {
  return {
    required_status_checks: requiredStatusChecks,
    enforce_admins: { enabled: true },
    required_pull_request_reviews: null,
    allow_force_pushes: { enabled: false },
    allow_deletions: { enabled: false }
  };
}

function ruleset(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 7,
    name: "main",
    target: "branch",
    enforcement: "active",
    conditions: { ref_name: { include: ["~DEFAULT_BRANCH"] } },
    rules: [],
    bypass_actors: [],
    ...overrides
  };
}

describe("GitHub audit response mapper regressions", () => {
  it("fails closed on ambiguous legacy and structured status-check shapes", () => {
    expectCode(
      () => mapBranchProtection(branchProtection({ strict: true, checks: "invalid" }), "main"),
      "required-checks-invalid"
    );
    expectCode(
      () =>
        mapBranchProtection(
          branchProtection({ strict: true, checks: [], contexts: "invalid" }),
          "main"
        ),
      "required-contexts-invalid"
    );
    expectCode(
      () =>
        mapBranchProtection(branchProtection({ strict: true, checks: [], contexts: [1] }), "main"),
      "required-contexts-invalid"
    );
    expectCode(
      () => mapBranchProtection(branchProtection({ strict: true }), "main"),
      "required-checks-invalid"
    );
    expect(
      mapBranchProtection(
        branchProtection({
          strict: true,
          checks: [{ context: "ci", name: "ci", app_id: null }],
          contexts: ["ci"]
        }),
        "main"
      ).requiredStatusChecks
    ).toEqual({ strict: true, checks: [{ name: "ci" }] });
  });

  it("rejects malformed ruleset metadata and collection shapes", () => {
    const context = [7, "organization", "octocat", "demo"] as const;
    const invalid: readonly [Record<string, unknown>, string][] = [
      [ruleset({ source_type: "Repository" }), "ruleset-source-invalid"],
      [ruleset({ source_type: "Enterprise", source: "octocat/demo" }), "ruleset-source-invalid"],
      [ruleset({ created_at: "not-a-date" }), "ruleset-metadata-invalid"],
      [
        ruleset({ _links: { docs: { href: "https://api.github.com/rulesets/7" } } }),
        "ruleset-metadata-invalid"
      ],
      [
        ruleset({ _links: { self: { href: "ftp://api.github.com/rulesets/7" } } }),
        "ruleset-metadata-invalid"
      ],
      [ruleset({ conditions: { ref_name: { include: "main" } } }), "ruleset-scope-invalid"],
      [ruleset({ conditions: { ref_name: { include: [1] } } }), "ruleset-scope-invalid"],
      [
        ruleset({ conditions: { ref_name: { include: ["main"], exclude: "other" } } }),
        "ruleset-scope-invalid"
      ],
      [ruleset({ rules: {} }), "ruleset-rules-invalid"]
    ];

    for (const [value, code] of invalid) {
      expectCode(() => mapRuleset(value, ...context), code);
    }
  });

  it("binds organization and deploy-key bypass modes to supported scopes", () => {
    expectCode(
      () =>
        mapRuleset(
          ruleset({
            bypass_actors: [
              { actor_type: "OrganizationAdmin", actor_id: null, bypass_mode: "always" }
            ]
          }),
          7,
          "user",
          "octocat",
          "demo"
        ),
      "owner-type-invalid"
    );
    expectCode(
      () =>
        mapRuleset(
          ruleset({
            bypass_actors: [
              { actor_type: "DeployKey", actor_id: null, bypass_mode: "pull_request" }
            ]
          }),
          7,
          "organization",
          "octocat",
          "demo"
        ),
      "bypass-mode-invalid"
    );
  });
});
