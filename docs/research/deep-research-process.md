# Deep research process

This is the research method for ReviewReady's product, security, market, and
open-source strategy questions. It is an abstract reasoning loop, not a form,
field checklist, or claim that a polished document is correct.

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
Frame the decision
    ↓
Map the source topology
    ↓
Attack the question from independent angles
    ↓
Synthesize observations into claims
    ↓
Search for counter-evidence and alternate explanations
    ↓
Resolve or move up the abstraction ladder
    ↓
Replay and independently review
    ├─ material gap → return to attack with the failed attempt
    └─ no material gap → promote the conclusion
```

### Frame the decision

Begin with the decision the research must support, not with a request to
collect information. Fix the scope, time boundary, trusted revision, relevant
non-goals, and the kind of action the result may authorize. Freeze that frame
for the round; changing the question to make the evidence look better is a
research failure. Research is read-only until its conclusion passes promotion;
publication, repository mutation, and other external writes are separate
actions.

### Map the source topology

Start with primary and authoritative sources: official program rules, project
contracts, exact repository revisions, public APIs, and the original project
documentation. Use secondary material to discover hypotheses or context, not
to upgrade an unsupported claim into fact.

Sources have different authority, freshness, and scope. A claim is not ready
for synthesis until its path to the relevant source and date is clear. If
sources conflict, preserve the conflict and investigate it; do not average the
claims or choose the more attractive wording. External metrics, testimonials,
metadata, and adoption signals remain untrusted observations until their
meaning and limitations are established. Ten copies of one assertion are not
ten independent sources; independence comes from separate authority or an
independent observation.

### Attack the question in batches

Research agents or passes attack genuinely independent surfaces before the
integrator repairs the narrative. Depending on the question, the surfaces may
include official eligibility, technical behavior, security and trust, direct
competitors, adoption and maintenance, release operations, cost, and the
strongest argument against the project.

The batch must be broad enough to expose a material alternative explanation.
It is not complete because a number of searches or agents ran; it is complete
when the meaningful independent surfaces were challenged or evidence showed
that a surface cannot change the decision. Never patch a weak conclusion as
soon as the first source disagrees with it. The inquiry remains bounded by the
decision: once new independent evidence no longer changes the claim map or
reveals a material attack, more sources are repetition rather than depth.

### Synthesize observations into claims

The integrator separates three kinds of statements: what the evidence directly
shows, what follows as an inference, and what is recommended. Findings are
deduplicated and connected by cause rather than counted as votes. A model's
agreement, a majority of agents, and a visually persuasive report are not
evidence.

The synthesis also separates a product problem, a research-method problem, an
environment failure, an evidence gap, and an external dependency. This prevents
permission failures, stale data, and CI ordering races from being misdiagnosed
as product facts.

### Search for counter-evidence

Every material conclusion is attacked at its strongest point. The review asks
what would falsify it, which source would disagree, whether a competitor solves
the same problem under a different name, whether the metric has another
explanation, and whether a reasonable reader could misuse the conclusion.

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

### Replay and independent review

The conclusion is replayed from the frozen source set and compared with the
current revision or current public state. Time-sensitive facts are refreshed;
historical snapshots are not silently presented as current. An independent
review uses a separate reasoning path or fresh context and must be able to
reject the conclusion. It does not require a different model identity, a human
review claim that cannot be verified, or an LLM verdict as authority.

For research, proof is traceable sources, reproducible queries, explicit dates,
counter-evidence, and a stable reasoning path. For implementation, the same
stage also includes regression tests, compatibility checks, and artifact
verification. The evidence standard changes with the work; the adversarial
loop does not.

## Promotion and stopping

Promote a research conclusion only when no unresolved material claim can change
the decision, the strongest counterarguments have been answered or explicitly
narrowed, and all remaining unknowns are visible. Recommendations must follow
from the evidence and must distinguish technical improvements from external
adoption or authority that has not been proven.

If review finds a material gap, return to the attack phase with the failed
attempt preserved. Do not call the work complete because the report is long,
the sources look credible, or the first recommendation is plausible. Stop only
when another credible finding would not change the decision, or when the exact
remaining action belongs to an external authority. Cosmetic wording is not a
reason to keep iterating.

## Agent and model discipline

The integrator owns scope, synthesis, and promotion. Use the smallest team
that exposes independent surfaces; add parallel work only when it reduces blind
spots rather than multiplying summaries. Close overlapping or idle work after
its evidence is delivered. No agent reviews its own argument as the final
decision.

There is no stronger-model escape hatch in this process. Continue with the
available reasoning path, change perspectives, and require evidence. Model
output remains advisory; deterministic project contracts and external primary
sources remain authoritative.

## Self-optimization of the research method

When the research method itself is the target, freeze its current version and
replay it against completed research questions, including this reward-strategy
study and the remaining work-order planning. Attack the method for missed
sources, repeated effort, premature closure, unsupported certainty, stale
evidence, poor handoff, and recommendations that cannot become action.

Batch the findings, create a materially different process candidate, and replay
the same questions while the old method remains unchanged. Promote the new
method only if it improves decision quality or reduces wasted effort without
weakening evidence, safety, or scope. If candidates are equivalent, keep the
simpler one. When remaining changes are cosmetic, the method has reached its
current practical limit and research can return to the product decision.
