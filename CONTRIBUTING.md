# Contributing to ReviewReady

Thank you for improving ReviewReady. Contributions from humans and coding agents
follow the same evidence requirements.

## Start here

1. Read docs/product-spec.md, docs/architecture.md, and AGENTS.md.
2. Open or select an issue with one observable outcome.
3. For a bug, first add a test that fails for the reported behavior.
4. Make the smallest complete change.
5. Run the focused test, then npm run check.
6. Complete the pull-request template and explain residual risk.

Node.js 24 is required. Install the locked toolchain with:

```console
npm ci
```

## What makes a useful contribution

Good changes add a real policy capability, evidence provider, platform boundary,
fixture, regression, security hardening, accessibility improvement, or concrete
maintainer documentation. Tests should fail if the implementation is reverted.

Avoid artificial contributor-count work: typo-only churn, generated bulk changes,
duplicate adapters without users, or splitting one logical change among accounts.

## Quality gate

```console
npm run check
```

The gate runs formatting, strict linting, type checking, tests with coverage
thresholds, the CLI build, and the production Action bundle.

Do not weaken a threshold merely to make a change pass. Add meaningful coverage
or explain why the project contract should change.

## Security boundaries

- Never load policy from the PR head.
- Never execute pull-request code or interpolate untrusted values into a shell.
- Never add write permissions, comments, labels, approvals, merges, secrets, or
  privileged events without an accepted design discussion.
- Keep readiness deterministic. An LLM may draft explanations but cannot decide
  pass or fail.
- Public errors must not contain tokens, response bodies, stack traces, or local
  machine paths.

Report vulnerabilities through the process in SECURITY.md.

## AI-assisted contributions

AI use is welcome when the submitting human understands and takes responsibility
for the result. Include the tests you ran and inspect generated code and bundled
artifacts. Do not use agents to manufacture issues, reviews, or contributor
activity.

## Design changes

Open an issue before changing the policy schema, output format, trust boundary,
exit codes, GitHub permissions, or public scope. Include migration impact and
alternatives. v1 formats remain backward compatible within the major release.
