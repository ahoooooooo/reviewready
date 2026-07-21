# ReviewReady agent guide

ReviewReady is a deterministic pull-request readiness checker. It reports whether
a contribution supplied the evidence required by the repository's base-branch
policy. It never claims code is correct and never approves or merges a PR.

## Source map

- `docs/product-spec.md`: v1 behavior and non-goals.
- `docs/architecture.md`: trust boundaries and module rules.
- `docs/ai-development.md`: how humans and coding agents evolve this repository.
- `docs/exec-plans/active/v1.md`: current delivery plan and decision log.
- `docs/release-evidence-v1.md`: local v1 release-candidate verification.
- `src/`: production TypeScript.
- `test/`: unit and integration tests.
- `fixtures/`: executable policy and pull-request examples.

## Working rules

- Read the product spec and nearest tests before changing behavior.
- For a bug, first add a test that fails for the reported case.
- Keep pass/fail deterministic; an LLM must never decide readiness.
- Treat PR metadata, paths, labels, event payloads, and API data as untrusted.
- Load the effective policy from the base revision, never from the proposed head.
- Do not execute code from a pull request.
- Prefer small modules with explicit inputs and outputs.
- Update the active plan when a decision, milestone, or known debt changes.

## Validation

Run `npm run check` for the complete local gate. A change is not complete until
the focused test and the complete gate both pass.
