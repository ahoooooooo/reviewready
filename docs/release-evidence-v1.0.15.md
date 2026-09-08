# ReviewReady v1.0.15 release evidence

This document records the public coordinates verified after the protected
release workflow completed for the exact main revision below. The package was
published through npm Trusted Publishing, and the GitHub Release/tag refs were
verified against the same commit and exact artifact.

## Release scope

- [x] `package.json` and `package-lock.json` were aligned at 1.0.15.
- [x] `CHANGELOG.md` recorded the dated v1.0.15 release entry.
- [x] The protected workflow audited the exact 111-file package artifact.
- [x] The exact artifact was published through npm Trusted Publishing with a
      matching registry integrity and SHA-1 shasum.
- [x] npm provenance, clean-room installation, and registry smoke verification
      passed for the published package.
- [x] Immutable semantic tag `v1.0.15` and GitHub Release target the verified
      main commit.
- [x] Stable Action tag `v1` targets the same verified main commit.
- [x] This machine-readable evidence file records the final coordinates.

## Local and repository gates

- [x] The release PR and the merge commit passed the required `check` and
      `readiness` gates plus package, promotion, and CodeQL workflows.
- [x] The exact release candidate passed `npm run check`, dependency audit,
      package privacy, bundle parity, and Windows/Node package smoke in the
      protected workflow.
- [x] The npm Trusted Publisher and protected GitHub `release` environment were
      independently confirmed before workflow dispatch.
- [x] The workflow artifact digest was verified before publication:
      `sha256:3a747473bc59445e027e4c3c598808cf0a3965cbd9aa5a28cccf7ace58477b96`.
- [x] The downloaded workflow tarball independently matched its recorded
      SHA-512 and SHA-1 values.
- [x] The published registry tarball bytes matched the audited artifact, and an
      isolated consumer with an empty npm user config verified its provenance.

## Protected publication coordinates

- Source commit: `53c1c679387ad4005e07a5350609cca302d882d4`
- Immutable semantic tag: `v1.0.15`
- Stable Action ref: `v1`
- npm package: `@ahoooooo/reviewready@1.0.15`
- npm tarball:
  https://registry.npmjs.org/@ahoooooo/reviewready/-/reviewready-1.0.15.tgz
- npm SHA-1 shasum: `50d1788069418447566c9722cb26b02fabea1388`
- npm SHA-512 hex:
  `1fc59b9c44873381dc45647b66e4d660451bf00434e55bc983671f185601fa50af042819fc760d0fef2a43e8ea3b2a87436a1e44ee0eb40a037a048d02e67bed`
- npm integrity:
  `sha512-H8WbnESHM4HcRWR7ZuTWYEUb8AQ05VvJg2cfGFYB+lCvBCgZ/HYND+8qQ+jqOyqHQ2oeRO4OtAoDegSNAuZ77Q==`
- npm provenance predicate: `https://slsa.dev/provenance/v1`
- npm provenance source: `main@53c1c679387ad4005e07a5350609cca302d882d4`
- npm transparency-log index: `2754460134`
- npm provenance publication attempt:
  https://github.com/ahoooooooo/reviewready/actions/runs/34182179568/attempts/1
- post-publication verification attempt:
  https://github.com/ahoooooooo/reviewready/actions/runs/34182179568/attempts/2
- protected workflow run:
  https://github.com/ahoooooooo/reviewready/actions/runs/34182179568
- publication audit job:
  https://github.com/ahoooooooo/reviewready/actions/runs/34182179568/job/101923318366
- publication job:
  https://github.com/ahoooooooo/reviewready/actions/runs/34182179568/job/101923729419
- verification publish job:
  https://github.com/ahoooooooo/reviewready/actions/runs/34182179568/job/101924055261
- verification registry smoke job:
  https://github.com/ahoooooooo/reviewready/actions/runs/34182179568/job/101924173146
- GitHub Release:
  https://github.com/ahoooooooo/reviewready/releases/tag/v1.0.15
- GitHub Release published at: `2026-09-08T03:08:24Z`

## Pull-request event acceptance

- [x] Opening the evidence PR produced readiness run
      https://github.com/ahoooooooo/reviewready/actions/runs/34183219864
      for head `61a64e0f6bf953f71fb5d63a0261d8f1f29e43be`.
- [x] Pushing the publication-time evidence commit produced synchronize
      readiness run
      https://github.com/ahoooooooo/reviewready/actions/runs/34183382923
      for the new head `1b1271e2d3e36aeaafe236136b1bdaedcf1487f3`.
- [x] Editing only the PR body produced readiness run
      https://github.com/ahoooooooo/reviewready/actions/runs/34183545287
      for the unchanged head `1b1271e2d3e36aeaafe236136b1bdaedcf1487f3`.
- [x] Temporary, never-merge PR #134 used a first-attempt-only CI canary on
      head `f895378bd4fafd759682fce3e462fabcc74edcd3`. CI run
      https://github.com/ahoooooooo/reviewready/actions/runs/34183711488
      failed `check` on attempt 1 and passed the full gate on a same-head
      attempt 2 rerun.
- [x] Readiness run
      https://github.com/ahoooooooo/reviewready/actions/runs/34183711749
      failed on attempt 1, did not automatically rerun when CI later passed,
      and passed on the documented manual rerun without a new commit.

The temporary acceptance PR was closed without merge and its branch was deleted
after these observations. A later CI-only rerun still requires a manual rerun of
**ReviewReady trusted evidence** after CI completes.

## Independent registry recheck

At `2026-09-08T04:20:31Z`, a separate read-only query of the official npm
registry observed `latest=1.0.15` and downloaded the published tarball. Its
111-file list, SHA-512
`1fc59b9c44873381dc45647b66e4d660451bf00434e55bc983671f185601fa50af042819fc760d0fef2a43e8ea3b2a87436a1e44ee0eb40a037a048d02e67bed`,
and SHA-1 `50d1788069418447566c9722cb26b02fabea1388` matched this release
record. The manifest, CLI, README, and four exported schemas were present.

The packaged README declared package 1.0.15 but retained v1.0.14 Action/schema
examples and mutable `main` links for version-bound product documents. That
observed policy mismatch is corrected by the v1.0.16 candidate. This independent
recheck did not rerun full npm provenance verification; the successful protected
workflow evidence above remains the provenance observation.

## Verification boundary

The first workflow attempt published the exact audited artifact through npm
Trusted Publishing, then stopped at the registry latest-dist-tag check while
the npm publication propagated. The resumable second attempt observed
`latest=1.0.15`, verified the same artifact bytes and provenance, created the
immutable GitHub release/tag, moved stable `v1`, and passed registry smoke. No
second npm version was created and no immutable historical ref was rewritten.

This evidence update is documentation and trusted-pin maintenance after
publication. The package and release refs above target the release source
commit; this later evidence commit does not move the immutable tag or stable
`v1`. Earlier published packages, immutable releases, and historical commits
remain unchanged.
