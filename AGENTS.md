# ReviewReady agent guide

ReviewReady is a deterministic pull-request readiness checker. It reports whether
a contribution supplied the evidence required by the repository's base-branch
policy. It never claims code is correct and never approves or merges a PR.

## Source map

- `docs/product-spec.md`: v1 behavior and non-goals.
- `docs/architecture.md`: trust boundaries and module rules.
- `skills/reviewready-base-delivery/SKILL.md`: executable full-rigor iterative
  delivery protocol applied to every repository task.
- `skills/reviewready-deep-research/SKILL.md`: source-traceable research overlay
  for current, external, strategic, and authority-dependent decisions.
- `docs/ai-development.md`: how humans and coding agents evolve this repository.
- `docs/exec-plans/active/post-v1.md`: fixed post-v1 node order and promotion gates.
- `docs/exec-plans/completed/v1.md`: historical v1 delivery plan and decision log.
- `docs/releasing.md`: current release and artifact-verification process.
- `docs/operational-lessons.md`: recurring integration failures and their
  durable guards; read it before external GitHub/npm operations.
- `docs/release-evidence-v1.md`: historical local v1 release-candidate verification.
- GitHub issues: active defects, accepted debt, and future implementation work.
- `src/`: production TypeScript.
- `test/`: unit and integration tests.
- `fixtures/`: executable policy and pull-request examples.

## Context loading

The source map is not a preload list. Keep the default context to this file and
`skills/reviewready-base-delivery/SKILL.md`. Load the deep-research skill only
when its prompt admission gate triggers. Load rationale and evidence documents
on demand by route: product/architecture for behavior or trust changes,
post-v1 for node planning, release/operational/current-status for external or
release work, and research documents for research or process-method changes.
Use `rg` to find relevant headings and read bounded sections; do not preload all
of `docs/`, `src/`, or `test/`.

## Working rules

- Read the product spec, architecture, relevant issue, and nearest tests before
  changing behavior.
- Use the full base adversarial loop in
  `skills/reviewready-base-delivery/SKILL.md` for every user prompt. Its prompt
  admission gate selects extra lanes; it never permits skipping baseline,
  framing, attack, proof, or promotion. `routine` is only a scope label.
- Read and apply `skills/reviewready-base-delivery/SKILL.md` at the start of each
  task. When its prompt admission gate selects research, also read and apply
  `skills/reviewready-deep-research/SKILL.md`; the docs remain the project-level
  rationale and source map.
- For a bug, first add a test that fails for the reported case.
- Keep pass/fail deterministic; an LLM must never decide readiness.
- Treat PR metadata, paths, labels, event payloads, and API data as untrusted.
- Load the effective policy from the base revision, never from the proposed head.
- The production Action must never execute code from a pull request. Development
  agents may run this repository's own tests and build from a trusted checkout,
  but must not run untrusted fork code with privileged credentials.
- Prefer small modules with explicit inputs and outputs.
- Keep one observable outcome per issue and pull request.
- Record new debt or decisions in an issue or a new execution plan. Do not rewrite
  completed plans as if historical work were still active.
- Do not publish packages, create releases, or move tags unless the issue explicitly
  authorizes a release and every prerequisite is verified.

## External authentication preflight

Browser login does not prove CLI login. GitHub browser sessions, GitHub CLI
keyring credentials, and Git HTTPS credentials are separate channels. Before a
GitHub operation, run `gh auth status --hostname github.com` and then run
`gh api user --jq .login` in the same network context that will perform the
operation. Only a successful, non-empty API result may be used to derive the
repository owner; never type an owner into a command or continue with an empty
repository target.

The sandbox network and the external operation network may differ. A proxy or
sandbox failure is not evidence that a valid keyring token is revoked; classify
the failure first and retry once in the approved connected context. Public
`git ls-remote` success is not proof of authenticated write access. Never print
tokens, copy them into project files, or rotate credentials to diagnose a
context-only failure. Authentication status is time-bound and must be checked
again when an external operation begins.

npm local login is a separate channel again. The normal release authority is
npm Trusted Publishing through GitHub Actions OIDC, not local `npm whoami` and
not a long-lived npm token. A local `ENEEDAUTH` is therefore expected after
deliberate logout and does not by itself block ordinary repository work; a
release must instead verify the protected workflow, environment, registry
provenance, and exact artifact at its release gate.

## Validation

Run the focused regression first, then `npm run check` for the complete local gate.
A change is not complete until both pass and generated/bundled artifacts have been
inspected when they are part of the diff.
