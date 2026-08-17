# ADR 0014: Explicit unmatched-change semantics for v2

- Status: accepted design for V2-1-D; implementation deferred
- Date: 2026-08-17
- Tracks: issue #58
- Extends: ADR 0007, explicit unmatched strategy

## Decision

Version 1 keeps its historical zero-match behavior: no matching rule produces
ready, exit code 0, and the existing public JSON shape. The reports must say
that no requirement was evaluated; they must not imply full change coverage.

Version 2 opts in through an explicit policy version and an explicit
unmatchedChanges.strategy. The only strategies are:

- ready: preserve the v1 behavior deliberately;
- not_ready: classify an unmatched change as a deterministic coverage failure;
- error: reject a missing, unknown, malformed, or unsupported strategy.

The result and CLI mapping is fixed at ready/0, not_ready/1, and error/2. An
omitted strategy in a v2 policy is error, not an implicit ready. An unknown
strategy is also error. This prevents a typo or partial migration from
silently weakening coverage.

## Migration and rollback

Migration from v1 to v2 is explicit. A maintainer must select a strategy; the
tool does not infer intent from the old policy or from changed paths. Existing
v1 files are never reinterpreted in place. Downgrade is allowed only when the
selected v2 strategy is ready and no v2-only output is required. Downgrading
not_ready or error is blocked because it would lose meaning.

Rollback restores the previous versioned policy and its fixtures. It does not
rewrite historical results, add v2 fields to v1 JSON, or change v1 exit codes.
The executable decision table and migration examples are in
fixtures/policy/v2-unmatched-change-strategy.json.

## Non-goals

This ADR does not implement v2 parsing, modify the v1 schema, classify a path
using heuristics, or turn a research/documentation decision into readiness
authority. Implementation must add versioned schemas and golden fixtures as a
separate successor.
