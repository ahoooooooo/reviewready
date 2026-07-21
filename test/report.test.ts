import { describe, expect, it } from "vitest";

import { evaluate } from "../src/engine.js";
import { parsePolicy } from "../src/policy.js";
import { explainPolicy, renderMarkdown, renderText } from "../src/report.js";

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
  it("renders concise terminal text", () => {
    expect(renderText(result)).toContain("NOT READY FOR HUMAN REVIEW");
    expect(renderText(result)).toContain("Triggered rules: source");
    expect(renderText(result)).toContain("Missing:");
  });

  it("renders a Markdown job summary without raw HTML", () => {
    const markdown = renderMarkdown(result);

    expect(markdown).toContain("## ReviewReady: not ready");
    expect(markdown).toContain("- ❌");
    expect(markdown).not.toContain("<script");
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

  it("explains conditions and requirements in deterministic order", () => {
    const explanation = explainPolicy(policy);

    expect(explanation).toContain("Rule: source");
    expect(explanation.indexOf("PR body section")).toBeLessThan(
      explanation.indexOf("human attestation")
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

    expect(renderText(noMatch)).toContain("READY FOR HUMAN REVIEW");
    expect(renderText(noMatch)).toContain("Triggered rules: (none)");
    expect(renderText(noMatch)).not.toContain("Missing:");
    expect(renderMarkdown(noMatch)).toContain("Triggered rules: _none_");
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
