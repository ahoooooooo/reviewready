# ReviewReady audit evidence bundle v2 extension

- Status: normative extension to the frozen v1 contract
- Date: 2026-08-15
- Governing decision: [ADR 0010](adr/0010-ruleset-semantics-evidence-v2.md)

Bundle v2 uses the complete top-level shape, canonicalization, integrity
domains, source-artifact binding, replay rules, bounds, and missing-state rules
defined by [the v1 contract](audit-evidence-bundle-v1.md). The version change is
intentional: v1 must not accept or discard the fields below.

## Version dispatch

```text
bundleVersion: 2
snapshot.snapshotVersion: 2
```

Both values are required and must match. A v1 bundle with v2 fields, or a v2
bundle with a v1 snapshot, is invalid. A bundle with no modeled ruleset
semantics remains v1 so existing fixtures and consumers do not change shape.

## Ruleset extension

The v2 ruleset keeps every v1 ruleset field and may add these closed objects:

```text
pullRequest?: {
  allowedMergeMethods: ("merge" | "rebase" | "squash")[1..3]
  dismissStaleReviewsOnPush: boolean
  requireCodeOwnerReview: boolean
  requireLastPushApproval: boolean
  requiredApprovingReviewCount: integer 0..100
  requiredReviewThreadResolution: boolean
  requiredReviewers: []
}

requiredStatusChecksPolicy?: {
  doNotEnforceOnCreate: boolean
  strictRequiredStatusChecksPolicy: boolean
}
```

Merge methods are unique and sorted in canonical evidence. Required checks are
the existing bounded, provider-aware check projection. The empty reviewer list
is an explicit verified fact for the currently supported API shape, not a
placeholder for unknown reviewers.

## Unsupported inputs

The collector and replay validator reject unknown fields, duplicate review or
status rules, partial status-policy fields, non-empty `required_reviewers`,
`dismissal_restriction`, invalid merge methods, and invalid scalar values.
No error path downgrades these facts to v1 or silently drops them. Adding
non-empty reviewer provenance or other GitHub ruleset semantics requires a new
focused red corpus and an ADR update.

## Compatibility and trust boundary

This extension is additive to the evidence contract only. It does not modify
`reviewready.result.schema.json`, readiness classification, audit report
version, workflow trust, policy source selection, or the prohibition on
executing pull-request code. Evidence remains historical and read-only; hashes
provide integrity detection, not producer authentication.
