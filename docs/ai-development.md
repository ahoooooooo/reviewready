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

## Change loop

1. State one observable behavior and its acceptance examples.
2. Add or identify a test that fails without the change.
3. Let the agent implement the smallest slice.
4. Run focused tests and inspect actual CLI/Action output.
5. Try malformed, boundary, and adversarial inputs.
6. Retain every discovered defect as a regression test.
7. Run the complete gate.
8. Update the spec, plan, or agent guidance when the repository learned something.

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
