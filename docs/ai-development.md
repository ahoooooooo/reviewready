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
implementation, design, research, and release work. The evidence used to
prove a result changes by task, but the reasoning loop remains the same:

1. **Frame** one observable outcome, its trust boundary, non-goals, and the
   condition that would make the work complete.
2. **Attack in batches** from independent angles. Examine correctness,
   adversarial input, authority, compatibility, operations, and evidence as
   applicable. Collect the whole bounded batch before choosing a repair; do not
   alternate one discovery with one patch when the remaining attack surface is
   still unexplored.
3. **Synthesize** the findings. Remove duplicates, connect related failures,
   rank their impact and uncertainty, and choose disjoint repair slices. A
   model's agreement is not evidence and a polished explanation is not a pass.
4. **Repair** each material defect at its smallest safe boundary. A bug starts
   with a failing regression test. A design or research gap starts with a
   falsifiable claim, counterexample, or stronger source. When an approach
   fails, preserve what it disproved and change the attack angle instead of
   repeating the same attempt.
5. **Prove** the repair with focused validation, malformed and boundary cases,
   compatibility and artifact checks, and an independent adversarial review.
   The reviewer must be able to reject the change on evidence, not merely
   approve the author's reasoning.
6. **Promote or loop.** Promote only when no unresolved material issue remains
   within scope. If review finds a gap, return to the attack phase with the
   failed attempt and its evidence. Do not convert an unresolved result into a
   pass by renaming it, lowering the standard, or declaring the work blocked.

Fail-closed applies to the result, not to the effort: uncertain evidence may
not produce an accepting product decision, but the development loop continues
with new hypotheses and bounded alternatives. The only legitimate stop outside
a verified result is an explicitly isolated external dependency or product
decision that the repository cannot determine itself.

The integrator owns scope, synthesis, and promotion. Parallel agents may attack
independent surfaces, but no agent's own patch or argument is its final review.
Agents are closed after their evidence is delivered; a new round starts from
the accumulated evidence rather than from an unexamined reset.

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
