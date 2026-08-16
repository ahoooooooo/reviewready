# AI-assisted development policy

ReviewReady is built with coding agents, but evidence—not authorship—decides whether
a change is acceptable.

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

## Adversarial delivery loop

The base workflow is a loop, not a form or a field checklist. It applies to
implementation, design, research, and release work. The evidence used to prove
a result changes by task, but the reasoning loop remains the same:

1. **Frame** one observable outcome, its trust boundary, non-goals, completion
   condition, relevant baseline, target revision, and validation prerequisites.
   The baseline is frozen for the round so that a moving target cannot hide a
   regression or manufacture an improvement.
2. **Attack in batches** from independent angles. Examine correctness,
   adversarial input, authority, compatibility, operations, and evidence as
   applicable. Cover the meaningful attack surface before choosing a repair;
   do not alternate one discovery with one patch while unexplored surfaces
   remain, and do not repeat an angle that the accumulated evidence already
   disproved. A surface is covered when it was independently challenged or
   evidence shows that it cannot affect the outcome; completion is not a count
   of probes.
3. **Synthesize** the findings. Remove duplicates, connect related failures,
   rank their impact and uncertainty, and separate product defects, process
   defects, environment failures, evidence gaps, and external dependencies.
   This prevents a permission or CI-order failure from being misdiagnosed as a
   code defect. Choose repair slices for the smallest safe boundary and
   strongest proof, not by vote. A model's agreement is not evidence and a
   polished explanation is not a pass.
4. **Repair** each material defect at its smallest safe boundary. A bug starts
   with a failing regression test. A design or research gap starts with a
   falsifiable claim, counterexample, or stronger source. When an approach
   fails, preserve what it disproved, introduce a materially different
   hypothesis, and continue the resolution campaign instead of repeating the
   same attempt or declaring the work blocked. If the finding survives a
   repair, move up the resolution ladder from input and data, to algorithm and
   contract, to architecture, and finally to scope or external authority.
   Changing abstraction level is a solution attempt; it is not scope creep when
   the original boundary cannot satisfy the evidence.
5. **Prove** the repair against the frozen target. Run focused validation,
   malformed and boundary cases, compatibility and artifact checks, and an
   independent adversarial review. Prerequisite checks must settle before a
   dependent result is interpreted; stale, superseded, or race-affected results
   cannot decide the gate. The reviewer must be able to reject the change on
   evidence, not merely approve the author's reasoning. Independence means a
   separate reasoning path or fresh context; it does not depend on a different
   model name or an unverified claim that a human review occurred.
6. **Promote or loop.** Promote only when no unresolved material issue remains
   within scope, the target revision is reconciled with its actual base, and
   the evidence describes the current attempt. If review finds a gap, return to
   the attack phase with the failed attempt and its evidence. External writes,
   publication, and release actions occur only after this internal proof.

Fail-closed applies to the result, not to the effort: uncertain evidence may
not produce an accepting product decision, but the development loop continues
with new hypotheses and bounded alternatives. An external dependency is not an
automatic stop; safe alternatives are exhausted first, then the exact missing
authority or decision is isolated. Do not convert an unresolved result into a
pass by renaming it, lowering the standard, or hiding it behind stale evidence.

The integrator owns scope, synthesis, and promotion. Start with the smallest
team that can do the work and add an agent only for a genuinely independent
surface or an independent challenge. No agent may review its own patch or
argument as the final review; overlapping or idle work is closed. A new round
starts from the accumulated evidence and failed attempts, never from an
unexamined reset.

## Process self-optimization

When the workflow itself is the target, freeze the current process as the
baseline and apply the same loop to it. Attack the process through real past
tasks, looking for missed risks, repeated work, premature stops, stale evidence,
idle coordination, and unnecessary external mutations. Batch those findings,
design a materially different improvement, and replay the same tasks against
the candidate process while the old process remains unchanged. Promote the new
process only when it improves the outcome without weakening evidence, safety,
or scope control; a single successful replay is not proof that it is best. If
the candidates are equivalent, keep the simpler one. Once remaining changes
are only cosmetic, keep the current process and return to product work.

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
