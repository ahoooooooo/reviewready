# ADR 0008: Attestation text is not human provenance

- Status: Accepted for v1; stronger provenance deferred to v2
- Date: 2026-08-12

## Decision

The v1 human_attestation policy name and JSON field are retained for wire
compatibility, but their meaning is deliberately narrow: the evaluator checks
that one exact checked task-list assertion is visible in the selected
pull-request body snapshot.

That result does not identify the actor who edited or checked the body, prove
that a person read or understood the change, prove authorship, or create a
legal signature. The Action and CLI human-facing reports therefore describe
checked task-list text and never claim identity or comprehension verification.
The v1 JSON summary remains unchanged so existing consumers do not break.

Automation, including AI agents and Dependabot, must not manufacture or claim a
human responsibility assertion. A repository that accepts automated changes
should use an explicit policy without this requirement, or require an
independent review path that the repository can authenticate.

## Future mechanism

A future policy version may introduce a non-authenticating name such as
checked_attestation, or a separately versioned provenance requirement. Any
stronger mechanism must bind the actor identity, event type, evaluated
repository, base SHA, head SHA, policy revision, and freshness marker. It must
also document what authorization and replay guarantees the GitHub App or
signed interaction actually provides. A username or bot-name heuristic is not
provenance.
