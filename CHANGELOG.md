# Changelog

All notable changes are documented here. The format follows Keep a Changelog and
the project uses semantic versioning.

## [1.0.4] - Unreleased

### Added

- Add a deterministic offline repository audit with versioned JSON and SARIF
  output, bounded normalized input, base-revision binding, and fail-closed
  branch/ruleset/workflow posture findings.
- Add pure bounded trusted-ingress primitives for raw-body HMAC verification,
  replay claims, freshness, and evaluation binding.
- Add bounded static AI-workflow source/prompt/sink analysis that never executes
  workflow code or invokes a model.

### Security

- Reject malformed runtime ingress values, non-boolean replay-store results,
  oversized secrets/signatures, YAML comment action-pin spoofing, and direct
  untrusted-text shell evaluation.
- Detect workflow block-scalar shell sinks, mutable actions, write permissions,
  privileged events, prompt injection, and model-output shell handoffs.

## [1.0.2] - 2026-08-10

### Security

- Added a release gate that inspects npm's actual planned package contents and
  rejects email addresses, local user paths, private keys, common access-token
  formats, binary content, unsafe paths, and files outside the public allowlist.
- Reject personal identity fields in the published package manifest and pin
  public publication to the official npm registry.
- Refresh vulnerable transitive dependencies in the locked tree; `npm audit`
  now reports zero vulnerabilities.

### Changed

- Run the complete quality and package-privacy gates automatically before npm
  publication.

## [1.0.1] - 2026-07-22

### Security

- Hardened Markdown report escaping so untrusted policy-derived text renders
  literally and passes complete-sanitization analysis in CodeQL.

## [1.0.0] - 2026-07-22

### Added

- Closed version 1 policy schema with path and label match sets.
- Deterministic PR body, issue, check, review, and attestation requirements.
- Versioned text, Markdown, and JSON reports.
- Local validate, explain, and check CLI commands.
- Read-only GitHub adapter using base-SHA policy authority.
- Node 24 GitHub Action with job summaries and stable outputs.
- Strict format, lint, type, coverage, build, and bundle quality gate.
