---
name: reviewready-base-delivery
description: Use when working on any task in the ReviewReady repository, including project status, implementation, documentation, tests, security, trust, release, architecture, process, or skill changes.
---

# ReviewReady Base Delivery

Apply this skill to every ReviewReady task. It is the mandatory base loop; other
skills add evidence lanes but never replace it.

## Hard gates

- Emit the route, outcome, scope, and exit gate before the first tool call.
- Do not edit files until the baseline is anchored and the decision is framed.
- Do not start the next slice until the current slice has focused evidence and a
  plan update.
- Do not claim complete, fixed, passing, or ready without fresh verification
  output from the command or evidence that proves that exact claim.

## Start before tools or edits

Send a compact route and plan update:

```text
Route: base-full + <overlays, if any>
Outcome: <one observable result>
Scope/non-goals: <what is and is not changing>
Exit gate: <evidence required to finish>
```

Always attach `base-full`. Add overlays from the prompt:

- `process-self-optimization`: change or compare a workflow, prompt, skill,
  routing rule, agent method, or repository process;
- `promotion`: publish, commit, push, merge, tag, deploy, credentials, secrets,
  permissions, provider writes, or repository-setting changes;
- `consequential`: security, trust, provenance, release, package, workflow,
  Action, schema, public API, compatibility, migration, architecture, or
  multi-surface work; and
- `deep-research`: the decision depends on current or external facts, search,
  competitors, adoption, eligibility, strategy, recommendations, or external
  authority. Read and apply `$reviewready-deep-research` as an overlay.

`routine` describes scope only. It never skips a base phase. If the prompt is
ambiguous, add the stronger overlay. “Fully understand the project,” “check the
latest state,” “recommend a strategy,” and “optimize the process” are not routine.

## Context budget

Keep the default context small: `AGENTS.md`, this skill, the exact active plan,
and only the files needed for the current slice. Load `reviewready-deep-research`
only for its overlay. Load rationale documents on demand rather than alongside
the skill: use product/architecture for behavior or trust, post-v1 for node
planning, release/operational/status documents for public or external work, and
research documents for research or process-method changes. Use `rg` to locate
headings and read bounded ranges. Do not preload all of `docs/`, `src/`, or
`test/`, and do not reread unchanged context after compaction.

## The full iterative loop

### 1. Anchor the baseline

Read the nearest `AGENTS.md`, product and architecture contracts, active plan or
issue, relevant tests, fixtures, evidence, and release rules. Inspect the exact
revision and current worktree before deciding what to change. Preserve unrelated
dirty work. Classify observations as local, live, externally enforced, public
artifact, or adoption evidence. Record dates and revisions for time-sensitive
facts. Start a new round if the target moves materially.

### 2. Frame one decision

Define one observable outcome, trust boundary, work kind, non-goals,
prerequisites, falsifier, and exit gate. Keep exactly one active slice. If the
prompt contains multiple outcomes, split them into ordered slices instead of
quietly widening scope.

### 3. Attack before repairing

Batch independent attacks before choosing a fix. Cover the relevant surfaces:
correctness, hostile input, authority and provenance, compatibility, operations,
public artifacts, and evidence freshness. Preserve failed attempts and the
strongest unresolved objection. Do not patch the first finding while an
unexplored surface could change the decision.

### 3.1 Capture errors before repairing

For a non-critical failure, write one compact record in the current plan, PR, or
issue before changing anything:

```text
Error: <symptom>
Evidence: <command, output, source, or URL>
Impact: P0/P1/P2 and blocking/non-blocking
Class: product | process | environment | evidence | external
Next: <repair, retry, defer, or continue>
```

Stop and address P0 security, data-loss, corruption, or required-gate blockers.
Capture P1 blockers before the next repair batch. Continue past non-blocking P2
errors when safe, then batch them. Do not create a new memory document or test
for a one-off failure unless it is recurring, material, or executable behavior.

### 4. Synthesize and choose the smallest safe slice

Separate product defects, design gaps, process defects, environment failures,
evidence gaps, and external dependencies. Connect findings to sources, tests,
or falsifiable examples. A bug starts with a failing regression. A trust,
schema, identity, persistence, execution, migration, or release change needs a
design gate before implementation.

### 5. Iterate with evidence

For every slice, use:

```text
evidence → finding or hypothesis → smallest action → focused validation → plan update
```

Keep one plan step in progress. If validation finds a gap, return to attack with
the failed attempt intact. Continue safe local work when an external dependency
is unavailable; do not rename an unresolved result into a pass.

Keep iteration updates compact:

```text
Phase: <current phase>
Evidence: <what changed or was verified>
Decision: <continue, reopen, defer-external, or promote>
Next: <one action and its exit gate>
```

### 6. Prove the current attempt

Use focused proof first, then the complete gate required by the repository:

- behavior: focused regression, then `npm run check`;
- documentation/process: format check, relevant review, `git diff --check`, and
  `npm run check` when repository instructions require it;
- research overlay: primary sources, reproducible queries, dates, revisions,
  counter-evidence, claim boundaries, and refresh triggers;
- package, Action, release, or public surface: exact artifact, generated parity,
  clean-room/package checks, public-coordinate verification, and authorization.

Inspect generated or public artifacts included in the diff. Stale, incomplete,
contradictory, oversized, race-affected, or unbound evidence cannot satisfy a
gate. Do not add tests that only snapshot prose instructions; add executable
tests only for behavior, public contracts, or deterministic artifacts.

### 7. Promote, reopen, or defer

Promote only when the exit gate passes for the exact current attempt, no material
in-scope objection remains, and the next authority boundary is explicit.

- `reopen`: a material local or evidence gap requires another iteration;
- `defer-external`: the remaining action belongs to a named provider, maintainer,
  consented pilot, credential, deployment, or other external authority; and
- `blocked`: only after safe alternatives and independent work are exhausted and
  the same external condition prevents progress.

Internal proof does not mean merged, published, adopted, or production-authoritative.
Do not commit, push, publish, deploy, mutate settings, or move tags without the
required authorization and project release gates.

## PR evidence gate

Before creating or updating a PR, read the effective `.reviewready.yml` and
`.github/PULL_REQUEST_TEMPLATE.md`. Match changed paths to required evidence and
copy the exact required headings into the body. Do not substitute `Why`,
`Validation`, or `Scope` for a required `Risk` or `Testing` section. Inspect the
final body before submitting; a policy check is exact and fails closed on a
missing section even when CI is green.

## Process/skill changes

For this rare route, add `process-self-optimization`, read the process rationale
on demand, and pressure-test old versus candidate behavior with a few realistic
prompts. Compare skipped gates, unnecessary work, stale claims, handoff quality,
and completion claims. Record the result as process evidence; do not add tests
that only assert skill prose, and keep the simpler version without material gain.

## ReviewReady invariants

Keep readiness deterministic. Never let an LLM decide readiness, approve, merge,
or establish human identity. Load effective policy from the immutable base
revision. Treat PR metadata, paths, labels, events, Markdown, API responses,
workflow source, and external settings as untrusted. Never execute pull-request
code in a trusted path. Bound inputs, requests, retries, pagination, concurrency,
deadlines, matching work, output, and artifacts. Keep readiness, audit,
evidence-bundle, ingress, observability, AI analysis, and SARIF contracts
separate.
