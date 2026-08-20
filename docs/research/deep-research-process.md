# Deep research process

This is the research method for ReviewReady's product, security, market, and
open-source strategy questions. It is an abstract reasoning loop, not a form,
field checklist, or claim that a polished document is correct.

It is the research lane of the project-wide
[open-source upgrade lifecycle](../oss-upgrade-process.md). It produces claims,
counter-evidence, and decision boundaries for the lifecycle; it does not decide
readiness, implementation completion, publication, or adoption by itself.

The base adversarial process is its prerequisite. When this research method is
being changed, the current method is the frozen baseline and every downstream
research report or work-order plan remains a candidate until the method passes
its own replay and promotion gate.

The base skill and `AGENTS.md` have precedence when rules overlap. This research
method may add source lineage and claim requirements, but it may not loosen
base worker admission, packet size, timeout, close-agent, retry, report-shape,
or promotion rules.

The root [canonical agent handoff](../../HANDOFF.md) is the live project state
for the current research round. It is separate from each `RESEARCH_PASS_V1`
source handoff and from the final independent-review JSON. Refresh and validate
it after every source, attack, repair, or authority boundary so a new agent can
resume without guessing which research document is current.

## Shared round protocol

Deep research is a specialization of the base round, not a second lifecycle.
The same decision record, routing rule, evidence tiers, and promotion boundary
apply to both lanes:

| Base round stage      | Research specialization                                                                                  | Required handoff                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Anchor and frame      | Freeze the falsifiable question, source state, time boundary, revision, and non-goals.                   | One decision with a freshness boundary.                                                 |
| Attack and synthesize | Map sources, challenge independent surfaces, and build the claim/defect ledger.                          | Claims separated into fact, inference, recommendation, unknown, or external dependency. |
| Resolve or repair     | Strengthen a source, narrow a claim, change strategy, or hand off a bounded implementation/design slice. | One falsifier, owner, acceptance condition, and no implied permission to publish.       |
| Prove and review      | Replay sources, refresh time-sensitive facts, and let an independent path reject the conclusion.         | A structured promote, reopen, or defer-external verdict.                                |
| Promote and re-anchor | Preserve the snapshot and decision boundary, then start a new round when the source state moves.         | Exact next authority or work-order boundary.                                            |

The research lane may add source and claim detail, but it must not duplicate the
base baseline, scope, or promotion record. A routine local task does not need a
full research round; a trust, release, adoption, or novel external claim does.

### Prompt admission for deep research

Deep research is an overlay on the base loop, not an alternative
to it. Enter this lane when the user's requested decision depends on facts
outside the trusted checkout or on a claim whose meaning can change with time.
This includes requests to search or verify current state, compare competitors,
assess adoption, eligibility, market or strategy, evaluate external authority,
or recommend a direction whose evidence is not already frozen locally.
“Understand the current project status” and “try to optimize the process” also
require an explicit baseline and research/process replay; they are not routine
documentation tasks.

Do not enter deep research for a bounded local implementation whose behavior,
acceptance examples, and proof sources are already known. That task still uses
the full base process with local evidence only and is upgraded if the prompt
reveals a new trust, public, current-state, or external-dependency claim. If
admission is ambiguous, keep the base contract and add this overlay only when
the unresolved current/external claim could change the decision.

For a planning-only request, return only the route, falsifiable decision, source
classes, strongest counter-case, bounded budget, and stop condition. Do not load
the execution reference, search providers, spawn source agents, or perform
external operations until research execution is explicitly authorized. A later
execution request starts a new round. If the research method itself is the
target, the base process-self-optimization reviewer gate overrides this
planning-only no-agent branch.

## What the process must accomplish

Deep research is complete only when it can support a decision, explain the
strongest contrary case, and show which parts are facts, inferences, unknowns,
or external dependencies. A long source list is not depth. Depth comes from
independent evidence, adversarial interpretation, and the ability to reproduce
the path from evidence to decision.

The research result and the research process are separate. A good report does
not prove that the method which produced it was complete; the method must be
tested by replaying it against real past questions.

## The research loop

```text
Anchor the research baseline and frame the decision
    ↓
Map the source topology
    ↓
Admit worker and source-pass packets
    ↓
Attack the question from independent angles
    ↓
Build a claim map and action boundary
    ↓
Search for counter-evidence and alternate explanations
    ↓
Resolve or move up the abstraction ladder
    ↓
 Replay, refresh, and base-governed independent review
    ├─ material gap → return to attack with the failed attempt
    └─ no material gap → promote the conclusion and hand off the decision
```

Every round has two frozen boundaries: the question it is allowed to answer and
the source state from which it may answer it. A later source observation starts
a new round; it must not silently rewrite the evidence for an earlier one.

### Anchor and frame the decision

Begin with the decision the research must support, not with a request to
collect information. Freeze the scope, time boundary, trusted repository or
public revision, relevant non-goals, downstream dependency, and kind of action
the result may authorize. The question must be falsifiable: a credible finding
must be able to narrow, reverse, or defer the decision.

Research is read-only until its conclusion passes promotion. Publication,
repository mutation, work-order creation, and other external writes are
separate actions. If the method or one of its prerequisites is being changed,
the downstream conclusion is a candidate and cannot certify the method that it
depends on.

### Map the source topology

Start with primary and authoritative sources: official program rules, project
contracts, exact repository revisions, public APIs, and the original project
documentation. Use secondary material to discover hypotheses or context, not
to upgrade an unsupported claim into fact.

Sources have different authority, freshness, and scope. A claim is not ready
for synthesis until its shortest reproducible path to the relevant source and
date is clear. For a material time-sensitive claim, preserve the stable URL or
API query, repository revision or release, observation date, and enough bounded
content or digest to detect drift. A mutable page that cannot be replayed is a
time-bound observation, not timeless fact; refresh it in a new round.

If sources conflict, preserve the conflict and investigate it; do not average
the claims or choose the more attractive wording. External metrics,
testimonials, metadata, and adoption signals remain untrusted observations
until their meaning and limitations are established. Ten copies of one
assertion are not ten independent sources; independence comes from separate
authority or an independent observation. Source collection itself is bounded
by request, response, query, and time limits; an unbounded search cannot create
authority. If a prior report lacks replay metadata, do not reconstruct or
backfill it as if it were captured evidence: downgrade the claim to a historical
observation or unknown and hand off a bounded refresh action.

### Claim-source ledger

For every material claim, keep one compact ledger row containing a claim ID,
the exact wording, claim class, source path or query, authority and scope,
observation date, revision or release, bounded excerpt or digest when needed,
freshness or refresh trigger, strongest counter-case, decision consequence, and
current action owner. A source may support several claims, but each claim must
have its own shortest reproducible path. This makes stale research visible
without requiring a new document for every round.

### Attack the question in batches

Research agents or passes attack genuinely independent surfaces before the
integrator repairs the narrative. Depending on the question, the surfaces may
include official eligibility, technical behavior, security and trust, direct
competitors, adoption and maintenance, release operations, cost, and the
strongest argument against the project.

The integrator converts these into a surface matrix. Start with two
raw-artifact-only passes for a multi-source decision: authority/primary-source
and counter-evidence/alternative. Add one pass per additional material surface,
up to four source agents total and two active agents at once. Each assignment
records its owned and excluded surfaces, artifact ids, falsifier, initial
observation window, and review epoch. Sibling reports and the integrator claim
map are not passed into a new assignment.

This four-pass/two-active cap applies only to evidence-collection source passes.
The final independent reviewer is a separate base-governed assignment, and the
worker canary does not count toward either cap. Any source query that contacts
an external provider still follows the base auth, approval, context, and failure
routing rules.

Before the first source pass, satisfy the base control-plane and worker-readiness
canaries. Each source pass uses one named surface and one primary raw artifact
by default, with one falsifier, one question, and explicit exclusions. A larger
source set is split into disjoint passes rather than given to one agent.
Use `createResearchPassWatchdog` for each admitted pass so malformed/off-scope
output, host-confirmed timeout, and tool failure become closeable terminal
outcomes before any `RESEARCH_PASS_V1` claims enter the integrator map. A silent
observation-window expiry leaves the pass running and cannot be promoted yet.

Require this bounded source-pass handoff:

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

Malformed, off-scope, or non-raw evidence is incomplete. Close the pass once
and defer the round rather than replacing it merely to obtain a better report.
Validate the pass with `npm run research:validate -- --file <file> --surface
<surface> --artifact <raw-id>` before adding its claims to the map.

Deep-research handoffs mark source artifacts with the raw: prefix and preserve
source lineage and claim ids. Derived claim maps, sibling summaries, and
recommendations cannot be used as raw evidence.

The batch must be broad enough to expose a material alternative explanation.
It is not complete because a number of searches or agents ran; it is complete
when the meaningful independent surfaces were challenged or evidence showed
that a surface cannot change the decision. Each parallel pass receives one
distinct surface and returns evidence plus its strongest unresolved objection;
it does not write the final narrative. Close overlapping or idle work after
the handoff, and do not let more agents substitute for a missing source.

Never patch a weak conclusion as soon as the first source disagrees with it.
The inquiry remains bounded by the decision: once new independent evidence no
longer changes the claim map or reveals a material attack, more sources are
repetition rather than depth.

### Build a claim map and action boundary

The integrator builds a claim map: what the evidence directly shows, what
follows as an inference, what is recommended, what remains unknown, and what
belongs to an external dependency. Each material claim is connected to its
source path, decision consequence, and a way it could be falsified. Findings
are deduplicated and connected by cause rather than counted as votes. A model's
agreement, a majority of agents, and a visually persuasive report are not
evidence.

The action boundary is explicit. A claim may hand off to a design decision,
an implementation slice, an evidence-collection task, a bounded experiment, or
no action. A recommendation that cannot be made falsifiable or assigned to a
safe next action remains research, not a completed upgrade plan.

The synthesis also separates a product problem, a research-method problem, an
environment failure, an evidence gap, and an external dependency. This prevents
permission failures, stale data, and CI ordering races from being misdiagnosed
as product facts.

### Search for counter-evidence

Every material conclusion is attacked at its strongest point. The review asks
what would falsify it, which source would disagree, whether a competitor solves
the same problem under a different name, whether the metric has another
explanation, and whether a reasonable reader could misuse the conclusion.

The attack also tests the evidence itself: authority, freshness, scope,
independence, query completeness, and whether the source actually supports the
wording. A source that is real but out of scope cannot rescue a claim.

For the ReviewReady reward question, this means actively testing claims about
eligibility, differentiation, importance, adoption, maintainer credibility,
production authority, and cost. The process must be willing to narrow or
remove a claim, not merely add supporting prose.

### Resolve through changing abstraction levels

When a finding cannot be resolved, do not repeat the same search or patch the
same sentence. Move through the resolution ladder:

```text
source → interpretation → claim boundary → product strategy → external decision
```

A stronger source may resolve a source problem. A narrower claim may resolve an
interpretation problem. A changed scope may resolve a strategy problem. If the
last level still requires permission, consent, current platform state, or a
maintainer decision, isolate that dependency precisely. The process continues
through all safe internal alternatives before reporting it as external.

### Replay, refresh, and independent review

The conclusion is replayed from the frozen source set and compared with the
current revision or current public state. Time-sensitive facts are refreshed in
a new bounded round; historical snapshots are not silently presented as
current. The replay must answer whether the claim map, strongest counter-case,
and action boundary still hold, not merely whether the prose is unchanged.

An independent review uses a separate reasoning path or fresh context and must
be able to reject the conclusion. Dispatch it with fork_context=false after the
contradiction/citation audit and source replay, using only the frozen decision,
raw artifacts, source lineage, claim ids, and action-boundary question. It does
not require a different model identity, a human review claim that cannot be
verified, or an LLM verdict as authority. If the research method itself is the
target, replay the frozen method and its candidate separately; the candidate
cannot approve its own prerequisite. A timeout or unavailable reviewer is
defer-external, not self-review.

The final independent reviewer still uses the base worker-readiness canary,
one-primary-artifact packet by default, exact `REVIEWER_REPORT_V1` output, the
LUNA MAX reviewer profile (`model=gpt-5.6-luna`, `reasoning_effort=max`),
reviewer watchdog, and—only after a recorded 120-second LUNA MAX timeout—the
explicit `luna-max-long-read` 300-second paired profile; structured host-close proof
(`source`, `agentId`, `previousStatus`, `closed`), and `reviewerReadiness` handoff
evidence. Source-pass reports cannot satisfy the final reviewer gate.

The independent handoff must return one of three outcomes: **promote**,
**reopen**, or **defer-external**. A complete final reviewer assignment carries
the exact validated `REVIEWER_REPORT_V1` and substantive-agent close evidence;
completed source assignments carry their validated `RESEARCH_PASS_V1`. It must
name the strongest remaining objection, the claim or source it affects, and the
next falsifiable action. “Looks good” is not a research verdict.

For research, proof is traceable sources, reproducible queries, explicit dates,
counter-evidence, and a stable reasoning path. For implementation, the same
stage also includes regression tests, compatibility checks, and artifact
verification. The evidence standard changes with the work; the adversarial
loop does not.

## Promotion and stopping

Promote a research conclusion only when no unresolved material claim can change
the decision, the strongest counterarguments have been answered or explicitly
narrowed, all remaining unknowns are visible, and the action boundary is safe
and explicit. Recommendations must follow from the evidence and must
distinguish technical improvements from external adoption or authority that has
not been proven. Promotion hands off a decision boundary, not a readiness
verdict or an automatic implementation or release permission.

If review finds a material gap, return to the attack phase with the failed
attempt preserved. Do not call the work complete because the report is long,
the sources look credible, or the first recommendation is plausible. Stop only
when another credible finding would not change the decision, or when the exact
remaining action belongs to an external authority. Cosmetic wording is not a
reason to keep iterating.

## Agent and model discipline

The integrator owns scope, synthesis, and promotion. Use the bounded surface
matrix and smallest team that exposes independent surfaces; add parallel work
only when it reduces blind spots rather than multiplying summaries. A
host-confirmed timeout, malformed pass, or unavailable source remains terminal
and deferred; a silent observation expiry remains running as `observing`; only an
explicit pre-dispatch failure where the pass never started may use one
replacement inside the same research budget. Deduplicate by claim id and
canonical source/query/revision lineage. Each pass has one independent surface
and one evidence handoff; the integrator owns the claim map and final promotion.
Close overlapping or idle work after the evidence is delivered. No agent
reviews its own argument as the final decision.

There is no stronger-model escape hatch in this process. Continue with the
available reasoning path, change perspectives, and require evidence. Model
output remains advisory; deterministic project contracts and external primary
sources remain authoritative.

## Self-optimization of the research method

When the research method itself is the target, freeze its current version at an
immutable revision or isolated branch and replay it against completed research
questions, including this reward-strategy study and the remaining work-order
planning. Downstream reports remain candidates until the method is promoted.
Attack the method for missed sources, repeated effort, premature closure,
unsupported certainty, stale evidence, poor handoff, and recommendations that
cannot become action.

The replay must cover at least the same four materially different questions:
an external-program or adoption question, a competitor or technical-landscape
question, a repository decision that must become an executable work slice, and
the process change itself. For each case, compare missed sources, unsupported
certainty, stale-claim detection, counter-case coverage, handoff completeness,
duplicated effort, and whether the action boundary stayed safe. Batch the
findings, create a materially different process candidate, and replay the same
questions while the old method remains unchanged. Promote the new method only
if it improves decision quality, stale-evidence detection, or coordination and
does not weaken authority, evidence, safety, or scope control. If candidates are
equivalent, keep the simpler one. When remaining changes are cosmetic, the
method has reached its current practical limit and research can return to the
product decision.
