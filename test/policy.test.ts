import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import type { PolicyError } from "../src/errors.js";
import { parsePolicy } from "../src/policy.js";

const validPolicy = `
version: 1
rules:
  - id: source-change
    description: Source changes need test evidence.
    when:
      paths:
        any: ["src/**"]
      labels:
        none: ["skip-readiness"]
    require:
      - type: pr_body_section
        heading: Testing
      - type: linked_issue
      - type: check
        name: test
        conclusions: [success]
  - id: workflow-change
    when:
      paths:
        any: [".github/workflows/**"]
    require:
      - type: maintainer_review
        minimum: 1
      - type: human_attestation
        text: I understand and take responsibility for this change.
`;

describe("parsePolicy", () => {
  it("parses a closed version 1 policy", () => {
    const policy = parsePolicy(validPolicy);

    expect(policy.version).toBe(1);
    expect(policy.rules).toHaveLength(2);
    expect(policy.rules[0]?.require[2]).toEqual({
      type: "check",
      name: "test",
      conclusions: ["success"]
    });
  });

  it("defaults check conclusions to success", () => {
    const policy = parsePolicy(`
version: 1
rules:
  - id: checks
    when:
      labels:
        any: [ready]
    require:
      - type: check
        name: test
`);

    expect(policy.rules[0]?.require[0]).toEqual({
      type: "check",
      name: "test",
      conclusions: ["success"]
    });
  });

  it("rejects unknown fields instead of silently ignoring policy mistakes", () => {
    expect(() =>
      parsePolicy(validPolicy.replace("version: 1", "version: 1\nallow_merge: true"))
    ).toThrow(expect.objectContaining<Partial<PolicyError>>({ code: "POLICY_SCHEMA_INVALID" }));
  });

  it("rejects duplicate rule identifiers", () => {
    const duplicate = validPolicy.replace("id: workflow-change", "id: source-change");

    expect(() => parsePolicy(duplicate)).toThrow(
      expect.objectContaining<Partial<PolicyError>>({ code: "POLICY_DUPLICATE_RULE_ID" })
    );
  });

  it.each(["../secret/**", "/etc/**", "C:/secrets/**", "!src/generated/**", "src\\**"])(
    "rejects unsafe or ambiguous glob pattern %s",
    (pattern) => {
      const source = validPolicy.replace('"src/**"', JSON.stringify(pattern));

      expect(() => parsePolicy(source)).toThrow(
        expect.objectContaining<Partial<PolicyError>>({ code: "POLICY_UNSAFE_PATTERN" })
      );
    }
  );

  it("rejects malformed YAML with a stable public error", () => {
    expect(() => parsePolicy("version: 1\nrules: [")).toThrow(
      expect.objectContaining<Partial<PolicyError>>({ code: "POLICY_YAML_INVALID" })
    );
  });

  it("rejects oversized policies before parsing", () => {
    expect(() => parsePolicy("x".repeat(262_145))).toThrow(
      expect.objectContaining<Partial<PolicyError>>({ code: "POLICY_TOO_LARGE" })
    );
  });

  it("keeps the repository's example policy and editor schema publishable", async () => {
    const [policySource, schemaSource] = await Promise.all([
      readFile(".reviewready.yml", "utf8"),
      readFile("reviewready.schema.json", "utf8")
    ]);

    expect(parsePolicy(policySource).version).toBe(1);
    expect(JSON.parse(schemaSource)).toMatchObject({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title: "ReviewReady policy v1"
    });
  });
});
