# Deep research execution reference

Read this reference only after deep-research execution is authorized (or when
auditing or changing the research method); planning-only requests stay in
`SKILL.md` and do not load this file. The base skill remains authoritative for
baseline, worker admission, packet limits, timeout/close, external authority,
and promotion.

## State machine

Run these states in order:

```text
research-contract
  → source-plan
  → worker-admission
  → discovery-pass
  → coverage-audit
  → targeted-deep-dives
  → contradiction-and-citation-audit
  → base-independent-review
  → report-and-handoff
```

Do not draft the final narrative during discovery. Maintain a claim/source
ledger; every later search must support, weaken, qualify, or leave unchanged a
named claim. A later source observation starts a new round rather than silently
rewriting an earlier evidence snapshot.

## Research contract and source plan

Freeze the decision, audience, scope, time boundary, source restrictions,
deliverable, bounded query/time budget, and the result that would change the
decision. The question must be falsifiable and the action boundary explicit.

Build a small query graph: material subquestions, required source classes,
expected evidence, strongest counter-source, and stop conditions. Prefer primary
authoritative sources. Preserve stable URLs or API queries, repository revision
or release, observation date, bounded content/digest, freshness trigger, and
scope. A mutable source that cannot be replayed is a time-bound observation.

## Source passes

Build a surface matrix. Start with two raw-artifact-only passes for a
multi-source decision (authority/primary source and counter-evidence/alternative)
and add a pass only when a named unresolved claim could change the decision.
Keep at most four evidence-collection source passes and two active passes. This
cap does not include the base-governed final reviewer or its worker canary.

Before the first pass, complete the base control-plane and worker canaries. Each
pass owns one surface and one primary raw artifact by default, with explicit
exclusions, one falsifier, one question, and one deadline. Larger evidence is
split into disjoint passes. Research passes are not final independent reviews.
Use `createResearchPassWatchdog` for each admitted source pass so valid,
malformed/off-scope, timeout, and tool-failure outcomes all reach the same
close-once terminal lifecycle before `RESEARCH_PASS_V1` claims enter the map.

Require the exact bounded source-pass handoff:

```text
RESEARCH_PASS_V1
surface=<one assigned surface>
sources=<raw source ids or queries>
claim_ids=<claim ids>
evidence=<raw artifact id and bounded digest>
counter_case=<strongest contrary evidence or none>
freshness=<observation date and refresh trigger>
outcome=<continue|reopen|defer-external>
```

Validate it with:

```console
npm run research:validate -- --file <file> --surface <surface> --artifact <raw-id>
```

The evidence must use a `raw:` artifact id. Malformed, off-scope, non-raw, or
unvalidated output is incomplete. Close the pass once and defer; never replace
solely because it timed out or returned a malformed report. One replacement is
allowed only for an explicit pre-dispatch failure where the pass never started
and the research budget remains.

Every source query that contacts GitHub, npm, a web provider, or another
external authority follows the base auth, approval, context, and failure
routing rules. A source pass cannot grant itself provider access or repair a
context failure.

## Claim and counter-evidence loop

Keep one ledger row per material claim: id, exact wording, claim class, source
path/query, authority/scope, date, revision/release, bounded excerpt/digest,
freshness trigger, strongest counter-case, decision consequence, and owner.
Separate fact, inference, recommendation, unknown, and external dependency.

Attack the strongest point of every conclusion: source disagreement, alternate
interpretation, competing project, metric confounder, misuse by a reasonable
reader, authority, freshness, scope, independence, and query completeness.
When a gap persists, move through:

```text
source → interpretation → claim boundary → product strategy → external decision
```

Narrow or mark unknown rather than repeating the same search or patching prose.

## Replay and final independent review

Replay the conclusion from the frozen source set against the current revision or
public state. Refresh time-sensitive facts in a new round. Before promotion,
run the base worker-readiness canary and dispatch a base-governed final reviewer
with one primary raw artifact by default, the LUNA MAX profile
(`model=gpt-5.6-luna`, `reasoning_effort=max`), `fork_context=false`, exact
`REVIEWER_REPORT_V1`, watchdog close/dispatch gates, and structured
`reviewerReadiness` close proof. Source-pass reports cannot satisfy this gate.

The final reviewer must be able to reject the conclusion. A timeout, partial or
off-scope report, unavailable pass, or unconfirmed close is `defer-external`,
not self-review. A material repair, revision, scope, source set, or action
boundary change starts a new review epoch.

## Report, handoff, and promotion

The final report separates claims and status, counter-case, freshness, unknowns,
limitations, and one safe next action. The handoff returns exactly one outcome:
`promote`, `reopen`, or `defer-external`; it records source lineage, claim ids,
surface ownership, reviewer readiness, findings, strongest falsifier, authority
gap, action boundary, and the exact validated final reviewer report with
substantive-agent close evidence. Completed source assignments carry their
validated `RESEARCH_PASS_V1` report. It never grants readiness, release,
publication, or adoption authority.

Promote only when no unresolved material claim can change the decision, the
strongest counterarguments are answered or narrowed, unknowns are visible, and
the action boundary is safe. If the method itself changes, freeze it and replay
the old and candidate methods against an external-program/adoption question, a
competitor/technical-landscape question, a repository work slice, and the
process-change task. Keep the simpler method when no material improvement is
shown.
