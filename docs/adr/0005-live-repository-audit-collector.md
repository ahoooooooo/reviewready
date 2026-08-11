# ADR 0005: Live repository audit collection

- Status: accepted for the v1.0.4 candidate
- Date: 2026-08-12

## Context

The pure repository audit engine is deterministic only when its normalized
snapshot is complete and bound to one base revision. A live GitHub adapter must
not turn ordinary API access, a missing permission, or a mutable workflow path
into evidence of a trusted merge gate.

## Decision

`src/github-audit.ts` owns a fakeable read-only collector contract and
`src/github-audit-api.ts` owns the bounded Octokit adapter. The collector:

- reads repository metadata and the evaluated default branch twice, and binds
  policy and every workflow source to the first branch SHA;
- reads policy bytes by immutable base SHA and records their SHA-256 digest;
- collects branch protection, inherited branch/tag rulesets, workflow metadata,
  and tag protection without checking out or executing repository code;
- treats missing branch-review bypass data, missing trusted/protected workflow
  roots, changed base revisions, malformed responses, and unavailable settings as
  incomplete;
- requires protected/trusted workflow paths from an explicit out-of-band root
  configuration. The collector never infers a trusted root from a successful
  API call, a check name, or the fact that a workflow is on the default branch;
- bounds source size, workflow count, concurrency, retries, response bytes,
  request count, pagination, and the overall collection deadline.

The pure `auditRepository` function remains the only classifier. Live collection
cannot influence PR readiness and has no write API. An installation token may
be used by an external caller, but this repository does not ship a server,
secret manager, durable snapshot store, or automatic trusted-root discovery.

## Consequences

The CLI can perform a reproducible read-only live audit when the caller supplies
`--github`, a token environment variable, and explicit workflow roots. A result
with incomplete authoritative data is not a pass. The contract is testable with
fake clients and adversarial API responses, while production deployment still
needs GitHub permission review, protected workflow roots, and operational
retention decisions.

## References

- [Repository audit contract](0002-repository-audit-contract.md)
- [GitHub REST rules](https://docs.github.com/en/rest/repos/rules)
- [GitHub REST pagination](https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api)
