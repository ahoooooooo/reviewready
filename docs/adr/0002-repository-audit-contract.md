# ADR 0002: Repository-level audit contract

- Status: accepted for the first offline audit implementation
- Date: 2026-08-11

## Context

PR readiness and repository security posture are different questions. Readiness checks whether a particular contribution supplied the evidence required by the policy loaded from the base revision. An audit checks whether the repository configuration and workflow trust boundaries make that evidence meaningful.

GitHub rules can be layered with branch protection and rulesets. A required check display name also does not identify the producer, workflow, event, or commit that produced it. A live collector therefore needs a bounded, explicit contract before it can be allowed to influence an audit result.

## Decision

The first audit command will be a deterministic, read-only engine over a normalized repository snapshot:

```text
reviewready audit --input <snapshot> [--json | --sarif]
```

The command does not contact GitHub, check out a revision, load repository workflow code, invoke an LLM, or execute a workflow. A future GitHub adapter may collect and normalize settings, but the pure audit engine remains the authority for classification and reporting.

The versioned snapshot contract must explicitly bind:

- repository owner, name, and default branch;
- base revision SHA, policy path, and the fact that the policy was loaded from that base revision;
- branch-protection and active-ruleset facts, including required checks, bypass actors, and exact branch/ref scope;
- branch, tag, force-push, deletion, review, and administration controls;
- required-check identity and provenance facts, not only display names;
- every workflow metadata record that could produce a required check, with protected-root state and bounded source text or derived facts;
- bounded limits and completeness for every collection.

Unknown, missing, contradictory, stale, over-limit, or malformed input produces `incomplete` or `fail`; it must never be upgraded to `pass` because a field looks plausible.

Findings use stable codes, categories, severity, deterministic paths, and messages. Findings are sorted by code, path, and message before serialization.

The audit report has its own `auditVersion` and status of `pass`, `fail`, or `incomplete`. It is deliberately separate from the existing readiness report and must not change the existing public readiness JSON schema. Exit codes are 0 for pass, 1 for findings, and 2 for incomplete or invalid input.

The initial checks cover:

- branch-protection and ruleset coverage for the evaluated base branch;
- force-push, branch-deletion, tag, review, and ruleset-bypass exposure;
- duplicate required-check identities and same-name checks with ambiguous provenance;
- policy-path and base-revision binding, including settings-policy mismatches;
- workflow protection, immutable action references, `pull_request_target`, and checkout or execution of PR content;
- deterministic AI workflow source, prompt, and sink hazards, reported as security findings rather than readiness decisions.

The pure engine remains the authority for classification. The v1.0.4 candidate
also provides a separate, read-only live collector (`github-audit` plus
`github-audit-api`) that produces this normalized snapshot from bounded GitHub
REST reads. It binds policy/workflow bytes to one immutable base SHA, performs
a second repository/branch consistency read, preserves unknown bypass data, and
requires explicit protected/trusted workflow roots. It does not execute code,
infer a trust root from API visibility, or turn missing permissions into pass.

The collector is not a server or merge gate. GitHub App credentials, HTTP
transport, durable storage, secret rotation, and deployment remain external
integration responsibilities.

## Consequences

The normalized snapshot can be fixture-tested without network access and can be
reviewed as an explicit trust boundary. The offline command remains useful for
fixtures and clean-room review, while the live command can discover settings
only through the explicitly bounded adapter. Production adoption still
requires permission review, protected workflow roots, and an operational
durable store.

## References

GitHub rules, branch-protection, and ruleset API documentation.
