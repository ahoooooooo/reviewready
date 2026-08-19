import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { evaluate } from "../src/engine.js";
import type { InputError } from "../src/errors.js";
import { parsePolicy } from "../src/policy.js";
import type { Policy, PullRequestInput } from "../src/domain.js";
import { MATCHING_OPERATION_BUDGET } from "../src/matcher.js";

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
  it("does not duplicate a rule id when one rule repeats an equivalent requirement", () => {
    const duplicatePolicy = parsePolicy(`
version: 1
rules:
  - id: duplicate
    when:
      paths:
        any: [src/**]
    require:
      - type: linked_issue
      - type: linked_issue
`);

    const result = evaluate(duplicatePolicy, input({ linkedIssues: [7] }));

    expect(result.requirements).toHaveLength(1);
    expect(result.requirements[0]?.ruleIds).toEqual(["duplicate"]);
  });

  it("preserves duplicate conclusion entries in the v1 public requirement key", () => {
    const duplicateConclusionPolicy = parsePolicy(`
version: 1
rules:
  - id: check
    when:
      paths:
        any: [src/**]
    require:
      - type: check
        name: build
        conclusions: [success, success]
`);

    const result = evaluate(
      duplicateConclusionPolicy,
      input({ checks: [{ name: "build", conclusion: "success" }] })
    );

    expect(result.requirements[0]?.key).toBe("check:build:success,success:");
  });

  it("does not treat an invisible combining mark as visible human attestation", () => {
    const invisibleText = "\u034f";
    const invisiblePolicy: Policy = {
      version: 1,
      rules: [
        {
          id: "attestation",
          when: { paths: { any: ["src/**"] } },
          require: [{ type: "human_attestation", text: invisibleText }]
        }
      ]
    };

    const result = evaluate(invisiblePolicy, input({ body: `- [x] ${invisibleText}` }));

    expect(result.status).toBe("not_ready");
    expect(result.requirements[0]?.status).toBe("missing");
  });

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

  it("matches the v1 JSON golden result for all five requirement types", async () => {
    const goldenPolicy = parsePolicy(`
version: 1
rules:
  - id: all-evidence
    when:
      paths:
        any: [src/**]
    require:
      - type: pr_body_section
        heading: Testing
      - type: linked_issue
      - type: check
        name: build
        conclusions: [success, failure]
        app: github-actions
      - type: maintainer_review
        minimum: 1
      - type: human_attestation
        text: I understand.
`);

    const result = evaluate(
      goldenPolicy,
      input({
        body: ["## Testing", "Tests passed.", "", "- [x] I understand."].join("\n"),
        linkedIssues: [7],
        checks: [{ name: "build", conclusion: "success", app: "github-actions" }],
        reviews: [{ login: "maintainer", state: "approved", maintainer: true }]
      })
    );

    const golden = JSON.parse(
      await readFile("fixtures/basic/v1-all-requirements-result.json", "utf8")
    ) as unknown;
    expect(result).toEqual(golden);
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

  it("does not let a duplicate non-success check be bypassed by a success", () => {
    const checkPolicy = parsePolicy(`
version: 1
rules:
  - id: check
    when:
      paths:
        any: [src/**]
    require:
      - type: check
        name: build
        conclusions: [success]
`);
    const result = evaluate(
      checkPolicy,
      input({
        checks: [
          { name: "build", conclusion: "failure" },
          { name: "build", conclusion: "success" }
        ]
      })
    );

    expect(result.requirements[0]?.status).toBe("missing");
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

  it("does not count indented code blocks as visible section evidence", () => {
    const result = evaluate(policy, input({ body: "## Testing\n    hidden command output" }));

    expect(
      result.requirements.find((requirement) => requirement.type === "pr_body_section")?.status
    ).toBe("missing");
  });

  it("does not count default-ignorable characters as visible section content", () => {
    const result = evaluate(policy, input({ body: "## Testing\n\u200B" }));

    expect(
      result.requirements.find((requirement) => requirement.type === "pr_body_section")?.status
    ).toBe("missing");
  });

  it.each([
    "## Testing\n[](#)",
    "## Testing\n[<!-- hidden -->](https://example.test)",
    "## Testing\n[&#8203;](https://example.org)",
    "## Testing\n![](foo)",
    "## Testing\n[](foo\\)bar)",
    "## Testing\n[](<foo\\>bar>)",
    "## Testing\n[](foo(and(bar)))",
    "## Testing\n[](<foo)>)",
    '## Testing\n[](foo "title )")',
    "## Testing\n[](foo (title ))",
    '## Testing\n[](<foo)> "title )")'
  ])("does not count empty Markdown markers as visible section content", (body) => {
    const result = evaluate(policy, input({ body }));

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
      name: "zero-width HTML entity",
      body: "## Testing\n&#8203;",
      expectedSection: "missing",
      expectedAttestation: "missing"
    },
    {
      name: "named invisible HTML entity",
      body: "## Testing\n&NoBreak;",
      expectedSection: "missing",
      expectedAttestation: "missing"
    },
    {
      name: "named function-application HTML entity",
      body: "## Testing\n&af;",
      expectedSection: "missing",
      expectedAttestation: "missing"
    },
    {
      name: "named invisible MathML entity aliases",
      body: "## Testing\n&it; &ic; &nmedium; &nthick; &nthin; &nverythin;",
      expectedSection: "missing",
      expectedAttestation: "missing"
    },
    {
      name: "invisible HTML entity cannot create a heading marker",
      body: "#&#8203;# Testing\nTests passed.",
      expectedSection: "missing",
      expectedAttestation: "missing"
    },
    {
      name: "invisible HTML entity cannot create a task marker",
      body: "## Testing\nTests passed.\n-&#8203; [x] I understand this change.",
      expectedSection: "satisfied",
      expectedAttestation: "missing"
    },
    {
      name: "raw HTML block around evidence",
      body: [
        "<div>",
        "## Testing",
        "Tests passed.",
        "- [x] I understand this change.",
        "</div>"
      ].join("\n"),
      expectedSection: "missing",
      expectedAttestation: "missing"
    },
    {
      name: "unclosed raw HTML after visible evidence",
      body: ["## Testing", "Tests passed.", "<div>"].join("\n"),
      expectedSection: "missing",
      expectedAttestation: "missing"
    },
    {
      name: "orphan raw HTML close is ignored",
      body: ["## Testing", "Tests passed.", "</span>"].join("\n"),
      expectedSection: "satisfied",
      expectedAttestation: "missing"
    },
    {
      name: "same-tag raw HTML remains incomplete",
      body: ["## Testing", "Tests passed.", "<div>", "<div>", "</div>"].join("\n"),
      expectedSection: "missing",
      expectedAttestation: "missing"
    },
    {
      name: "self-closing raw HTML does not hide previous evidence",
      body: ["## Testing", "Tests passed.", "<div/>"].join("\n"),
      expectedSection: "satisfied",
      expectedAttestation: "missing"
    },
    {
      name: "empty angle destination remains conservative",
      body: "## Testing\n[](<>)",
      expectedSection: "satisfied",
      expectedAttestation: "missing"
    },
    {
      name: "unclosed angle destination remains visible",
      body: "## Testing\n[](<foo)",
      expectedSection: "satisfied",
      expectedAttestation: "missing"
    },
    {
      name: "invalid unangle title remains visible",
      body: "## Testing\n[](foo invalid)",
      expectedSection: "satisfied",
      expectedAttestation: "missing"
    },
    {
      name: "unclosed quoted title remains visible",
      body: '## Testing\n[](foo "title)',
      expectedSection: "satisfied",
      expectedAttestation: "missing"
    },
    {
      name: "unmatched destination remains visible",
      body: "## Testing\n[](",
      expectedSection: "satisfied",
      expectedAttestation: "missing"
    },
    {
      name: "non-empty link label remains visible",
      body: "## Testing\n[x](foo)",
      expectedSection: "satisfied",
      expectedAttestation: "missing"
    },
    {
      name: "raw HTML attributes may contain closing-angle characters",
      body: ['<style data-x="<">', "## Testing", "Tests passed.", "</style>"].join("\n"),
      expectedSection: "missing",
      expectedAttestation: "missing"
    },
    {
      name: "raw HTML block around a task item",
      body: [
        "## Testing",
        "Tests passed.",
        "<div>",
        "- [x] I understand this change.",
        "</div>"
      ].join("\n"),
      expectedSection: "satisfied",
      expectedAttestation: "missing"
    },
    {
      name: "link reference definition",
      body: "## Testing\n[tests]: https://example.test/report",
      expectedSection: "missing",
      expectedAttestation: "missing"
    },
    {
      name: "link reference definition title continuation",
      body: ["## Testing", "[tests]: https://example.test/report", '  "hidden title"'].join("\n"),
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

  it("does not count case variants of one reviewer login as separate maintainers", () => {
    const reviewPolicy = parsePolicy(`
version: 1
rules:
  - id: review
    when:
      paths:
        any: [src/**]
    require:
      - type: maintainer_review
        minimum: 2
`);
    const result = evaluate(
      reviewPolicy,
      input({
        reviews: [
          { login: "same-person", state: "approved", maintainer: true },
          { login: "SAME-PERSON", state: "approved", maintainer: true }
        ]
      })
    );

    const review = result.requirements.find(
      (requirement) => requirement.type === "maintainer_review"
    );
    expect(review?.status).toBe("missing");
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

  it("fails closed when conflicting reviews share the same timestamp", () => {
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
            submittedAt: "2026-08-10T10:00:00Z"
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

describe("policy matching budget", () => {
  it("bounds matching work across the complete policy, not only one rule", () => {
    const expensivePolicy: Policy = {
      version: 1,
      rules: Array.from({ length: 4 }, (_, ruleIndex) => ({
        id: "expensive-" + String(ruleIndex),
        when: {
          paths: {
            none: Array.from(
              { length: 100 },
              (_, patternIndex) => "missing/" + String(patternIndex) + "/**"
            )
          }
        },
        require: [{ type: "linked_issue" }]
      }))
    };
    const expensiveInput = input({
      changedFiles: Array.from({ length: 3000 }, (_, index) => "changed/" + String(index) + ".ts")
    });

    expect(() => evaluate(expensivePolicy, expensiveInput)).toThrow(
      expect.objectContaining({
        code: "POLICY_MATCHING_BUDGET_EXCEEDED"
      })
    );
    expect(MATCHING_OPERATION_BUDGET).toBeGreaterThan(0);
  });
});
