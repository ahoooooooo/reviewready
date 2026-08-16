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
   disproved.
3. **Synthesize** the findings. Remove duplicates, connect related failures,
   rank their impact and uncertainty, and separate product defects, process
   defects, environment failures, evidence gaps, and external dependencies.
   This prevents a permission or CI-order failure from being misdiagnosed as a
   code defect. A model's agreement is not evidence and a polished explanation
   is not a pass.
4. **Repair** each material defect at its smallest safe boundary. A bug starts
   with a failing regression test. A design or research gap starts with a
   falsifiable claim, counterexample, or stronger source. When an approach
   fails, preserve what it disproved, introduce a materially different
   hypothesis, and continue the resolution campaign instead of repeating the
   same attempt or declaring the work blocked.
5. **Prove** the repair against the frozen target. Run focused validation,
   malformed and boundary cases, compatibility and artifact checks, and an
   independent adversarial review. Prerequisite checks must settle before a
   dependent result is interpreted; stale, superseded, or race-affected results
   cannot decide the gate. The reviewer must be able to reject the change on
   evidence, not merely approve the author's reasoning.
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

The integrator owns scope, synthesis, and promotion. Use the smallest number
of parallel agents that exposes genuinely independent surfaces. No agent may
review its own patch or argument as the final review; overlapping or idle work
is closed. A new round starts from the accumulated evidence and failed
attempts, never from an unexamined reset.

## Process self-optimization

When the workflow itself is the target, freeze the current process as the
baseline and apply the same loop to it. Attack the process through real past
tasks, looking for missed risks, repeated work, premature stops, stale evidence,
idle coordination, and unnecessary external mutations. Batch those findings,
design a materially different improvement, and replay the same tasks against
the candidate process. Promote the new process only when it improves the
outcome without weakening evidence, safety, or scope control. Once remaining
changes are only cosmetic, keep the current process and return to product work.

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
