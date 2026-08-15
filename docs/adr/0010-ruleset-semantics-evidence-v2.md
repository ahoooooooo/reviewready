# ADR 0010: Versioned evidence for modeled GitHub ruleset semantics

- Status: accepted; implementation, focused verification, and main-bound live
  promotion complete; durable acceptance artifact review remains pending
- Date: 2026-08-15
- Supersedes: none; extends [ADR 0009](0009-replayable-audit-evidence-bundle.md)

## Context

The authenticated ReviewReady repository exposes GitHub ruleset facts that the
original evidence bundle v1 deliberately rejected: pull-request review
parameters and required-status enforcement parameters. Treating those fields as
unsupported was correct for v1, but it prevents a live TA-2 collection from
producing evidence for the current repository. Accepting them in v1 would be a
silent public-contract change and could discard enforcement semantics.

## Decision

Keep `bundleVersion: 1` and `snapshotVersion: 1` frozen. A v1 bundle continues
to reject every v2 semantic field, and every existing v1 fixture remains valid.

When a collected snapshot contains a modeled ruleset semantic, emit
`bundleVersion: 2` and `snapshotVersion: 2` together. All other top-level,
artifact, integrity, canonicalization, replay, resource, and privacy rules stay
the same as v1. Version mismatch is fail closed.

The v2 ruleset projection currently preserves:

- `pullRequest.allowedMergeMethods` (`merge`, `rebase`, `squash`), stale-review,
  code-owner, last-push, required-approval-count, and thread-resolution flags;
- `requiredStatusChecksPolicy.doNotEnforceOnCreate` and
  `strictRequiredStatusChecksPolicy`;
- the already modeled required check identities.

`required_reviewers` is modeled only as a verified empty set. Non-empty reviewer
identities, `dismissal_restriction`, unknown parameters, partial policy fields,
duplicate rules, invalid merge methods, and malformed values remain stable
fail-closed errors. They require a later contract decision with explicit
provenance and file-pattern semantics; they must not be represented as an empty
set or otherwise guessed.

Semantic arrays are canonicalized before hashing. Merge methods are sorted in
the evidence projection; checks and existing set-like arrays retain their
existing canonical comparators. No provider identity, actor login, URL, token,
or raw API response is added to the bundle.

The existing readiness result and audit report contracts are unchanged. These
fields enrich historical repository-audit evidence; they do not decide PR
readiness, approval, mergeability, or trusted workflow provenance.

## Consequences

The current repository can pass the TA-2 collector's semantic boundary without
weakening v1. Offline replay hydrates the new fields and recomputes the same
deterministic audit report. Consumers that only support v1 can reject v2 by
version, while the public schema explicitly validates both versions and their
matching snapshot versions.

The v2 contract is intentionally narrower than the full GitHub ruleset API.
That limitation is visible in diagnostics and documentation rather than hidden
by lossy projection. A future extension must add its own regression corpus and
ADR before accepting additional reviewer or bypass semantics.

## Promotion gate

TA-2 promotion requires the focused parser, projection, schema, and replay
tests; `npm run check`; `git diff --check`; a main-bound authenticated
collection that emits a valid v2 bundle; offline replay of that exact bundle;
and inspection of the canonical artifact before release publication.
