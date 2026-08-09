import { describe, expect, it } from "vitest";

import { evaluate } from "../src/engine.js";
import type { InputError } from "../src/errors.js";
import { parsePolicy } from "../src/policy.js";
import type { PullRequestInput } from "../src/domain.js";

const policy = parsePolicy(`
version: 1
rules:
  - id: source
    when:
      paths:
        any: ["src/**"]
      labels:
        none: [skip-readiness]
    require:
      - type: pr_body_section
        heading: Testing
      - type: linked_issue
      - type: check
        name: test
        conclusions: [success]
      - type: human_attestation
        text: I understand this change.
  - id: sensitive
    when:
      paths:
        any: [".github/workflows/**", "src/auth/**"]
    require:
      - type: pr_body_section
        heading: Testing
      - type: maintainer_review
        minimum: 1
`);

function input(overrides: Partial<PullRequestInput> = {}): PullRequestInput {
  return {
    version: 1,
    changedFiles: ["src/index.ts"],
    body: "",
    labels: [],
    linkedIssues: [],
    checks: [],
    reviews: [],
    ...overrides
  };
}

describe("evaluate", () => {
  it("keeps check requirements distinct when names or apps contain delimiters", () => {
    const collisionPolicy = parsePolicy(`
version: 1
rules:
  - id: checks
    when:
      paths:
        any: ["src/**"]
    require:
      - type: check
        name: "a:success"
        app: b
        conclusions: [success]
      - type: check
        name: a
        app: "success:b"
        conclusions: [success]
`);

    const result = evaluate(
      collisionPolicy,
      input({
        checks: [
          { name: "a:success", conclusion: "success", app: "b" },
          { name: "a", conclusion: "success", app: "success:b" }
        ]
      })
    );

    expect(result.status).toBe("ready");
    expect(result.requirements).toHaveLength(2);
  });

  it("reports every missing obligation for every matching rule", () => {
    const result = evaluate(policy, input({ changedFiles: ["src/auth/token.ts"] }));

    expect(result.status).toBe("not_ready");
    expect(result.triggeredRules).toEqual(["source", "sensitive"]);
    expect(result.requirements).toHaveLength(5);
    expect(
      result.requirements.filter((requirement) => requirement.status === "missing")
    ).toHaveLength(5);
    expect(
      result.requirements.find((requirement) => requirement.type === "pr_body_section")?.ruleIds
    ).toEqual(["source", "sensitive"]);
  });

  it("becomes ready only when deterministic evidence satisfies every obligation", () => {
    const result = evaluate(
      policy,
      input({
        changedFiles: ["src/auth/token.ts"],
        body: `## Testing

        npm test passed.

        - [x] I understand this change.
        `,
        linkedIssues: [42],
        checks: [{ name: "test", conclusion: "success", app: "github-actions" }],
        reviews: [
          { login: "maintainer", state: "approved", maintainer: true },
          { login: "visitor", state: "approved", maintainer: false }
        ]
      })
    );

    expect(result.status).toBe("ready");
    expect(result.requirements.every((requirement) => requirement.status === "satisfied")).toBe(
      true
    );
  });

  it("requires non-empty content below a required PR body heading", () => {
    const result = evaluate(policy, input({ body: "## Testing\n\n## Notes\nNot testing." }));

    expect(
      result.requirements.find((requirement) => requirement.type === "pr_body_section")?.status
    ).toBe("missing");
  });

  it("ignores headings and attestations inside fenced code blocks", () => {
    const result = evaluate(
      policy,
      input({
        body: [
          "```markdown",
          "## Testing",
          "Tests passed.",
          "- [x] I understand this change.",
          "```"
        ].join("\n")
      })
    );

    expect(
      result.requirements.find((requirement) => requirement.type === "pr_body_section")?.status
    ).toBe("missing");
    expect(
      result.requirements.find((requirement) => requirement.type === "human_attestation")?.status
    ).toBe("missing");
  });

  it("accepts a later repeated body heading when the first occurrence is empty", () => {
    const result = evaluate(
      policy,
      input({ body: "## Testing\n\n## Notes\nNope.\n\n## Testing\nTests passed." })
    );

    expect(
      result.requirements.find((requirement) => requirement.type === "pr_body_section")?.status
    ).toBe("satisfied");
  });

  it("does not trigger a rule when its negative label condition fails", () => {
    const result = evaluate(policy, input({ labels: ["skip-readiness"] }));

    expect(result.status).toBe("ready");
    expect(result.triggeredRules).toEqual([]);
  });

  it("matches repository paths with POSIX semantics after safe slash normalization", () => {
    const result = evaluate(policy, input({ changedFiles: ["src\\index.ts"] }));

    expect(result.triggeredRules).toEqual(["source"]);
  });

  it.each(["../secret", "/etc/passwd", "C:/secret", "src/../../secret", ""])(
    "rejects unsafe changed path %s",
    (changedFile) => {
      expect(() => evaluate(policy, input({ changedFiles: [changedFile] }))).toThrow(
        expect.objectContaining<Partial<InputError>>({ code: "INPUT_UNSAFE_PATH" })
      );
    }
  );

  it("counts unique approving maintainers rather than review events", () => {
    const result = evaluate(
      policy,
      input({
        changedFiles: ["src/auth/token.ts"],
        reviews: [
          { login: "same-person", state: "approved", maintainer: true },
          { login: "same-person", state: "approved", maintainer: true }
        ]
      })
    );

    const review = result.requirements.find(
      (requirement) => requirement.type === "maintainer_review"
    );
    expect(review?.status).toBe("satisfied");
    expect(review?.evidence).toBe("1 approving maintainer");
  });

  it("uses the latest timestamped review state instead of array position", () => {
    const result = evaluate(
      policy,
      input({
        changedFiles: ["src/auth/token.ts"],
        reviews: [
          {
            login: "same-person",
            state: "changes_requested",
            maintainer: true,
            submittedAt: "2026-08-10T10:00:00Z"
          },
          {
            login: "same-person",
            state: "approved",
            maintainer: true,
            submittedAt: "2026-08-10T09:00:00Z"
          }
        ]
      })
    );

    const review = result.requirements.find(
      (requirement) => requirement.type === "maintainer_review"
    );
    expect(review?.status).toBe("missing");
    expect(review?.evidence).toBe("0 approving maintainers");
  });
});
