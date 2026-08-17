# ADR 0013: Bounded AI-workflow security corpus

- Status: accepted design for AI-1-D; implementation deferred
- Date: 2026-08-17
- Tracks: issue #57

## Decision

ReviewReady defines AI-workflow findings as a bounded, deterministic source-to-
capability contract. The analyzer treats workflow files, pull-request text,
issue text, model output, expressions, action references, secrets, tokens, and
deployment inputs as untrusted data. It never runs a workflow, evaluates a
model, resolves a secret, checks out a pull-request ref, or invokes a shell.

The first corpus keeps five threat classes separate:

- prompt_injection: untrusted repository or contribution text crosses an
  instruction boundary;
- code_execution: untrusted or model-controlled data reaches shell, script,
  checkout, artifact, or deployment execution;
- capability_exposure: secrets, tokens, or deployment credentials are made
  available to an untrusted path;
- permission_escalation: an untrusted event is combined with write or
  privileged permissions;
- provider_provenance: mutable references or ambiguous workflow/provider
  identity prevent a trusted source from being established.

## Contract

Each corpus case contains only the source, the modeled flow, the terminal sink,
and the expected oracle. A fully modeled safe case may return no_finding; a
proven vulnerable case returns finding; an incomplete, contradictory, or
over-limit graph returns unknown. Unknown is never converted to readiness or
to a successful security claim.

fixtures/ai-workflow/security-corpus-v1.json is the executable seed corpus. It
fixes the initial resource bounds, threat vocabulary, stable rule IDs, and
representative safe/vulnerable/ambiguous cases. The fixture is a contract, not
an assertion that the future analyzer understands all workflow semantics.

## Stable output and limits

Finding IDs remain stable across ordering changes. A SARIF result must bind the
rule ID, artifact URI, bounded source location, category, and explicit
certainty (finding or unknown). Results are canonically ordered by artifact
URI, source location, rule ID, and message code. Oversized files, excessive
traversal, malformed YAML, unresolved reusable workflows, and contradictory
provider identity fail closed as unknown or as a bounded input error.

The initial limits are 256 KiB per workflow, 32 corpus cases, 64 findings, and
16 traversal levels. They are resource controls, not estimates of semantic
coverage. Raising a limit requires a new bounded fixture and a separate review.

## Non-goals

This contract does not add an LLM verdict, change readiness, infer model intent,
replace a workflow linter, or claim complete taint analysis. Prompt injection,
code execution, capability exposure, permission escalation, and provider
provenance remain separately reportable so a reviewer can distinguish their
remediation and residual risk.

## Promotion boundary

The design leaf may close after the corpus, expected oracles, SARIF identity,
resource bounds, and unknown behavior are independently reviewed. An analyzer
implementation and its production evidence are separate successor issues.
