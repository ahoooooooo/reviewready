# Changelog

All notable changes are documented here. The format follows Keep a Changelog and
the project uses semantic versioning.

## [Unreleased]

### Security

- Move pull-request template instructions outside required `Testing` and `Risk`
  sections so the current parser does not treat untouched HTML comments as visible
  evidence while the full Markdown-boundary fix is tracked in issue #12.
- Document the remaining exact Check Runs completeness boundary in issue #4 and
  the unintended v1 `report-json` key-format change in issue #25.

### Documentation

- Fix agent guidance after the completed v1 execution plan moved out of the active
  plan directory.
- Clarify npm artifact verification, historical mirror cleanup, review freshness,
  and current GitHub evidence-completeness limitations.
- Harden the recommended Action workflow with job-level least-privilege permissions
  and immutable pinning guidance.
- Document editor schema options for repositories consuming ReviewReady.

### Changed

- Cancel superseded CI runs for the same ref, bound job execution time, and verify
  the complete committed Action bundle directory.
- Group future Dependabot minor and patch updates while leaving major upgrades for
  separate review.

## [1.0.3] - 2026-08-10

### Security

- Replaced delimiter-based internal requirement deduplication keys with structured
  keys to prevent collisions. This also unintentionally changed the public v1 key
  encoding and is tracked for compatibility repair in issue #25.
- Ignore fenced Markdown examples when evaluating required PR body sections and
  human attestations.
- Use GitHub review timestamps to select the latest review state and include
  terminal commit statuses as check evidence.
- Added bounded fail-closed handling for changed files, check runs, and closing
  issue references. Completeness at GitHub's exact 1,000-suite Check Runs cap was
  not fully resolved and is tracked in issue #4.

### Changed

- Support Node.js 22 and newer for the CLI and development toolchain while
  keeping the packaged Action on Node.js 24.
- Add Node.js 22 compatibility CI and document that v1 intentionally does not
  evaluate `merge_group` events.

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
