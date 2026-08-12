# ReviewReady v1 product contract

## Problem

Pull requests often reach maintainers without the project-specific explanation,
verification, or accountable-human confirmation needed to begin a useful review.
Generic CI can prove that a command passed, but cannot express why a particular
change requires a reproducer, linked issue, threat note, or named review.

## Product statement

ReviewReady evaluates a pull request against a policy owned by the target
repository's base revision and returns one of two states:

- `ready`: every deterministic evidence obligation is satisfied.
- `not_ready`: one or more obligations are missing or invalid.

Readiness means only "prepared for human review." It does not mean correct, safe,
approved, or mergeable.

## v1 users

- An OSS maintainer defines `.reviewready.yml` in the default branch.
- A contributor runs the CLI locally against a normalized input fixture.
- A repository runs the packaged JavaScript Action for pull requests.

## v1 policy

```yaml
version: 1
rules:
  - id: source-change
    description: Source changes need context and test evidence.
    when:
      paths:
        any: ["src/**"]
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
      - type: pr_body_section
        heading: Threat model
      - type: maintainer_review
        minimum: 1
      - type: human_attestation
        text: I understand and take responsibility for this change.
```

All matching rules apply. Repeated equivalent requirements are evaluated once but
reported under every triggering rule.

In v1, a change that matches no rule remains ready with no evaluated
requirements. Human-facing reports and reviewready explain make this zero-match
state visible; it is not evidence that every changed path was classified.
Repositories that require broad path coverage can add a final
paths.any: ["**"] catch-all rule. A future policy/output version may add an
explicit unmatched strategy (ready, not_ready, or error) without changing v1
semantics.

## Normalized pull-request input

The policy engine receives data, not an API client:

- changed repository-relative paths;
- optional previous paths for renamed files; both old and new paths participate
  in path matching;
- PR body and labels;
- linked issue numbers;
- completed checks or terminal commit statuses with name, conclusion, and
  optional app identity;
- reviews with reviewer login, maintainer status, and an optional submission
  timestamp;
- attestations supplied through exact checked markdown task-list items.

The human_attestation requirement verifies only that the specified checked text
is visible in the pull-request body. It does not establish identity,
understanding, authorship, or legal responsibility. Literal backslashes in Git
paths are invalid input; they are not rewritten as separators.

GitHub-specific fetching and normalization live outside the engine.

## Required v1 commands

- `reviewready validate --policy <file>` validates syntax and semantics.
- `reviewready check --policy <file> --input <file> [--json]` evaluates input.
- `reviewready explain --policy <file>` renders policy obligations for humans.

Exit codes are stable: `0` ready/valid, `1` not ready, `2` configuration or
runtime error. JSON output is versioned and written to stdout; diagnostics go to
stderr.

## Security and authority

- The GitHub adapter loads policy content from the base commit SHA via API.
- Pull-request content is untrusted data and is never executed.
- The engine performs no shell interpolation, dynamic imports, or expression eval.
- Matching is repository-relative; absolute paths and traversal are rejected.
- A missing, invalid, or unavailable authoritative policy fails closed as an error.
- The Action requests read-only permissions. It does not post comments, change
  labels, approve, or merge.
- GitHub evidence that cannot be collected completely at the adapter's bounded
  pagination limits, or whose next-page Link is malformed or non-contiguous,
  fails closed rather than being treated as complete.
- GitHub `APPROVED`, `CHANGES_REQUESTED`, and `DISMISSED` reviews require a
  valid submission timestamp; `COMMENTED` reviews may omit it. Missing or
  malformed timestamps on actionable review states fail closed.
- The GitHub adapter binds collection to one pull-request snapshot and retries
  once or fails closed when the pull-request identity, base/head SHA, freshness
  marker, body, or label set changes before, between, or after evidence reads.
- Required checks, reviews, and linked issues are read twice with a bounded
  canonical comparison; a changed evidence set while the PR snapshot is stable
  causes a retry or a fail-closed error.
- A normal pull_request caller workflow is advisory unless the repository
  separately protects the trusted workflow root and required result.
- The Action renders its Markdown summary and report-json completely before
  writing either sink. It rejects report-json above 1,000,000 UTF-8 bytes or a
  Markdown summary above 1 MiB with a stable fail-closed error, and publishes
  the status output last so a failed later output cannot leave status=ready.

## v1 quality bar

- Unit tests cover all matching and evidence requirements.
- Integration tests cover CLI exit codes and GitHub event normalization.
- Security regression tests cover path traversal, malicious headings, untrusted
  strings, self-modified head policy, pagination, and API failures.
- Core modules maintain at least 90% line/function/statement and 85% branch coverage.
- `npm run check` performs formatting, linting, type checking, tests, and production
  bundling from a clean dependency install.

## Non-goals

- Detecting whether AI wrote a contribution.
- Reviewing code correctness or security.
- Running project tests or pull-request code.
- Auto-approval, auto-merge, or policy waivers.
- LLM-based pass/fail decisions.
- SaaS, dashboards, databases, GitLab, or Bitbucket.
- Claiming official Agent Governance Manifest compatibility.
