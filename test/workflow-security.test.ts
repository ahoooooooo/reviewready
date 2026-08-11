import { describe, expect, it } from "vitest";

import {
  MAX_WORKFLOW_FINDINGS,
  MAX_WORKFLOW_SOURCE_BYTES,
  analyzeWorkflowSource
} from "../src/workflow-security.js";

describe("workflow security analysis", () => {
  it("accepts a pinned metadata-only workflow", () => {
    const source = [
      "name: ReviewReady",
      "on: pull_request",
      "permissions:",
      "  contents: read",
      "jobs:",
      "  review:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/checkout@0123456789abcdef0123456789abcdef01234567",
      "      - run: reviewready check --input snapshot.json"
    ].join("\n");

    expect(analyzeWorkflowSource(".github/workflows/reviewready.yml", source).findings).toEqual([]);
  });

  it("separates mutable provenance, PR-target execution, and capability findings", () => {
    const source = [
      "on: pull_request_target",
      "permissions: write-all",
      "jobs:",
      "  ai:",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "        with:",
      "          ref: ${{ github.event.pull_request.head.sha }}",
      "      - id: model",
      "        run: model --prompt '${{ github.event.pull_request.body }}'",
      "        env:",
      "          SECRET: ${{ secrets.OPENAI_API_KEY }}",
      "      - run: deploy --token '${{ steps.model.outputs.text }}'"
    ].join("\n");

    const result = analyzeWorkflowSource(".github/workflows/ai.yml", source);
    const ruleIds = result.findings.map((finding) => finding.ruleId);

    expect(ruleIds).toEqual([
      "ACTION_REF_NOT_PINNED",
      "PULL_REQUEST_TARGET_UNTRUSTED_CODE",
      "WORKFLOW_WRITE_PERMISSION",
      "UNTRUSTED_TEXT_IN_PROMPT",
      "SECRET_IN_PROMPT",
      "MODEL_OUTPUT_TO_SHELL",
      "DEPLOYMENT_SINK"
    ]);
    expect(result.findings.every((finding) => finding.line > 0)).toBe(true);
  });

  it("checks every action reference instead of trusting the first pinned action", () => {
    const source = [
      "jobs:",
      "  review:",
      "    steps:",
      "      - uses: actions/checkout@0123456789abcdef0123456789abcdef01234567",
      "      - uses: actions/setup-node@v4"
    ].join("\n");

    expect(
      analyzeWorkflowSource(".github/workflows/multiple-actions.yml", source).findings.map(
        (finding) => finding.ruleId
      )
    ).toContain("ACTION_REF_NOT_PINNED");
  });

  it("does not let a YAML comment provide a fake pinned action reference", () => {
    const source =
      "jobs:\n  review:\n    steps:\n      - uses: evil/action@v1 # uses: trusted/action@0123456789abcdef0123456789abcdef01234567";

    expect(
      analyzeWorkflowSource(".github/workflows/comment-action.yml", source).findings.map(
        (finding) => finding.ruleId
      )
    ).toContain("ACTION_REF_NOT_PINNED");
  });

  it("reports pull-request text reaching a shell command as code execution", () => {
    const source = [
      "on: pull_request",
      "jobs:",
      "  exploit:",
      "    steps:",
      "      - run: bash -c '${{ github.event.pull_request.body }}'"
    ].join("\n");

    const finding = analyzeWorkflowSource(".github/workflows/body-shell.yml", source).findings.find(
      (candidate) => candidate.ruleId === "UNTRUSTED_TEXT_TO_SHELL"
    );

    expect(finding).toMatchObject({ category: "code_execution", severity: "error" });
  });

  it("reports a pull-request body used directly as the shell command", () => {
    const source = [
      "on: pull_request",
      "jobs:",
      "  exploit:",
      "    steps:",
      "      - run: ${{ github.event.pull_request.body }}"
    ].join("\n");

    expect(
      analyzeWorkflowSource(".github/workflows/body-command.yml", source).findings.map(
        (finding) => finding.ruleId
      )
    ).toContain("UNTRUSTED_TEXT_TO_SHELL");
  });

  it("tracks environment taint without relying on YAML key order", () => {
    const source = [
      "jobs:",
      "  ai:",
      "    steps:",
      '      - run: model --prompt "$PR_BODY"',
      "        env:",
      "          PR_BODY: ${{ github.event.pull_request.body }}",
      '      - run: bash -c "$PR_BODY"',
      "        env:",
      "          PR_BODY: ${{ github.event.pull_request.body }}",
      '      - run: "$PR_BODY"',
      "        env:",
      "          PR_BODY: ${{ github.event.pull_request.body }}",
      '      - run: deploy "$RESULT"',
      "        env:",
      "          RESULT: ${{ steps.model.outputs.text }}"
    ].join("\n");

    const ruleIds = analyzeWorkflowSource(".github/workflows/order.yml", source).findings.map(
      (finding) => finding.ruleId
    );

    expect(ruleIds).toEqual(
      expect.arrayContaining([
        "UNTRUSTED_TEXT_IN_PROMPT",
        "UNTRUSTED_TEXT_TO_SHELL",
        "MODEL_OUTPUT_TO_SHELL",
        "DEPLOYMENT_SINK"
      ])
    );
  });

  it("reports a tainted environment variable used as the command", () => {
    const source = [
      "jobs:",
      "  exploit:",
      "    steps:",
      '      - run: "$PR_BODY"',
      "        env:",
      "          PR_BODY: ${{ github.event.pull_request.body }}"
    ].join("\n");

    expect(
      analyzeWorkflowSource(".github/workflows/env-command.yml", source).findings.map(
        (finding) => finding.ruleId
      )
    ).toContain("UNTRUSTED_TEXT_TO_SHELL");
  });

  it("reports check-producing write permissions", () => {
    const source = ["on: pull_request", "permissions:", "  checks: write", "jobs: {}"].join("\n");

    expect(
      analyzeWorkflowSource(".github/workflows/check-writer.yml", source).findings.map(
        (finding) => finding.ruleId
      )
    ).toContain("WORKFLOW_WRITE_PERMISSION");
  });

  it("reports inherited secrets as a capability exposure", () => {
    const source = [
      "jobs:",
      "  ai:",
      "    uses: acme/reusable-workflow/.github/workflows/review.yml@0123456789abcdef0123456789abcdef01234567",
      "    secrets: inherit"
    ].join("\n");

    expect(
      analyzeWorkflowSource(".github/workflows/inherited-secrets.yml", source).findings.map(
        (finding) => finding.ruleId
      )
    ).toContain("SECRETS_INHERIT");
  });

  it("reports bracket-form secret expressions in an AI workflow", () => {
    const source = [
      "jobs:",
      "  ai:",
      "    steps:",
      "      - run: model",
      "        env:",
      "          SECRET: ${{ secrets['OPENAI_API_KEY'] }}"
    ].join("\n");

    expect(
      analyzeWorkflowSource(".github/workflows/bracket-secret.yml", source).findings.map(
        (finding) => finding.ruleId
      )
    ).toContain("SECRET_IN_PROMPT");
  });

  it("tracks untrusted PR text through an environment handoff into a prompt", () => {
    const source = [
      "on: pull_request",
      "env:",
      "  PR_BODY: ${{ github.event.pull_request.body }}",
      "jobs:",
      "  ai:",
      "    steps:",
      '      - run: model --prompt "$PR_BODY"'
    ].join("\n");

    expect(
      analyzeWorkflowSource(".github/workflows/env-prompt.yml", source).findings.map(
        (finding) => finding.ruleId
      )
    ).toContain("UNTRUSTED_TEXT_IN_PROMPT");
  });

  it("reports model output handed through env before a shell sink", () => {
    const source = [
      "jobs:",
      "  ai:",
      "    steps:",
      "      - id: model",
      "        run: model",
      "        env:",
      "          RESULT: ${{ steps.model.outputs.text }}",
      '      - run: deploy "$RESULT"'
    ].join("\n");

    expect(
      analyzeWorkflowSource(".github/workflows/env-output.yml", source).findings.map(
        (finding) => finding.ruleId
      )
    ).toContain("MODEL_OUTPUT_TO_SHELL");
  });

  it("reports model output and deployment sinks inside block scalar shell steps", () => {
    const source = [
      "jobs:",
      "  ai:",
      "    steps:",
      "      - id: model",
      "        env:",
      "          RESULT: ${{ steps.model.outputs.text }}",
      "        run: |",
      '          deploy "$RESULT"'
    ].join("\n");

    const ruleIds = analyzeWorkflowSource(".github/workflows/block.yml", source).findings.map(
      (finding) => finding.ruleId
    );

    expect(ruleIds).toEqual(expect.arrayContaining(["MODEL_OUTPUT_TO_SHELL", "DEPLOYMENT_SINK"]));
  });

  it("rejects an oversized source without scanning an unbounded string", () => {
    const result = analyzeWorkflowSource(
      ".github/workflows/large.yml",
      "x".repeat(MAX_WORKFLOW_SOURCE_BYTES + 1)
    );

    expect(result.findings).toEqual([
      expect.objectContaining({ ruleId: "WORKFLOW_SOURCE_TOO_LARGE", line: 1 })
    ]);
  });

  it("reports when its finding cap prevents a complete workflow analysis", () => {
    const source = Array.from(
      { length: MAX_WORKFLOW_FINDINGS + 10 },
      (_, index) => `- uses: example/action@v${String(index)}`
    ).join("\n");

    const result = analyzeWorkflowSource(".github/workflows/many-actions.yml", source);

    expect(result.findings).toHaveLength(MAX_WORKFLOW_FINDINGS);
    expect(result.findings.map((finding) => finding.ruleId)).toContain(
      "WORKFLOW_FINDINGS_TRUNCATED"
    );
  });
});
