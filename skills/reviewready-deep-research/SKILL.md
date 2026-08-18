---
name: reviewready-deep-research
description: Use when the user explicitly requests deep research, or when a ReviewReady decision depends on current or external facts, public or provider state, competitors, adoption, eligibility, market, strategy, security authority, provenance, or evidence that can change over time.
---

# ReviewReady Deep Research

Use this skill only as an overlay on `$reviewready-base-delivery`. It never
replaces the base baseline, framing, attack, proof, or promotion phases and it
never decides readiness, implementation completion, release, or adoption by
itself.

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
and the smallest source set that covers the material source classes. Expand only
when a named unresolved claim could change the decision, a source conflict needs
adjudication, or freshness/authority remains uncertain. Budget exhaustion is not
permission to promote; return `reopen` or `defer-external` when evidence is still
incomplete. Read the full research rationale documents only when reviewing or
changing the method; otherwise use relevant bounded sections. Summarize source
findings into the claim handoff instead of carrying full source pages forward.

## Admit the research overlay

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

“Understand the current project status” requires a dated baseline. “Optimize the
process” requires process self-optimization. Neither is a documentation shortcut.
If admission is ambiguous, keep the base route and add this overlay only when
the unresolved current or external claim could change the decision.

## Research state machine

Run these states in order and checkpoint after each one:

```text
research-contract
  → source-plan
  → discovery-pass
  → coverage-audit
  → targeted-deep-dives
  → contradiction-and-citation-audit
  → independent-review
  → report-and-handoff
```

Do not draft the final narrative during discovery. Keep the claim map and source
ledger as the working state; every later search must either support, weaken,
qualify, or leave unchanged a named claim.

### 0. Research contract

Before searching, state the decision, audience, scope, time boundary, source
restrictions, deliverable shape, cost budget, and what result would change the
decision. Present the source plan before starting a costly round. If the prompt
is materially ambiguous, ask one focused clarification instead of researching
the wrong question.

### 1. Source plan

Turn the decision into a small query graph: subquestions, required source
classes, expected evidence, and stop conditions. Prefer authoritative sources
for each subquestion and identify the strongest likely counter-source before the
first search. Use the initial budget as a starting point; expand only with a
named unresolved claim and reason.

### 2. Discovery pass

Search in bounded batches. Open the actual primary sources, capture dates,
revision or release, scope, and the minimum useful excerpt or digest, then
update the claim ledger. Record rejected or irrelevant sources only when their
absence explains a coverage decision. Send progress at checkpoint boundaries,
not after every query.

When a source, query, tool, or provider fails, capture it in the claim state
before retrying: symptom, evidence, affected claim, impact, alternative path,
and status. Do not repeat the same failing search automatically. A missing or
unavailable source is an evidence gap, not support for the claim. Keep one error
record per distinct failure and summarize it at the next checkpoint.

### 3. Coverage audit

Pause and audit the map before deep-diving. For every material claim, mark it
supported, contradicted, partially supported, stale, unsupported, or unknown.
Identify claims with high decision impact, source conflict, weak authority,
volatile freshness, or missing counter-evidence. Create one next action per gap;
do not widen the search without a gap that could change the decision.

### 3.1 Bounded research delegation

After the coverage audit, build a surface matrix before dispatching research
agents. For multi-source decisions, start with two raw-artifact-only passes:
one authority/primary-source surface and one counter-evidence or alternative
surface. Add one pass per additional material surface, up to four source agents
total and two active agents at once. A single-surface decision may use one pass.

Each pass receives only the frozen decision, revision, source restrictions,
assigned surface, excluded surfaces, raw artifacts, falsifier, and deadline. Do
not pass the integrator claim map, citations, counter-case, action boundary, or
sibling reports. Each pass returns source lineage, claim IDs, evidence, and its
strongest unresolved objection; it never writes the final narrative.

Deep-research handoffs use raw: artifact ids for source material; derived claim
maps, sibling summaries, and recommendations are not raw artifacts and must not
be placed in the raw artifact list.

Expand only when an unresolved claim could change the decision and the new
surface has disjoint authority, artifacts, and falsifier. Permit one replacement
for a timeout or tool failure inside the same research budget. Close completed
or overlapping passes. Stop when every material surface is owned, the claim map
no longer changes, and another pass cannot change the action boundary.

### 4. Targeted deep dives and pivots

Search only for the gaps from the coverage audit. Pivot query terms, source
class, or abstraction level when the current search path stalls. For a conflict,
read the competing primary sources and preserve both interpretations until the
scope, date, authority, or wording resolves it. If a claim cannot be resolved,
narrow it or mark it unknown instead of adding more repetition.

### 5. Contradiction and citation audit

Before synthesis, check every material sentence:

- does a cited source support the exact wording and scope;
- is the source authoritative and current enough for the decision;
- is the claim fact, inference, recommendation, unknown, or external dependency;
- is the strongest counter-case visible; and
- would changing this source or date change the decision?

Remove unsupported adjectives, merge duplicate claims, and downgrade any claim
whose citation only supports a weaker statement. Never manufacture a citation,
quote, metric, or source identity.

### 6. Independent review

After the contradiction/citation audit and source replay, dispatch one final
fresh reviewer with fork_context=false against the current review epoch. Give it
only the frozen decision, raw source artifacts, source lineage, claim IDs,
counter-case candidates, and action-boundary question. Do not pass the
integrator claim map or sibling conclusions. Require a handoff with the
strongest falsifier, missed source/surface, authority or freshness gap,
recommendation, and one outcome.

The final reviewer must be able to reject the conclusion. Record the
deep-research route, review epoch, assignments, surface coverage, source
lineage, and claim ids in the multi-reviewer handoff. A timeout, partial
review, or unavailable independent pass is incomplete evidence and yields
defer-external; do not substitute adversarial self-review for the required
fresh pass. Any material repair, revision, scope, source set, or action-boundary
change invalidates the review epoch and requires a new final review.

### 7. Report and handoff

Deliver the report only after the prior states settle. Separate facts, inferences,
recommendations, unknowns, and external dependencies. Include the claim map,
source list, counter-case, limitations, freshness, and one safe next action.

Keep the final research handoff compact:

```text
Decision: <one decision boundary>
Claims: <material claims and their status>
Counter-case: <strongest unresolved objection or none>
Freshness: <observation date and refresh trigger>
Outcome: promote | reopen | defer-external
Next: <one falsifiable action and owner>
```

## Promotion and handoff

Promote only when no unresolved material claim can change the decision, the
strongest counterarguments are answered or narrowed, all unknowns are visible,
all material claims have source/date/freshness records, and the action boundary
is safe and explicit. Hand off one decision boundary, one owner, one falsifier,
one acceptance condition, and one next action. Do not imply implementation,
publication, adoption, or authority that the evidence does not prove.

If the research method itself changes, freeze its current revision and replay
the old and candidate methods against an external-program/adoption question, a
competitor/technical-landscape question, a repository decision that becomes a
work slice, and the process-change task itself. Compare missed sources,
unsupported certainty, stale-claim detection, counter-case coverage, handoff
completeness, duplicated effort, and action-boundary safety. Keep the simpler
method when no meaningful improvement is demonstrated.
