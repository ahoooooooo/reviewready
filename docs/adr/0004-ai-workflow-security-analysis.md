# ADR 0004: AI workflow security analysis

- Status: accepted for a bounded static-analysis milestone
- Date: 2026-08-11

## Context

AI workflows combine repository source, pull request text, model prompts, model output, shell commands, tokens, secrets, and deployment capabilities. Prompt injection, code execution, and permission escalation are related but distinct failure classes and must not be collapsed into one score.

## Decision

Analyze workflow source as untrusted data. The analyzer must not run a workflow, evaluate expressions, invoke a model provider, resolve secrets, or execute a shell command.

Findings keep these categories separate:

- prompt injection: untrusted issue, review, comment, or model text reaches an instruction or prompt boundary;
- code execution: untrusted or model-controlled data reaches a shell, script, checkout, artifact, or deploy operation;
- capability exposure: secrets, tokens, write permissions, deployment credentials, or privileged events are available to an untrusted path;
- provenance and configuration: mutable action references, ambiguous workflow identity, or unsafe event configuration.

The first analyzer is bounded and deterministic. It reports stable rule identifiers and source locations, emits SARIF 2.1.0, and uses positive and negative fixtures. It is a conservative source/prompt/sink analyzer, not a general workflow linter or a claim about model intent.

## Deferred work

Full data-flow, expression semantics, organization secret inventory, model-specific semantics, and policy mutation are deferred. A finding is an audit result, not a readiness decision; the existing readiness engine remains deterministic and independent.
