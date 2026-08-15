import { readFile } from "node:fs/promises";

import Ajv2020Module from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { checkConclusions, policyLimits } from "../src/domain.js";
import type { PolicyError } from "../src/errors.js";
import { parsePolicy, POLICY_TEXT_SCHEMA_PATTERN } from "../src/policy.js";

type Draft2020Constructor = new (options?: { readonly allErrors?: boolean }) => {
  compile: (schema: object) => (data: unknown) => boolean;
};

const Ajv2020 = Ajv2020Module as unknown as Draft2020Constructor;

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

  it.each([
    ["leading whitespace", " Testing"],
    ["trailing whitespace", "Testing "],
    ["control character", "Testing\u0007"],
    ["bidirectional control", "Testing\u202E"],
    ["multiline text", "Testing\ncontinued"]
  ])("rejects unsafe policy text (%s)", (_name, value) => {
    const source = validPolicy.replace("heading: Testing", `heading: ${JSON.stringify(value)}`);

    expect(() => parsePolicy(source)).toThrow(
      expect.objectContaining<Partial<PolicyError>>({ code: "POLICY_TEXT_INVALID" })
    );
  });

  it.each([
    ["description control character", "Description\u0007"],
    ["description zero-width character", "Description\u200B"],
    ["description multiline text", "Description\ncontinued"]
  ])("rejects unsafe rule descriptions (%s)", (_name, value) => {
    const source = validPolicy.replace(
      "description: Source changes need test evidence.",
      `description: ${JSON.stringify(value)}`
    );

    expect(() => parsePolicy(source)).toThrow(
      expect.objectContaining<Partial<PolicyError>>({ code: "POLICY_TEXT_INVALID" })
    );
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

  it("keeps control characters out of policy error messages", () => {
    const maliciousPattern = "../secret\u001b]0;owned/**";
    const source = validPolicy.replace('"src/**"', JSON.stringify(maliciousPattern));

    let error: unknown;
    try {
      parsePolicy(source);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain("\u001b");
  });

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

  it("keeps the published JSON Schema limits and variants aligned with runtime policy parsing", async () => {
    const schema = JSON.parse(await readFile("reviewready.schema.json", "utf8")) as {
      properties: {
        rules: { maxItems: number };
      };
      $defs: {
        text: { maxLength: number; pattern?: string };
        matchValues: { maxItems: number };
        conclusion: { enum: readonly string[] };
        requirement: {
          oneOf: readonly { properties: { type: { const: string } } }[];
        };
        rule: {
          properties: {
            require: { maxItems: number };
          };
        };
      };
    };

    expect(schema.properties.rules.maxItems).toBe(policyLimits.maxRules);
    expect(schema.$defs.text.maxLength).toBe(policyLimits.maxTextLength);
    expect(schema.$defs.text.pattern).toBe(POLICY_TEXT_SCHEMA_PATTERN);
    expect(schema.$defs.matchValues.maxItems).toBe(policyLimits.maxMatchValues);
    expect(schema.$defs.rule.properties.require.maxItems).toBe(policyLimits.maxRequirementsPerRule);
    expect(schema.$defs.conclusion.enum).toEqual([...checkConclusions]);
    expect(
      new Set(schema.$defs.requirement.oneOf.map((variant) => variant.properties.type.const))
    ).toEqual(
      new Set([
        "pr_body_section",
        "linked_issue",
        "check",
        "maintainer_review",
        "human_attestation"
      ])
    );
  });

  it("keeps a shared adversarial text corpus aligned with a Draft 2020-12 validator", async () => {
    const schema = JSON.parse(await readFile("reviewready.schema.json", "utf8")) as object;
    const validate = new Ajv2020({ allErrors: true }).compile(schema);
    const cases = [
      { name: "ordinary ASCII", value: "Testing", accepted: true },
      { name: "ordinary Unicode", value: "測試", accepted: true },
      { name: "combining accent with a letter", value: "Cafe\u0301", accepted: true },
      { name: "leading whitespace", value: " Testing", accepted: false },
      { name: "trailing whitespace", value: "Testing ", accepted: false },
      { name: "exact code-point limit", value: "a".repeat(500), accepted: true },
      { name: "over code-point limit", value: "a".repeat(501), accepted: false },
      { name: "emoji code-point boundary", value: "😀".repeat(251), accepted: true },
      { name: "CR", value: "Testing\rvalue", accepted: false },
      { name: "LF", value: "Testing\nvalue", accepted: false },
      { name: "ANSI CSI", value: "Testing\u001b[31m", accepted: false },
      { name: "ANSI OSC", value: "Testing\u001b]0;owned\u0007", accepted: false },
      { name: "bidi override", value: "Testing\u202e", accepted: false },
      { name: "zero-width", value: "Testing\u200b", accepted: false },
      { name: "invisible combining mark", value: "\u034f", accepted: false },
      { name: "unicode format character", value: "Testing\u{e0001}", accepted: false }
    ] as const;

    for (const testCase of cases) {
      const document = {
        version: 1,
        rules: [
          {
            id: "source",
            when: { paths: { any: ["src/**"] } },
            require: [{ type: "pr_body_section", heading: testCase.value }]
          }
        ]
      };
      let runtimeAccepted = true;
      try {
        parsePolicy(
          [
            "version: 1",
            "rules:",
            "  - id: source",
            "    when:",
            "      paths:",
            "        any: [src/**]",
            "    require:",
            "      - type: pr_body_section",
            "        heading: " + JSON.stringify(testCase.value)
          ].join("\n")
        );
      } catch {
        runtimeAccepted = false;
      }

      expect(runtimeAccepted, testCase.name + ": runtime").toBe(testCase.accepted);
      expect(validate(document), testCase.name + ": JSON Schema").toBe(testCase.accepted);
    }
  });

  it("applies the same safe text contract to descriptions", async () => {
    const schema = JSON.parse(await readFile("reviewready.schema.json", "utf8")) as object;
    const validate = new Ajv2020({ allErrors: true });
    const document = {
      version: 1,
      rules: [
        {
          id: "source",
          description: "\u034f",
          when: { paths: { any: ["src/**"] } },
          require: [{ type: "linked_issue" }]
        }
      ]
    };

    expect(() => parsePolicy(JSON.stringify(document))).toThrow(
      expect.objectContaining<Partial<PolicyError>>({ code: "POLICY_TEXT_INVALID" })
    );
    expect(validate.compile(schema)(document)).toBe(false);
  });
});
