import { describe, expect, it } from "vitest";

import { evaluate } from "../src/engine.js";
import { parsePolicy } from "../src/policy.js";
import { explainPolicy, renderJson, renderMarkdown, renderText } from "../src/report.js";
import type { Policy } from "../src/domain.js";

const policy = parsePolicy(`
version: 1
rules:
  - id: source
    description: Explain source changes.
    when:
      paths:
        any: ["src/**"]
    require:
      - type: pr_body_section
        heading: Testing
      - type: human_attestation
        text: I understand this change.
`);

const result = evaluate(policy, {
  version: 1,
  changedFiles: ["src/index.ts"],
  body: "",
  labels: [],
  linkedIssues: [],
  checks: [],
  reviews: []
});

describe("reports", () => {
  it("serializes the public evaluation result through one JSON renderer", () => {
    const json = renderJson(result);
    const prettyJson = renderJson(result, true);

    expect(json).toBe(JSON.stringify(result));
    expect(JSON.parse(json)).toEqual(result);
    expect(prettyJson).toContain("\n");
  });

  it("preserves the v1 human-attestation summary in public JSON", () => {
    const requirement = result.requirements.find((item) => item.type === "human_attestation");

    expect(requirement?.summary).toBe('Checked human attestation: "I understand this change."');
  });

  it("renders concise terminal text", () => {
    expect(renderText(result)).toContain("NOT READY FOR HUMAN REVIEW");
    expect(renderText(result)).toContain("Triggered rules: source");
    expect(renderText(result)).toContain("Missing:");
  });

  it("describes human attestation checks as checked task-list text", () => {
    const text = renderText(result);
    const markdown = renderMarkdown(result);

    expect(text).toContain(
      'PR body contains the specified checked task-list text: "I understand this change."'
    );
    expect(markdown).toContain(
      'PR body contains the specified checked task\\-list text: "I understand this change\\."'
    );
    expect(text).not.toContain("Checked human attestation");
    expect(markdown).not.toContain("Checked human attestation");
  });

  it("renders a Markdown job summary without raw HTML", () => {
    const markdown = renderMarkdown(result);

    expect(markdown).toContain("## ReviewReady: not ready");
    expect(markdown).toContain("- ❌");
    expect(markdown).not.toContain("<script");
  });

  it("renders control characters from policy text as data", () => {
    const maliciousPolicy: Policy = {
      version: 1,
      rules: [
        {
          id: "escaped",
          description: "description\u001b]0;owned",
          when: { paths: { any: ["src/**"] } },
          require: [{ type: "pr_body_section", heading: "Testing\u001b[31m\u202e" }]
        }
      ]
    };
    const maliciousResult = evaluate(maliciousPolicy, {
      version: 1,
      changedFiles: ["src/index.ts"],
      body: "",
      labels: [],
      linkedIssues: [],
      checks: [],
      reviews: []
    });

    expect(renderText(maliciousResult)).not.toContain("\u001b");
    expect(renderText(maliciousResult)).not.toContain("\u202e");
    expect(renderMarkdown(maliciousResult)).not.toContain("\u001b");
    expect(renderMarkdown(maliciousResult)).not.toContain("\u202e");
    expect(explainPolicy(maliciousPolicy)).not.toContain("\u001b");
    expect(explainPolicy(maliciousPolicy)).not.toContain("\u202e");
  });

  it("escapes line separators and dynamic report identifiers", () => {
    const maliciousPolicy: Policy = {
      version: 1,
      rules: [
        {
          id: "rule\u2028INJECT",
          description: "description\u2029INJECT",
          when: { paths: { any: ["src/**"] } },
          require: [{ type: "pr_body_section", heading: "Testing\u2028INJECT" }]
        }
      ]
    };
    const maliciousResult = {
      ...evaluate(maliciousPolicy, {
        version: 1,
        changedFiles: ["src/index.ts"],
        body: "",
        labels: [],
        linkedIssues: [],
        checks: [],
        reviews: []
      }),
      triggeredRules: ["rule\u2028INJECT", "second\u2029INJECT"]
    };

    expect(renderText(maliciousResult)).not.toContain("\u2028");
    expect(renderText(maliciousResult)).not.toContain("\u2029");
    expect(renderMarkdown(maliciousResult)).not.toContain("\u2028");
    expect(renderMarkdown(maliciousResult)).not.toContain("\u2029");
    expect(explainPolicy(maliciousPolicy)).not.toContain("\u2028");
    expect(explainPolicy(maliciousPolicy)).not.toContain("\u2029");
  });

  it("escapes policy-derived HTML in Markdown output", () => {
    const malicious = evaluate(
      parsePolicy(`
version: 1
rules:
  - id: escaped
    when:
      paths:
        any: ["src/**"]
    require:
      - type: pr_body_section
        heading: "<script>alert(1)</script>"
`),
      {
        version: 1,
        changedFiles: ["src/index.ts"],
        body: "",
        labels: [],
        linkedIssues: [],
        checks: [],
        reviews: []
      }
    );

    expect(renderMarkdown(malicious)).toContain("&lt;script&gt;");
    expect(renderMarkdown(malicious)).not.toContain("<script>");
  });

  it("renders untrusted Markdown control characters as literal text", () => {
    const markdownSensitive = evaluate(
      parsePolicy(`
version: 1
rules:
  - id: escaped
    when:
      paths:
        any: ["src/**"]
    require:
      - type: pr_body_section
        heading: 'backslash \\ and ~~strike~~ & <script>'
`),
      {
        version: 1,
        changedFiles: ["src/index.ts"],
        body: "",
        labels: [],
        linkedIssues: [],
        checks: [],
        reviews: []
      }
    );

    expect(renderMarkdown(markdownSensitive)).toContain(
      String.raw`PR body section "backslash \\ and \~\~strike\~\~ &amp; &lt;script&gt;" has content`
    );
  });

  it("explains conditions and requirements in deterministic order", () => {
    const explanation = explainPolicy(policy);

    expect(explanation).toContain("Rule: source");
    expect(explanation.indexOf("PR body section")).toBeLessThan(
      explanation.indexOf("PR body contains checked task-list text")
    );
  });

  it("renders a ready result with no triggered rules without empty sections", () => {
    const noMatch = evaluate(policy, {
      version: 1,
      changedFiles: ["README.md"],
      body: "",
      labels: [],
      linkedIssues: [],
      checks: [],
      reviews: []
    });
    const fullyVerified = evaluate(policy, {
      version: 1,
      changedFiles: ["src/index.ts"],
      body: "## Testing\nTests passed.\n\n- [x] I understand this change.",
      labels: [],
      linkedIssues: [],
      checks: [],
      reviews: []
    });
    const text = renderText(noMatch);
    const markdown = renderMarkdown(noMatch);

    expect(noMatch).toMatchObject({
      outputVersion: 1,
      status: "ready",
      triggeredRules: [],
      requirements: []
    });
    expect(renderText(noMatch)).toContain("READY FOR HUMAN REVIEW");
    expect(text).toContain("Triggered rules: (none)");
    expect(text).toContain("No policy rules matched:");
    expect(text).toContain(
      "No policy rules matched this change; no evidence requirements were evaluated."
    );
    expect(text).not.toContain("Verified:");
    expect(text).not.toContain("Missing:");
    expect(markdown).toContain("Triggered rules: _none_");
    expect(markdown).toContain("### No policy rules matched");
    expect(markdown).toContain(
      "No policy rules matched this change; no evidence requirements were evaluated."
    );
    expect(markdown).not.toContain("### Verified");
    expect(markdown).not.toContain("### Missing");
    expect(renderText(fullyVerified)).toContain("Verified:");
    expect(renderMarkdown(fullyVerified)).toContain("### Verified");
  });

  it("explains every v1 requirement variant", () => {
    const explanation = explainPolicy(
      parsePolicy(`
version: 1
rules:
  - id: everything
    when:
      labels:
        any: [review]
    require:
      - type: linked_issue
      - type: check
        name: security
        conclusions: [success, neutral]
        app: github-actions
      - type: maintainer_review
        minimum: 2
`)
    );

    expect(explanation).toContain("pull request links an issue");
    expect(explanation).toContain('from "github-actions"');
    expect(explanation).toContain("2 approving maintainers");
  });
});
