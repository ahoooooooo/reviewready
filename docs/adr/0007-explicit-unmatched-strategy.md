# ADR 0007: Explicit unmatched-change strategy

- Status: Accepted for v1 compatibility; v2 design
- Date: 2026-08-12

## Context

The v1 engine evaluates every rule whose path or label conditions match. If no
rule matches, it returns the historical ready result with an empty
triggeredRules and requirements set. That is a compatibility contract, not
proof that every changed file was classified.

A repository can make the current behavior visible with the CLI explain output
and the human-facing No policy rules matched report. A broad path rule such as
paths.any: ["**"] is the documented v1 catch-all for repositories that want
every non-empty changed-path set to enter at least one rule.

## Decision

Keep the v1 zero-match result as ready. Do not add a new field to the v1 JSON
result or change existing exit codes in a patch release.

The v1 reports must state that zero matching rules means no requirements were
evaluated. explain identifies whether the policy contains the broad path
catch-all form. The policy remains deterministic: no model or heuristic infers
whether a repository intended full coverage.

For a future policy/output version, add an explicit policy-level unmatched
strategy with exactly these choices:

- ready: preserve the v1 fail-open behavior;
- not_ready: return a deterministic missing-coverage result;
- error: return a stable configuration/evaluation error.

The strategy must be represented only in that future version's schema and
versioned output. A migration must define the default for omitted values and
must not reinterpret existing v1 policy files.

## Consequences

Repositories requiring full classification should add paths.any: ["**"] as a
final rule and choose requirements appropriate for that class, while checking
that more specific rules still express their stronger obligations. The catch-all
is not a proof that a policy is complete; it only prevents an empty match set
for ordinary path input.

Coverage fixtures can exercise typo-like unmatched paths, labels, renames, and
intentional no-op classes locally without contacting GitHub. The current
engine/report tests preserve v1 behavior and make the no-match state visible.
