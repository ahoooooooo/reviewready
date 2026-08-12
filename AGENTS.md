# ReviewReady agent guide

ReviewReady is a deterministic pull-request readiness checker. It reports whether
a contribution supplied the evidence required by the repository's base-branch
policy. It never claims code is correct and never approves or merges a PR.

## Source map

- `docs/product-spec.md`: v1 behavior and non-goals.
- `docs/architecture.md`: trust boundaries and module rules.
- `docs/ai-development.md`: how humans and coding agents evolve this repository.
- `docs/exec-plans/active/post-v1.md`: fixed post-v1 node order and promotion gates.
- `docs/exec-plans/completed/v1.md`: historical v1 delivery plan and decision log.
- `docs/releasing.md`: current release and artifact-verification process.
- `docs/release-evidence-v1.md`: historical local v1 release-candidate verification.
- GitHub issues: active defects, accepted debt, and future implementation work.
- `src/`: production TypeScript.
- `test/`: unit and integration tests.
- `fixtures/`: executable policy and pull-request examples.

## Working rules

- Read the product spec, architecture, relevant issue, and nearest tests before
  changing behavior.
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

## Validation

Run the focused regression first, then `npm run check` for the complete local gate.
A change is not complete until both pass and generated/bundled artifacts have been
inspected when they are part of the diff.
