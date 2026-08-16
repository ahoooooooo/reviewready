# Open-source upgrade lifecycle

This is ReviewReady's project-level orchestration process. It connects the
[adversarial delivery loop](ai-development.md), the
[deep research method](research/deep-research-process.md), the fixed
[post-v1 node plan](exec-plans/active/post-v1.md), and the
[release process](releasing.md) into one repeatable upgrade cycle.

The adversarial delivery loop is the prerequisite engine. This lifecycle is a
dependent orchestration layer and remains a candidate until the base process
has completed its own attack, replay, and promotion gate.

It is an operating model, not a form, issue template, scorecard, or substitute
for a product contract. It does not change readiness semantics or grant an LLM
authority. It does not execute pull-request code or replace GitHub's authority,
and it does not turn a research conclusion into a release permission. The
current node order and individual release rules remain authoritative in their
existing documents.

## What the lifecycle optimizes

An upgrade is valuable only when it improves the project at its actual trust
boundary and leaves a reproducible proof path. The lifecycle therefore
optimizes for, in order:

1. deterministic safety and compatibility;
2. useful progress on the current node rather than attractive scope growth;
3. evidence that an independent reader can reproduce;
4. low coordination waste and bounded external operations; and
5. a public release and adoption story that says no more than the evidence
   supports.

It treats a feature, a design decision, a security boundary, a release parity
gap, and an adoption experiment as different kinds of work. They can share the
same loop, but they must not be accepted by the same proof.

## The cycle

```text
freeze reality
    ↓
frame one outcome
    ↓
research and attack in batches
    ↓
shape the smallest ordered work slices
    ↓
design the contract when the boundary requires it
    ↓
repair in disjoint slices
    ↓
prove and independently attack
    ├─ material gap → return to research/attack with the failed attempt
    └─ no material gap → promote the candidate
                         ↓
                 integrate and reconcile
                         ↓
                 release parity, if authorized
                         ↓
                 dogfood, adoption evidence, and re-baseline
```

The arrows describe control flow, not a promise that every cycle publishes a
package. A cycle can end with a locally proven change, a design-only decision,
an honest external-evidence gap, or a public release. It cannot silently
upgrade one kind of evidence into another.

## 1. Freeze reality before deciding what to improve

Start from one trusted repository revision and one observed project state. Read
the applicable instructions, product and architecture contracts, active node
plan, relevant issues, tests, release coordinates, and existing evidence.
Record the public and external state that matters to the decision, including
its observation time and limitations. Authentication may be checked without
exposing credentials; a failed login is an external dependency, not a product
fact.

The baseline includes the current node, worktree, source and generated
artifacts, public package and Action coordinates, open-work classification, and
any settings or provider state that the proposed work relies on. Do not mix a
new observation into an old conclusion. If the repository or public state
moves materially, start a new round from the new revision.

This phase is read-only. Its purpose is to prevent a clean local fixture, an old
release, or an unverified platform setting from becoming the premise of the
next upgrade.

## 2. Frame one observable outcome

Choose the existing post-v1 node or successor issue that owns the outcome. State
what must become observably different, which trust boundary it crosses, what
is deliberately out of scope, and what evidence would allow promotion. Keep
one issue and pull request focused on one outcome; use dependencies to express
order instead of combining unrelated work into a large milestone.

The outcome may be implementation, design, evidence, or an external authority
action. Naming that kind up front prevents a passing unit test from being
mistaken for live governance, and prevents a release task from being used to
hide an unfinished contract.

## 3. Research and attack before repairing the narrative

Use the deep research method when the decision depends on external facts,
competing designs, eligibility, ecosystem importance, adoption, or strategy.
Use the base adversarial loop for repository behavior, security, compatibility,
authority, operations, and evidence. These are two views of the same rule:
challenge independent surfaces first, then repair the synthesized result.

For an open-source upgrade, a meaningful batch normally tests the following
angles when they can change the decision:

- product contract and trust-boundary correctness;
- hostile, malformed, stale, ambiguous, and oversized input;
- authority, provenance, revision binding, and external enforcement;
- compatibility, package surface, generated artifacts, and public schemas;
- release, CI ordering, credentials, cost, and operational failure;
- adjacent projects, differentiation, maintenance, and realistic adoption; and
- the strongest argument that the proposed upgrade is unnecessary or unsafe.

Research uses primary sources first, preserves conflicts and dates, and
separates observation, inference, recommendation, unknown, and external
dependency. A collection of links or agreeing agents is not depth. Stop the
attack batch when each meaningful independent surface was challenged or shown
not to affect the decision, not when an arbitrary number of searches or agents
has run.

## 4. Shape evidence into executable work

The integrator synthesizes the batch into a small dependency-ordered set of
work slices. Duplicates are removed; impact and uncertainty are separated; and
each finding is classified as a product defect, design gap, process defect,
environment failure, evidence gap, or external dependency.

A usable work slice answers, in plain language, four questions: what outcome
changes, why it matters at the trust boundary, what smallest repair could make
it true, and what proof could falsify that repair. If those answers cannot be
given, the work is still in research or design and should not be disguised as
an implementation task.

The slice order follows the current node plan. Design precedes implementation
when authority, public schema, identity, migration, or threat-model decisions
are unresolved. Independent slices may proceed in parallel; dependent slices
wait for the contract or evidence they consume. Do not create a later-node
feature merely because it makes the current progress look larger.

## 5. Pass a design gate where the boundary changes

Not every change needs an ADR. A design gate is required when the work changes
authority, trust roots, public JSON, identity or provenance, persistence,
workflow execution, security capabilities, migrations, or release semantics.
The gate produces the smallest durable contract that makes implementation
falsifiable: the threat model, invariants, compatibility rule, bounded limits,
fixtures, and explicit non-goals.

The gate is complete when an independent reader can identify an input that would
fail the design, reproduce the acceptance fixtures, and see which evidence is
still external. Closing a design issue does not claim that its implementation,
deployment, or adoption exists. If the design cannot satisfy the original
boundary, move up the resolution ladder to a narrower contract, a different
architecture, or an explicit external dependency.

## 6. Repair in batches, then prove each slice

After the attack batch is synthesized, repair disjoint slices at their smallest
safe boundaries. A bug starts with a failing regression test. A contract or
research gap starts with a falsifiable example, counterexample, or stronger
source. Preserve failed attempts so the next round changes its hypothesis
instead of repeating the same patch.

The integrator owns the change set and its scope. Parallel agents are used only
for genuinely independent attack or review surfaces; no agent gives the final
review of its own patch, and idle or overlapping work is closed after its
evidence is delivered. A batch of findings is repaired before the next review
round when the surface is bounded; alternating one finding and one patch is
reserved for a real dependency that makes batching unsafe.

The implementation must preserve the project invariants: deterministic
readiness, base-revision policy loading, no trusted execution of pull-request
code, untrusted external inputs, bounded API work, fail-closed uncertainty, and
public contract compatibility. When the work is documentation or research,
the same discipline applies to claims and links rather than being replaced by
formatting polish.

## 7. Prove the candidate against the exact target

Proof is layered to match the outcome:

- focused regressions and adversarial boundary cases for behavior;
- full type, lint, format, coverage, package, and artifact checks;
- compatibility and schema checks for public surfaces;
- exact source-to-`dist`, CLI, Action, and package parity where applicable;
- revision-bound live observations for settings or provider behavior; and
- an independent adversarial review from a separate reasoning path.

For this repository, the local handoff is explicit: run the focused validation
first, then `npm run check`, then `git diff --check`, and inspect any generated
or public artifacts included in the candidate. A green focused test alone never
promotes a change.

Prerequisite results settle before dependent results are interpreted. A stale,
superseded, incomplete, race-affected, oversized, or ambiguous result cannot
decide the gate. Review is a rejection opportunity, not a request for another
agent to approve the author's explanation.

If a material gap is found, return to the research/attack phase with the failed
attempt and repair batch intact. Do not patch findings one at a time merely to
appear active, and do not close a gap by renaming it, lowering the standard, or
pointing at a different revision. Promotion requires no unresolved material
in-scope issue and evidence that describes the current exact attempt.

## 8. Integrate through two Git lanes

Routine repository work uses the authorized branch lane: commit the coherent
slice, push the feature branch, and keep its PR or draft PR current after local
proof. This avoids repeated approval for ordinary repository mutations.

The promotion lane is separate. Protected-branch merges, tag movement,
publication, ruleset changes, deployment, credentials, and secrets are named
high-impact batches. They begin only after internal proof and one explicit
authorization for that named batch. Verification and retry-safe reads inside
that batch do not need repeated prompts, but GitHub environment reviewers,
two-factor authentication, and provider controls remain real external gates.

The trusted workflow is part of the proof: it must use the exact candidate
revision, cancel superseded work, wait within a bounded budget for the expected
provider and exact check identity, and fail closed when evidence is missing or
pending. A green untrusted pull-request job cannot be promoted into trusted
authority by wording alone.

## 9. Publish only after public parity is proven

A promotable candidate is not automatically a published release. When a release
is in scope, use one canonical commit and one exact audited artifact. Reconcile
source, package and lock versions, npm tarball and provenance, schemas, README,
Action bundle and reference, semantic-version tag, GitHub Release, stable tag,
Marketplace state, changelog, and release evidence according to
[`docs/releasing.md`](releasing.md).

If a public coordinate or external protection cannot be verified, keep the
result explicitly ready-but-unreleased or incomplete. Do not create a second
artifact after auditing the first, reuse an immutable version, or call a local
fixture production authority. A release is complete only when the public
coordinates point to the same verified revision and the evidence records what
was not available.

## 10. Dogfood, adoption, and feedback are separate evidence

Run ReviewReady against its own repository when that proves a reproducible
maintainer workflow. Label the result self-dogfood. An external pilot requires
the maintainer's consent and should record only sanitized, reproducible facts:
version, policy class, event type, result, false positives or negatives,
limitations, and removal path.

Stars, downloads, issue counts, testimonials, and self-use answer different
questions. None may be substituted for technical proof or described as broad
adoption without evidence. A missing external pilot does not block safe local
engineering; it remains a visible evidence gap and a future experiment.

Feed failures, false positives, operational friction, and new external facts
into the next attack batch. Do not rewrite historical evidence to make the
latest story cleaner.

## 11. Close the cycle by re-baselining

After promotion or an honest stop, reconcile the issue, PR, active plan,
architecture or ADR, research index, README, changelog, release evidence, and
public coordinates that were actually affected. Preserve the decision, failed
attempts, remaining external dependencies, and the exact revision used for
proof. Then choose the next node from the post-v1 plan and freeze a new
baseline.

The cycle is complete when another credible finding would not change the
decision within scope, or when the only remaining action belongs to a named
external authority. “No more internal work” is not the same as “released,”
“adopted,” or “production-authoritative.” Those claims require their own
evidence tier.

## Cost and process optimization

Reasoning effort follows consequence and novelty. Use the ordinary path for
bounded implementation and routine coverage; reserve the deepest independent
attack for trust-root, public-contract, migration, release, and other decisions
whose failure would invalidate many downstream results. Do not hard-code a
model name in the repository or treat model agreement as authority.

When the lifecycle itself is being improved, freeze this version, replay it
against completed work, and attack missed risks, repeated coordination,
premature stops, stale evidence, and unnecessary external mutations. Promote a
new process only when the replay shows better safety, evidence quality, or
throughput without weakening scope control. If the result is equivalent, keep
the simpler process; cosmetic changes are not an upgrade.

## Canonical source map

- [`docs/ai-development.md`](ai-development.md) — base adversarial loop, agent
  discipline, and Git promotion protocol.
- [`docs/research/deep-research-process.md`](research/deep-research-process.md)
  — source-backed research and counter-evidence loop.
- [`docs/exec-plans/active/post-v1.md`](exec-plans/active/post-v1.md) — current
  node order, issue ownership, invariants, and promotion gates.
- [`docs/architecture.md`](architecture.md) — trust boundaries and module
  responsibilities.
- [`docs/releasing.md`](releasing.md) — exact release and artifact parity
  procedure.
- [`docs/research/open-source-landscape-and-reward-upgrade.md`](research/open-source-landscape-and-reward-upgrade.md)
  — current landscape, differentiation, and public-proof priorities.
- [`docs/research/openai-oss-reward-strategy.md`](research/openai-oss-reward-strategy.md)
  — reward-application evidence limits and honest adoption language.

If these documents disagree, the product and architecture contracts govern
behavior, the active execution plan governs node order, and the release process
governs publication. This document only defines how work moves between them.
