# ReviewReady current status

Status: **canonical mainline cross-surface snapshot**

This document is the single index for the mainline/public project state at the
dated snapshot below. It separates local mainline facts, public release facts,
and time-bound external provider observations. It is not a live checkout status
for feature branches; use Git for the active branch and revision. Historical
evidence is linked but is never presented as current live authority.

Snapshot date: **2026-08-17 (Asia/Taipei)**

## Mainline

- Working branch: `main`.
- Last locally verified revision: `0931d648f28ad9a952b372db5e8f5985622c3378`.
- Baseline verification found `main` and `origin/main` synchronized with a
  clean working tree; this status-consolidation change is currently an
  intentional uncommitted documentation change, with no source/runtime edits.
- The public v1.0.11 release root is intentionally older than the current
  documentation-only main revision: package, release, tags, and trusted Action
  pin resolve to `e9cd421ac106adb5731dd22b714701a136e937f8`.
- This is deliberate release-root immutability, not a package or tag mismatch.
- The last public `origin` ref check and the synchronized local checkout both
  resolve `v1` and `v1.0.11` to `e9cd421ac106adb5731dd22b714701a136e937f8`.

## Product and trust state

The v1 core is a deterministic evidence layer. It does not claim code
correctness, AI authorship, approval, or merge authority.

Verified design and local implementation state:

- Readiness is deterministic; an LLM never decides readiness.
- Effective policy is loaded from the immutable base revision.
- Pull-request code is not checked out, imported, built, or executed by the
  trusted production Action.
- PR metadata, paths, labels, events, Markdown, and API responses are
  untrusted input.
- Bounds, retry limits, revision binding, public JSON compatibility, and
  fail-closed incomplete states are covered by tests and contracts.
- PL-0, TA-1, TA-2, TA-3-D, and the provider-neutral TA-3-I local core slice
  are complete according to the active execution plan.
- Production HTTPS hosting, durable storage, secret management, and live
  dedicated GitHub App enforcement have not started.

## Public release state

Canonical release evidence: [v1.0.11 release evidence](release-evidence-v1.0.11.md)
and [machine-readable coordinates](release-evidence-v1.0.11.json).

- Package: `@ahoooooo/reviewready@1.0.11`.
- npm latest: `1.0.11`.
- npm registry integrity:
  `sha512-x70ceTgcISmjFS1MjPntORU9NVTyQW+EetS+Qj1gJNasATkzoQrWMI1kHzW3ALJGVnGRdUKOTAJPJPyThigZ6w==`.
- npm shasum: `679e81d27d129ba1a5d2ada97a1228a9e2bbd5ee`.
- GitHub Release: [v1.0.11](https://github.com/ahoooooooo/reviewready/releases/tag/v1.0.11).
- Immutable release tag `v1.0.11`, stable tag `v1`, and trusted workflow pin
  all resolve to `e9cd421ac106adb5731dd22b714701a136e937f8`.
- Release provenance and clean-room/package verification passed for the exact
  artifact recorded in the release evidence.
- Local `npm whoami` is not a release prerequisite; the protected GitHub Actions
  OIDC Trusted Publishing workflow is the release authority.

## Execution plan

The only active execution plan is [post-v1](exec-plans/active/post-v1.md).
Its fixed order is:

`PL-0 -> TA-1 -> TA-2 -> TA-3 -> AI-1 -> V2-1 -> AD-1`

No new feature lane is active. The following work is deliberately parked:

- #78/#79: hosted GitHub App authority and external enforcement evidence.
- #61: a consented external OSS pilot.
- #57/#58/#59: future AI-1/V2-1 runtime implementations, separate from the
  deterministic readiness core.

## GitHub external state

External authentication and provider state are time-bound. The last successful
read-only GitHub snapshot on 2026-08-17 observed:

- Repository `ahoooooooo/reviewready` was public and `main` was the default
  branch.
- Active ruleset `19504404` (`Main branch protection`) blocked deletion and
  non-fast-forward updates, required pull requests and thread resolution, and
  required `check` and `readiness` from GitHub Actions App ID `15368`.
- The ruleset required zero approving reviews; it did not uniquely bind one
  immutable workflow definition or event.
- Actions were enabled with default workflow permissions read-only; repository
  settings allowed all actions and did not globally enforce SHA pinning. The
  checked-in workflow references were nevertheless pinned to full SHAs.
- Open PRs were Dependabot maintenance PRs #90–#94. #90 was known to fail the
  generated Action-bundle parity gate; the other failure details were not
  re-collected in the later bounded check.
- Open issues were #61, #78, and #79, all already classified in the active
  plan as parked external work.
- Recent main checks for the verified `0931d64` revision passed, including
  `check`, CodeQL, Windows package smoke, and TA-2 trusted promotion.

The legacy GitHub CLI canonicalization attempt immediately before this document
was written received HTTP 503 twice. No repository-targeted GitHub command or
mutation was performed after that failure. Therefore the items in the preceding
list are **last known evidence**, not a claim that the provider is currently
reachable. Current operations first run `npm run auth:status`, then use GCM for
Git or the explicitly approved connected provider for API work. The CLI path is
retired and must not be retried.

## Remaining trust boundaries

These are known limitations, not silently completed work:

- A GitHub Actions App ID identifies a provider class, not a unique immutable
  workflow root; dedicated provider authority remains TA-3 work.
- Historical release/tag governance limitations remain documented and are not
  rewritten into stronger claims.
- No hosted service, paid deployment, database, or external infrastructure is
  part of the v1.0.11 release.
- Adoption and pilot evidence are not inferred from stars, downloads, or local
  fixtures.

## Document map

- Product behavior and non-goals: [product-spec.md](product-spec.md).
- Trust boundaries and module rules: [architecture.md](architecture.md).
- Development and promotion method: [ai-development.md](ai-development.md) and
  [oss-upgrade-process.md](oss-upgrade-process.md).
- Node order and promotion gates: [post-v1.md](exec-plans/active/post-v1.md).
- Release coordinates: [release-evidence-v1.0.11.md](release-evidence-v1.0.11.md).
- Historical governance snapshot:
  [governance-evidence-ta1.md](governance-evidence-ta1.md).
- Research classification: [research/README.md](research/README.md).
- Authentication authority: [authentication.md](authentication.md).
- External-operation lessons: [operational-lessons.md](operational-lessons.md).

The status document must be updated with a new timestamp and evidence class
when local, GitHub, npm, or release state changes. It must not rewrite
historical evidence or turn an unavailable external observation into a pass.
