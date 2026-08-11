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

interface ReviewReductionCase {
  readonly name: string;
  readonly reviews: PullRequestInput["reviews"];
  readonly expectedStatus: "satisfied" | "missing";
  readonly expectedEvidence: string;
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
    expect(result.requirements.map((requirement) => requirement.key)).toEqual([
      "check:a:success:success:b",
      "check:a:success:success:b"
    ]);
  });

  it("prefers an unqualified aggregate over an app-specific check for generic requirements", () => {
    const result = evaluate(
      policy,
      input({
        checks: [
          { name: "test", conclusion: "success", app: "github-actions" },
          { name: "test", conclusion: "failure" }
        ]
      })
    );

    expect(result.requirements.find((requirement) => requirement.type === "check")?.status).toBe(
      "missing"
    );
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
        body: ["## Testing", "", "npm test passed.", "", "- [x] I understand this change."].join(
          "\n"
        ),
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

  it.each([
    {
      name: "single-line HTML comments",
      body: ["<!-- ## Testing -->", "<!-- - [x] I understand this change. -->"].join("\n"),
      expectedSection: "missing",
      expectedAttestation: "missing"
    },
    {
      name: "multi-line HTML comments",
      body: ["<!--", "## Testing", "Tests passed.", "- [x] I understand this change.", "-->"].join(
        "\n"
      ),
      expectedSection: "missing",
      expectedAttestation: "missing"
    },
    {
      name: "visible Markdown around an inline comment",
      body: [
        "## Testing <!-- ignored heading suffix -->",
        "Tests passed.",
        "<!-- hidden -->",
        "- [x] I understand this change."
      ].join("\n"),
      expectedSection: "satisfied",
      expectedAttestation: "satisfied"
    },
    {
      name: "an unclosed HTML comment",
      body: [
        "## Testing",
        "Tests passed.",
        "- [x] I understand this change.",
        "<!-- never closes"
      ].join("\n"),
      expectedSection: "missing",
      expectedAttestation: "missing"
    },
    {
      name: "a task item inside an indented code block",
      body: ["## Testing", "Tests passed.", "    - [x] I understand this change."].join("\n"),
      expectedSection: "satisfied",
      expectedAttestation: "missing"
    },
    {
      name: "a fence-like line with trailing text",
      body: [
        "## Testing",
        "Tests passed.",
        "```markdown",
        "``` this is not a closing fence",
        "- [x] I understand this change."
      ].join("\n"),
      expectedSection: "satisfied",
      expectedAttestation: "missing"
    }
  ])(
    "evaluates only visible Markdown for $name",
    ({ body, expectedSection, expectedAttestation }) => {
      const result = evaluate(policy, input({ body }));

      expect(
        result.requirements.find((requirement) => requirement.type === "pr_body_section")?.status
      ).toBe(expectedSection);
      expect(
        result.requirements.find((requirement) => requirement.type === "human_attestation")?.status
      ).toBe(expectedAttestation);
    }
  );

  it.each([
    {
      name: "nested lower-level content",
      body: "## Testing\n### Unit tests\nnpm test passed.",
      expected: "satisfied"
    },
    {
      name: "empty nested heading does not count as content",
      body: "## Testing\n### Unit tests\n## Notes\nNot testing.",
      expected: "missing"
    },
    {
      name: "same-level heading boundary",
      body: "## Testing\n## Notes\nNot testing.",
      expected: "missing"
    },
    {
      name: "higher-level heading boundary",
      body: "## Testing\n# Notes\nNot testing.",
      expected: "missing"
    }
  ])("uses heading levels for the Testing section: $name", ({ body, expected }) => {
    const result = evaluate(policy, input({ body }));

    expect(
      result.requirements.find((requirement) => requirement.type === "pr_body_section")?.status
    ).toBe(expected);
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

  it("does not treat an adjacent trailing hash as a heading closing marker", () => {
    const result = evaluate(policy, input({ body: "## Testing#\nTests passed." }));

    expect(
      result.requirements.find((requirement) => requirement.type === "pr_body_section")?.status
    ).toBe("missing");
  });

  it("does not trigger a rule when its negative label condition fails", () => {
    const result = evaluate(policy, input({ labels: ["skip-readiness"] }));

    expect(result.status).toBe("ready");
    expect(result.triggeredRules).toEqual([]);
  });

  it("rejects a literal backslash instead of normalizing Git data", () => {
    expect(() => evaluate(policy, input({ changedFiles: ["src\\index.ts"] }))).toThrow(
      expect.objectContaining({ code: "INPUT_GIT_PATH_INVALID" })
    );
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

  const reviewReductionCases: readonly ReviewReductionCase[] = [
    {
      name: "a later COMMENTED review does not override approval",
      reviews: [
        { login: "same-person", state: "approved", maintainer: true },
        { login: "same-person", state: "commented", maintainer: true }
      ],
      expectedStatus: "satisfied",
      expectedEvidence: "1 approving maintainer"
    },
    {
      name: "a later COMMENTED review does not override the latest timestamped opinion",
      reviews: [
        {
          login: "same-person",
          state: "approved",
          maintainer: true,
          submittedAt: "2026-08-10T10:00:00Z"
        },
        {
          login: "same-person",
          state: "changes_requested",
          maintainer: true,
          submittedAt: "2026-08-10T09:00:00Z"
        },
        {
          login: "same-person",
          state: "commented",
          maintainer: true,
          submittedAt: "2026-08-10T11:00:00Z"
        }
      ],
      expectedStatus: "satisfied",
      expectedEvidence: "1 approving maintainer"
    },
    {
      name: "dismissed remains non-approving despite a later comment",
      reviews: [
        {
          login: "same-person",
          state: "approved",
          maintainer: true,
          submittedAt: "2026-08-10T10:00:00Z"
        },
        {
          login: "same-person",
          state: "dismissed",
          maintainer: true,
          submittedAt: "2026-08-10T11:00:00Z"
        },
        {
          login: "same-person",
          state: "commented",
          maintainer: true,
          submittedAt: "2026-08-10T12:00:00Z"
        }
      ],
      expectedStatus: "missing",
      expectedEvidence: "0 approving maintainers"
    },
    {
      name: "timestamp-free fixtures keep their array-order behavior",
      reviews: [
        { login: "same-person", state: "changes_requested", maintainer: true },
        { login: "same-person", state: "approved", maintainer: true }
      ],
      expectedStatus: "satisfied",
      expectedEvidence: "1 approving maintainer"
    },
    {
      name: "timestamp-free fixtures keep the last opinionated state",
      reviews: [
        { login: "same-person", state: "approved", maintainer: true },
        { login: "same-person", state: "changes_requested", maintainer: true }
      ],
      expectedStatus: "missing",
      expectedEvidence: "0 approving maintainers"
    }
  ];

  it.each(reviewReductionCases)(
    "reduces reviewer opinions deterministically: $name",
    ({ reviews, expectedStatus, expectedEvidence }) => {
      const result = evaluate(
        policy,
        input({
          changedFiles: ["src/auth/token.ts"],
          reviews
        })
      );

      const review = result.requirements.find(
        (requirement) => requirement.type === "maintainer_review"
      );
      expect(review?.status).toBe(expectedStatus);
      expect(review?.evidence).toBe(expectedEvidence);
    }
  );
});
