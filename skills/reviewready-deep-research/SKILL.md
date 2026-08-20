---
name: reviewready-deep-research
description: Use when the user explicitly requests deep research, or when a ReviewReady decision depends on current or external facts, public or provider state, competitors, adoption, eligibility, market, strategy, security authority, provenance, or evidence that can change over time.
---

# ReviewReady Deep Research

Use this skill only as an overlay on `$reviewready-base-delivery`. It never
replaces the base baseline, framing, attack, proof, or promotion phases and it
never decides readiness, implementation completion, release, or adoption by
itself.

The base skill and `AGENTS.md` have precedence when rules overlap. This overlay
may add source-evidence requirements, but it may not loosen base limits on
authority, retries, worker admission, timeout handling, close-agent lifecycle,
report shape, or promotion. A deep-research source pass is evidence collection,
not the final independent reviewer.

## Overlay gates

- Require the base route and decision before loading this overlay.
- Treat an explicit user request for this skill as a mandatory overlay signal;
  state `base + deep-research` before searching and never substitute a quick
  status lookup.
- Research only material claims; do not build a ledger for every source or minor
  detail.
- Set a bounded source/query/time budget before searching. Treat it as an effort
  signal, never as an evidence or completion cap.
- Do not recommend, implement, publish, or call a claim current until its
  freshness, counter-case, and action boundary are verified.

## Context budget

Keep this overlay incremental. Start with the user's decision, the base skill,
the root `HANDOFF.md`, and the smallest source set that covers the material source classes. Expand only
when a named unresolved claim could change the decision, a source conflict needs
adjudication, or freshness/authority remains uncertain. Budget exhaustion is not
permission to promote; return `reopen` or `defer-external` when evidence is still
incomplete. Read the full research rationale documents only when reviewing or
changing the method; otherwise use relevant bounded sections. Summarize source
findings into the claim handoff instead of carrying full source pages forward.

The root `HANDOFF.md` is the project-level live handoff, not a source-pass report.
Every research slice records its current phase, one next action, source freshness,
counter-case, and external blocker there; refresh and validate it before handing
the slice to another agent. Its `passed` validation entries must bind to the
current worktree `change_digest`; a refresh cannot turn an older green proof into
current evidence. `RESEARCH_PASS_V1` remains the separate raw-artifact contract
for an individual source assignment.

## Admit the research overlay

Research execution uses the same multi-angle admission as the base route:
a small control-plane canary, a fresh worker readiness canary, and the
source-pass lifecycle are separate proofs. A hanging thread-inventory adapter
is recorded as a path-specific external observation; it does not invalidate a
proven worker route or justify repeating the same fingerprint in one context.
When a research or doctor subprocess is wrapped for JSON capture, drain stdout
and stderr concurrently before waiting for close and close stdin first. A full
report can fill a Windows pipe and masquerade as an external timeout; the base
streaming child canary covers this execution-environment boundary. A timeout
kill must await the child close event before the research adapter returns.

Add this overlay when the user's decision depends on facts outside the trusted
checkout or on claims whose meaning can change with time. Triggers include:

- searching or verifying current provider, repository, package, program, or
  public state as part of a material multi-source decision;
- comparing competitors or technical alternatives;
- assessing adoption, eligibility, ecosystem importance, market, cost, or
  maintainer credibility;
- evaluating security authority, provenance, trust roots, enforcement, or
  external governance; and
- recommending a direction whose supporting evidence is not already frozen.

A known single-source status or fact lookup stays within the base loop and uses
focused proof; it is not a separate route. Only an explicit deep-research request
or material multi-source synthesis enters this overlay. If admission is
ambiguous, keep base and add this overlay only when the unresolved claim could
change the decision.

Do not load this overlay for a bounded local implementation whose behavior,
acceptance examples, and proof sources are already known; keep that work on the
base route unless it reveals a material current, public, trust, or external-
dependency claim.

“Understand the current project status” requires a dated baseline. “Optimize the
process” requires process self-optimization. Neither is a documentation shortcut.
If admission is ambiguous, keep the base route and add this overlay only when
the unresolved current or external claim could change the decision.

### Planning-only path

When the user asks only for a research contract, source plan, decision boundary,
or stop condition, stay in planning mode. Return the route, falsifiable
decision, source classes, strongest counter-case, bounded budget, and stop
condition. Do not load `references/research-method.md`, search providers, run
source passes, spawn agents, or perform external operations until the user
authorizes research execution. This no-agent branch applies only when the
research decision is the target; if the research method, skill, or process is
being changed, the base process-self-optimization reviewer gate overrides it.
A later execution request starts a new round.

## Research execution reference

Keep the overlay lean for admission and source planning. Do not preload the
full reference for a planning-only request. Read
[references/research-method.md](references/research-method.md) only when
starting discovery/source passes, performing contradiction/citation audit,
running final review, or changing the research method. It contains the full
state machine, source contract, claim ledger, counter-evidence, replay,
source-pass validation, final-review handoff, and method self-optimization
rules. The base skill and this skill's hard boundaries remain active.

The deep overlay never changes these base invariants: worker canary before
source/final dispatch, one-primary-artifact packets by default, exact report and
raw evidence binding, terminal timeout with no timeout replacement, agent-bound
close proof, `assertDispatchAllowed()`, and validated `reviewerReadiness` before
promotion. The execution reference adds detail; it does not own authority.

The source-to-final handoff is also a hard invariant: validate each
`RESEARCH_PASS_V1` against its one raw artifact before adding its claims to the
integrator map; preserve source lineage, claim ids, freshness, and the strongest
counter-case; pass only frozen raw artifacts/claim ids and the action-boundary
question to the fresh final reviewer; and never count a source-pass report as
the independent final review. Promotion requires the base `reviewerReadiness`
handoff with exactly one current-epoch final reviewer and one outcome.

The source-to-final transformation is deterministic: validate each
`RESEARCH_PASS_V1` against one `raw:` artifact; add only its validated claims,
lineage, freshness, and counter-case to the integrator map; select the frozen
raw artifacts/claim ids for the final packet; run the base final reviewer; then
validate the final `reviewerReadiness` handoff. The minimum source-pass fields are
`surface`, `sources`, `claim_ids`, `evidence`, `counter_case`, `freshness`, and
`outcome`; source-pass output never counts as the final independent review.

Before report-and-handoff, run `npm run handoff:refresh` and
`npm run handoff:validate`. A research report cannot replace the canonical live
handoff, and a stale handoff cannot be promoted merely because its sources are
valid.

## Promotion and handoff

For research execution and synthesis, read the execution reference first;
planning-only requests stay within this main file and do not load it. Promote
only when no unresolved material claim can change the decision, the strongest counterarguments are
answered or narrowed, unknowns are visible, and the action boundary is safe.
The handoff returns exactly one of `promote`, `reopen`, or `defer-external` and
never grants readiness, release, publication, or adoption authority.
