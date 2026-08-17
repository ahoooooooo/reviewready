# ADR 0015: Authenticated attestation provenance for v2

- Status: accepted design for V2-1-D; implementation deferred
- Date: 2026-08-17
- Tracks: issue #59
- Extends: ADR 0008, attestation text provenance

## Decision

The v1 checked-task requirement remains text evidence only. It does not prove
who checked a task, who understood a change, or who accepts legal or personal
responsibility. Version 2 may add a separately versioned attestation contract,
but only when an external authority can authenticate the actor and bind the
event to the evaluated revision.

An accepted v2 attestation must bind all of these values: actor identity,
event identity, numeric repository identity, base SHA, head SHA, policy digest,
and a bounded freshness marker. The actor is evidence about an authenticated
event, not a claim of human comprehension. A bot or AI-assisted actor is not
silently relabeled as a human reviewer.

## Deterministic states

- accepted: every binding value is authenticated, current, unique, and
  consistent with the evaluation;
- rejected: the authority is available but the evidence is stale, replayed,
  dismissed, wrong-repository, wrong-revision, revoked, or otherwise invalid;
- unknown: the authority, storage, or provider response is unavailable or
  contradictory, so acceptance cannot be decided.

Only accepted is attestation evidence. Rejected and unknown are never converted
into a pass, and neither is collapsed into a guessed identity. The fixture
fixtures/policy/v2-attestation-provenance.json records the minimum binding,
retention limits, and three boundary outcomes without storing contribution
text, raw request bodies, credentials, or private keys.

## Privacy, replay, and migration

Raw evidence is transient. The normalized record is bounded and retained for
at most 30 days; replay tombstones remain for at most 90 days and cannot be
deleted early without losing replay protection. Deletion is auditable and a
failed deletion is an operational failure. A provider outage or ambiguous
transaction is unknown until a bounded authoritative read resolves it.

The contract is opt-in and versioned. Existing v1 JSON and policy files retain
their meaning. No username heuristic, comment text, or successful workflow name
can satisfy v2 provenance. The implementation successor must select the
external authority, prove its replay and revocation behavior, and preserve the
public v1 schema before adding any v2 field.

## Non-goals

This ADR does not create a legal signature, non-repudiation, human-comprehension
claim, GitHub App deployment, merge permission, LLM judgment, or readiness
decision. Production authority remains an external TA-3 capability and is not
required for this design-only node.
