# Changelog

All notable changes are documented here. The format follows Keep a Changelog and
the project uses semantic versioning.

## [Unreleased]

### Documentation

- Replace the completed post-v1 execution narrative with a concise canonical
  roadmap, align public release coordinates with verified v1.0.11 evidence, and
  keep program-specific application strategy outside the product repository.

## [1.0.11] - 2026-08-17

### Fixed

- Include generated JavaScript and declaration source maps in the published
  package so packaged runtime references remain verifiable by consumers.

## [1.0.10] - 2026-08-16

### Fixed

- Anchor workflow action-reference detection to the YAML `uses` key so a
  permission such as `statuses: read` cannot create a false
  `ACTION_REF_NOT_PINNED` audit finding.
- Add a regression test for the false-positive workflow audit boundary while
  preserving fail-closed behavior for genuinely unpinned actions.

## [1.0.9] - 2026-08-15

### Fixed

- Accept GitHub's canonical `last`/`first` pagination metadata on an empty
  bounded probe page instead of misclassifying a complete pull-request file
  set as incomplete.
- Preserve fail-closed behavior for non-empty probe pages, unexpected next
  links, and contradictory last-page metadata.

## [1.0.8] - 2026-08-15

### Added

- Publish the deterministic audit collect and offline audit replay evidence
  surface, including the frozen v1 bundle contract and the versioned v2
  ruleset-semantics extension.
- Preserve modeled GitHub pull-request and required-status ruleset semantics
  without changing readiness or public readiness JSON contracts.

### Changed

- Allow the trusted main-bound TA-2 promotion entrypoint to accept validated
  evidence bundle v2 and prove the live App-token collection/replay path.
- Document the bounded evidence, replay, promotion, and release coordinates for
  the next verified package release.

### Security

- Move pull-request template instructions outside required `Testing` and `Risk`
  sections so the current parser does not treat untouched HTML comments as visible
  evidence while the full Markdown-boundary fix is tracked in issue #12.
- Document the historical Check Runs boundary and v1 `report-json` compatibility
  issue; v1.0.4 records the corresponding fail-closed and schema fixes.
- Document that base-SHA policy loading does not protect a caller workflow loaded
  from the pull-request merge ref. Trusted workflow enforcement is tracked in
  issue #35, and the ordinary `pull_request` example is now explicitly advisory.
- Install CI dependencies without lifecycle scripts and make high-severity npm
  advisories fail the primary quality job explicitly.
- Generate and check in third-party license notices for dependencies bundled into
  the distributed JavaScript Action.
- Treat indented Markdown code blocks as non-visible evidence, and reject unsafe
  policy text containing control, format, bidi, or multiline characters.
- Fail closed at Check Run/status and rename-path expansion boundaries, with one
  bounded GitHub retry that respects rate-limit headers.
- Reject empty inline/reference Markdown link markers and incomplete anonymous
  actionable reviews instead of treating their shape as visible evidence.
- Fail closed on ambiguous Link pagination metadata and probe partial audit pages
  for hidden continuation data; keep runtime policy descriptions aligned with
  the strict policy text schema.
- Correct the canonical Action repository examples and bind the release audit
  checkout to the selected commit before running any release gate.

### Documentation

- Fix agent guidance after the completed v1 execution plan moved out of the active
  plan directory.
- Clarify npm artifact verification, historical mirror cleanup, review freshness,
  and current GitHub evidence-completeness limitations.
- Harden the Action workflow example with job-level least-privilege permissions,
  immutable pinning guidance, provider identity, and a clear distinction between
  advisory and authoritative deployment.
- Document editor schema options for repositories consuming ReviewReady.

## [1.0.7] - 2026-08-12

### Changed

- Synchronize the published npm README, release version, and schema reference
  with the verified v1.0.7 release coordinates.

### Changed

- Cancel superseded CI runs for the same ref, bound job execution time, and verify
  the complete committed Action bundle directory, including newly generated files.
- Group future Dependabot minor and patch updates while leaving major upgrades for
  separate review.
- Update the development dependency lockfile within existing major versions.
- Add a reusable `npm run audit:dependencies` command for release and CI checks.

## [1.0.6] - 2026-08-12

### Added

- Add a protected metadata-only trusted workflow reference, packaged Windows
  smoke coverage, and an OIDC-only exact-artifact release workflow.
- Add deterministic Action output bounds, policy-wide matching budgets, visible
  unmatched-change explanations, and attestation provenance terminology.
- Add a narrow CLI/schema package export surface, exact production dependency
  pins, cross-rule glob reuse, and enforceable per-file core coverage gates.
- Expand this repository's self-policy coverage across runtime, test, fixture,
  package, release, workflow, and security-boundary files.

### Security

- Fail closed when a bounded local input grows after initial file checks.
- Accept pull_request_target only for metadata-only evaluation and never execute
  pull-request code.

## [1.0.5] - 2026-08-12

### Added

- Add a framework-neutral bounded HTTP webhook contract with raw-byte framing,
  deterministic status mapping, and no implicit server or hosting provider.
- Add a versioned redacted observability event and fail-closed audit sink
  contract that never records request bodies, PR text, workflow source, prompts,
  secrets, or tokens.
- Add deterministic release metadata/provenance verification for exact npm
  integrity, GitHub refs, and release targets.

### Security

- Bind webhook replay namespaces to an out-of-band configured hook ID, require a
  verifier clock and finite tombstone-retention contract, and require repository
  identity in durable evaluation bindings.
- Enforce explicit GitHub App installation/repository allowlists and read-only
  token permissions; collect branch, tag, and push ruleset targets.
- Normalize push rulesets without a branch ref scope and never treat their
  non-applicable force-push/deletion fields as branch protection evidence.
- Restrict trust-event identities to UUIDs and actions to the bounded webhook
  action vocabulary.

### Changed

- Release preflight now fails if bundle generation changes the committed
  dist/action tree, including when the starting worktree already has staged
  bundle changes.

## [1.0.4] - 2026-08-12

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
