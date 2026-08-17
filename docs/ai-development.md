# AI-assisted development policy

ReviewReady is built with coding agents, but evidence—not authorship—decides whether
a change is acceptable.

The repository's own `.reviewready.yml` is an explicit automation policy. It
requires visible change evidence and deterministic checks, but intentionally
does not require `human_attestation`: a checkbox in PR text cannot authenticate
the actor, prove comprehension, or create legal responsibility. This local
choice does not change the v1 schema capability, replace independent review for
high-risk changes, or authorize an LLM to decide readiness, approve, or merge.

## Bootstrap, then evolve

The repository starts with the smallest useful Codex setup:

- a short `AGENTS.md` that maps sources of truth and states hard boundaries;
- a project-local workspace permission profile;
- versioned product, architecture, and execution-plan documents;
- one complete validation command.

Settings grow only in response to observed failures:

- repeated wrong assumptions become focused `AGENTS.md` guidance;
- repeated deterministic mistakes become tests, types, linters, or hooks;
- a repeated multi-step workflow becomes a repo skill;
- external live data earns an MCP integration only when local tools cannot provide it.

Do not pin a model or reasoning setting in repository configuration. Model choices
change faster than the product contract and belong to the operator unless a measured
compatibility problem requires a temporary project constraint.

## Shared round contract and routing

The base loop and the deep-research lane use one compact decision record. It is not
an additional approval form or a new authority; for a routine change it may be a
short issue, pull-request, plan, or research-note entry. A non-trivial round records:

- **baseline**: the exact revision, worktree state, public or provider snapshot,
  observation time, and freshness or refresh trigger;
- **decision**: one observable outcome, work kind, trust boundary, non-goals, and
  prerequisites;
- **surface map**: which source, tests, generated files, package/public coordinates,
  or external settings may change, and which evidence tier each surface needs;
- **attack map**: independent attack surfaces, the strongest falsifier for each,
  bounded effort, and the condition that ends the attack batch;
- **claim/defect ledger**: each finding's status, evidence path, uncertainty, owner,
  and next action; and
- **proof and handoff**: focused proof, complete gate, artifact or external checks,
  acceptance condition, remaining authority, and the exact next decision.

### Prompt admission gate

Every user prompt enters the **full base adversarial loop**. This gate selects
additional evidence lanes; it is not permission to skip baseline, framing,
attack, proof, or promotion. The result is a set of overlays, not one shortcut
label:

1. **process self-optimization**: the prompt asks to change, optimize, compare,
   or route a workflow, prompt, skill, agent method, or repository rule;
2. **promotion**: the prompt asks to publish, commit, push, merge, tag, deploy,
   change settings or permissions, use credentials/secrets, or contact a
   provider with a state-changing operation;
3. **deep research**: the decision depends on current or external facts, search,
   competitors, adoption, market, eligibility, strategy, recommendations, or
   external authority;
4. **consequential scope**: the prompt involves security, trust, provenance,
   authority, release, package, workflow, Action, schema, public API,
   compatibility, migration, architecture, or multiple repository surfaces;
5. **routine scope**: only a bounded local task with a clear acceptance condition,
   no current/external fact, no trust or public-contract boundary, no process-rule
   change, and no destructive or external mutation. This changes only the
   evidence breadth, never the base-loop rigor.

Examples: “understand the whole project status” adds consequential scope;
“查最新” or “recommend a strategy” adds deep research; “optimize the
prompt/process” adds process self-optimization; “publish the package” adds
promotion. Multiple overlays may apply. If a prompt is ambiguous or a routine
condition cannot be proved, add the stronger overlay rather than defaulting to
routine. Record `base-full` plus every selected overlay and its prompt trigger
before proceeding.

Each stage updates the same record. Promotion is not allowed while the record lacks
the current revision and freshness, the strongest unresolved objection, the proof
that could falsify the result, the evidence tier supporting the claim, or the next
authority boundary. This prevents a polished handoff from silently dropping stale
data, a release surface, or an external dependency.

## Adversarial delivery loop

The base workflow is a loop, not a form or a field checklist. It applies to
implementation, design, research, and release work. The evidence used to prove
a result changes by task, but the reasoning loop remains the same. It has a
decision layer before a resolution layer so that implementation cannot outrun
the question it is meant to answer:

1. **Anchor the baseline.** Read the applicable instructions, product and
   architecture contracts, active node or issue, relevant tests and evidence,
   current worktree, and any public or external state that can affect the
   decision. Freeze one trusted revision and observation boundary for the
   round. Classify observations as local, live, externally enforced, public
   artifact, or adoption evidence; do not mix a later observation into an old
   conclusion. This phase is read-only. If the target moves materially, start a
   new round rather than comparing incompatible states.
2. **Frame one decision.** Define one observable outcome, its trust boundary,
   work kind (behavior, design, evidence, or external authority), non-goals,
   completion condition, proof target, and prerequisites. Connect it to one
   issue or pull request outcome and express ordering through dependencies. A
   passing test, a design decision, a live setting, and a published artifact
   are different outcomes and require different proof. If the workflow or one
   of its prerequisites is itself being changed, freeze dependent plans as
   candidates; a candidate process may run experiments, but it cannot become
   the authority that proves the process it depends on.
3. **Attack in batches.** Examine genuinely independent surfaces before
   selecting a repair: correctness, hostile input, authority and provenance,
   compatibility, operations, and evidence as applicable. For research, start
   with primary sources, preserve dates and conflicts, and attack the strongest
   contrary explanation. Do not alternate one discovery with one patch while
   an unexplored surface can still change the decision. A surface is covered
   when it was independently challenged or evidence shows it cannot affect the
   outcome; completion is not a count of searches, tests, or agents.
4. **Synthesize and order.** Remove duplicates, connect causes, rank impact and
   uncertainty, and separate product defects, design or process defects,
   environment failures, evidence gaps, and external dependencies. Preserve
   failed attempts and order the smallest repair slices by dependency. Choose
   by the strongest proof, not by vote; model agreement and polished prose are
   not evidence. If the decision is not yet falsifiable, keep it in research or
   design instead of creating an implementation-shaped task.
5. **Repair at the smallest safe boundary.** A bug starts with a failing
   regression test. A design or research gap starts with a falsifiable claim,
   counterexample, fixture, or stronger source. A design gate is required when
   authority, trust roots, public schema, identity, persistence, execution,
   migration, or release semantics change. Repair independent slices as a
   batch when safe; no agent reviews its own patch as the final review. When an
   approach fails, preserve what it disproved, change the hypothesis or move
   from input and data to algorithm and contract, architecture, scope, or
   external authority. Changing abstraction level is a solution attempt, not a
   reason to declare the work blocked.
6. **Prove and independently attack the current attempt.** Prove the exact
   target revision with focused regressions, hostile boundaries, compatibility,
   full quality gates, and generated or public artifact checks appropriate to
   the outcome. Add revision-bound live or external evidence only when the
   decision requires it. Prerequisites settle before dependent results are
   interpreted; stale, superseded, incomplete, oversized, contradictory, or
   race-affected results cannot decide a gate. A fresh reasoning path must be
   able to reject the repair on evidence, not merely approve its explanation.
7. **Promote, loop, and re-anchor.** Promote only when no unresolved material
   issue remains in scope, the evidence describes the current attempt, and the
   next authority boundary is explicit. If review finds a gap, return to the
   attack phase with the failed attempt and the new evidence. After promotion,
   reconcile the issue, plan, source, generated artifacts, and evidence, then
   freeze a new baseline. Internal proof does not by itself mean merged,
   published, adopted, or production-authoritative; external writes and
   publication remain separate promotion lanes. Promotion order follows the
   dependency graph: a foundational process is promoted before the plans and
   documents that depend on it are treated as authoritative.

For ReviewReady, these project invariants are non-negotiable throughout the
loop: readiness is deterministic; an LLM never decides readiness, approves, or
merges a pull request; effective policy comes from the immutable base revision;
trusted workflows never execute pull-request code; external metadata and API
responses are untrusted; all collection and matching work is bounded; unknown
or incomplete evidence fails closed; and public contracts remain compatible.

Fail-closed applies to the result, not to the effort: uncertain evidence may
not produce an accepting product decision, but the development loop continues
with new hypotheses and bounded alternatives. An external dependency is not an
automatic stop; safe alternatives are exhausted first, then the exact missing
authority or decision is isolated. Do not convert an unresolved result into a
pass by renaming it, lowering the standard, or hiding it behind stale evidence.

The integrator owns scope, synthesis, and promotion. Start with the smallest
team that can do the work and add an agent only for a genuinely independent
surface or an independent challenge. Before dispatch, each parallel task must
have a distinct attack surface and a concrete evidence handoff. No agent may
review its own patch or argument as the final review; overlapping or idle work
is closed after its evidence is delivered. A new round starts from the
accumulated evidence and failed attempts, never from an unexamined reset.

The loop ends only when another credible finding would not change the decision
within scope, or when the only remaining action belongs to a named external
authority. An unresolved result is not a pass, but an external dependency is
not a reason to abandon safe internal work. Isolate the missing authority and
continue every independent slice that does not depend on it.

## Process self-optimization

When the workflow itself is the target, freeze the current process as the
baseline at an immutable revision or isolated branch and apply the same loop to
it. Dependent plans remain candidates until the foundational process is
promoted; they may guide experiments but may not certify their own prerequisite.
Attack the process through real past tasks, looking for missed risks, repeated
work, premature stops, stale evidence, idle coordination, and unnecessary
external mutations. The replay must cover at least four materially different
cases: a local behavior or security task, including a trust or security change,
a release or public-artifact task, an external-authority or adoption decision,
and a research-to-work-order handoff.
Include the process-change task itself when the candidate changes this method.
For each case, compare the frozen method and candidate on missed attacks, stale
or unsupported claims, duplicated work, handoff completeness, unnecessary
external actions, and scope control. Batch those findings, design a materially
different process candidate, and replay the same cases against it while the old
process remains unchanged. Promote the new process only when the replay shows at
least one meaningful safety, evidence-quality, or coordination improvement and
no regression in authority, scope, or fail-closed behavior; one successful
replay is not proof that it is best. If the candidates are equivalent, keep the
simpler process. Once remaining changes are only cosmetic, keep the current
process and return to product work.

## Git promotion protocol

Repository work uses two explicit lanes so routine development does not wait on
the owner for every local mutation while high-impact external changes remain
deliberately gated.

The routine branch lane covers the already authorized task scope: inspect the
trusted checkout, edit repository files, run focused and complete validation,
create commits, push the current feature branch, and update its existing PR or
draft PR. The integrator may continue through those actions without requesting a
new approval for each commit or push. This lane never authorizes protected-branch
merges, tag movement, releases, package publication, ruleset changes, secrets,
credentials, or deployment.

The promotion lane begins only after the candidate has passed local proof and
the owner gives one explicit authorization for the named merge or release
batch. All verification, retry-safe reads, artifact checks, and public-coordinate
reconciliation inside that named batch proceed without repeated approval prompts.
GitHub environment reviewers, two-factor authentication, and other provider
controls remain external gates; an agent must not work around them or turn a
failed session into an implicit authorization.

The CI order is part of the proof rather than a timing assumption. Untrusted
pull-request CI may check out and test the proposed revision with read-only
permissions. The trusted metadata-only workflow then cancels superseded runs,
waits within a bounded budget for the latest `check` Check Run on the exact
pull-request head from the expected GitHub Actions provider, and only then runs
ReviewReady. Missing, oversized, incomplete, or still-pending check evidence
fails closed; it does not trigger an unbounded wait or silently accept a stale
result. If the bounded wait is exhausted because an external runner or provider
is unavailable, a new trusted event may still be required.

## Human accountability

The human product owner decides desired behavior, reviews visible outputs, interviews
maintainers, and accepts release risk. Agents may author all repository artifacts, but
must provide reproducible commands and test evidence. A passing generated test is not
enough when it only confirms the implementation; tests must trace back to an
independent product example or previously observed failure.

## Codex setup stages

### Bootstrap

- `AGENTS.md`, `.codex/config.toml`, specifications, tests, and quality commands.
- No hooks, skills, MCP servers, custom agents, or repo model pin.

### Stabilization

- Add a validation hook only after `npm run check` is reliable and fast enough.
- Add architecture checks when an actual dependency-boundary regression occurs.
- Add a bug-fix skill after the red/green/regression workflow has repeated.

### Release

- Add a release skill only after one manual prerelease exposes the exact sequence.
- Keep publication credentials and provider configuration outside the repository.
- Automate checks and artifact creation; keep package publication human-approved.
