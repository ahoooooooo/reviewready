# ADR 0005: Live repository audit collection

- Status: accepted for the hardened v1.0.7 TA-2 collector contract
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
- collects branch protection, inherited branch/tag/push/repository rulesets, workflow metadata,
  and tag protection without checking out or executing repository code;
- models push rulesets without a ref_name condition and keeps
  force-push/deletion controls undefined for targets where those controls do not
  apply; push rulesets never become branch protection or required-check evidence;
- treats missing branch-review bypass data, missing trusted/protected workflow
  roots, changed base revisions, malformed responses, and unavailable settings as
  incomplete;
- rejects branch-protection security fields outside the modeled v1 contract and
  contradictory structured/legacy required-check representations rather than
  silently dropping them;
- treats a missing bounded transport as unavailable for every API read, passes
  the bounded fetch per request, and buffers every response before JSON parsing
  within the response-byte limit. The boundary uses Octokit's configured fetch
  or the runtime global fetch; if neither exists, collection fails closed;
- recognizes GitHub's `repository` target and `~ALL` repository scope, while
  requiring an explicit modeled repository scope and canonical enforcement,
  rejecting repository-target ref/unknown conditions, non-empty ref or
  repository exclusions, and repository-id/property scopes that the normalized
  contract cannot evaluate;
- reports active tag-only rulesets as an explicit incomplete finding rather than
  converting their controls into branch findings;
- requires protected/trusted workflow paths from an explicit out-of-band root
  configuration. The collector never infers a trusted root from a successful
  API call, a check name, or the fact that a workflow is on the default branch;
- bounds source size, workflow count, concurrency, retries, response bytes,
  768 total request attempts, ruleset pagination, and the overall collection
  deadline; the GitHub Contents workflow directory is requested once with only
  its immutable ref, rejects any Link header, and rejects more than the bounded
  workflow count rather than inventing pagination for an endpoint that does not
  expose it in this contract;

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
