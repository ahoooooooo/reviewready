# ReviewReady v1.0.13 release evidence

This document records the public coordinates verified after the protected
release workflow completed for the exact main revision below. The package was
published through npm Trusted Publishing, and the GitHub Release is immutable.

## Release scope

- [x] `package.json` and `package-lock.json` were aligned at 1.0.13.
- [x] `CHANGELOG.md` recorded the dated v1.0.13 documentation release.
- [x] The protected workflow audited the exact 111-file package artifact.
- [x] The exact artifact was published through npm Trusted Publishing with a
      matching registry integrity and SHA-1 shasum.
- [x] npm provenance, clean-room installation, and registry smoke verification
      passed for the published package.
- [x] Immutable semantic tag `v1.0.13` and GitHub Release target the verified
      main commit.
- [x] Stable Action tag `v1` targets the same verified main commit.
- [x] `docs/release-evidence-v1.0.13.json` records the machine-readable
      coordinates.

## Local and repository gates

- [x] The exact release candidate passed `npm run check`, dependency audit,
      package privacy, bundle parity, and Windows/Node package smoke.
- [x] A fresh exact-head reviewer promoted the release-evidence contract before
      the protected workflow was dispatched.
- [x] The workflow artifact digest was verified before publication:
      `sha256:c0e7e8143afd7e26e20ce2b3d522315604ead90037a1956577e7e0ba98e5849a`.

## Protected publication coordinates

- Source commit: `8c889b17b19e62988025401470a08b880fd74ef5`
- Immutable semantic tag: `v1.0.13`
- Stable Action ref: `v1`
- npm package: `@ahoooooo/reviewready@1.0.13`
- npm tarball:
  https://registry.npmjs.org/@ahoooooo/reviewready/-/reviewready-1.0.13.tgz
- npm shasum: `eecd04532ed3090bcd1083d3238f41eced8b3933`
- npm integrity:
  `sha512-B0aPJkuKs6JX++HY/j4W+ofdJVgCmCwMRD3T8h9nYzcs5DR29Jc77SphEnVTLOyBNjMQz8aY6WkzNDrloidwNA==`
- npm provenance predicate: `https://slsa.dev/provenance/v1`
- npm provenance source: `main@8c889b17b19e62988025401470a08b880fd74ef5`
- npm transparency-log index: `2583315168`
- protected workflow run:
  https://github.com/ahoooooooo/reviewready/actions/runs/32847757050
- audit job:
  https://github.com/ahoooooooo/reviewready/actions/runs/32847757050/job/97803262505
- registry smoke job:
  https://github.com/ahoooooooo/reviewready/actions/runs/32847757050/job/97803468788
- GitHub Release:
  https://github.com/ahoooooooo/reviewready/releases/tag/v1.0.13

## Verification boundary

The first protected attempt published the exact package and provenance, then
failed closed because npm propagation briefly returned E404 during the
immediate version check. A bounded rerun of only the failed publish job detected
the already-published exact version, skipped republishing, verified the
registry artifact and provenance, created the immutable release/tag, moved
stable `v1`, and passed registry smoke. No local npm token was used.

This evidence update is documentation-only and is merged after publication.
The package and release refs above target the release source commit; this later
evidence-document commit does not move the immutable tag or stable `v1`. The
published npm 1.0.12 package, its provenance, earlier immutable releases, and
historical commits remain unchanged.
