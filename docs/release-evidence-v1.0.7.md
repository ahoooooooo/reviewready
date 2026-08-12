# ReviewReady v1.0.7 release evidence

This document records the documentation-synchronization patch release. The
machine-readable coordinates are in `docs/release-evidence-v1.0.7.json`; every
public coordinate below was checked against the exact audited tarball before
the release was treated as complete.

## Scope

- [x] The package and lockfile versions are aligned at 1.0.7.
- [x] The published npm README identifies the v1.0.7 CLI/Action and schema
      contract; its advisory example retains the earlier immutable v1.0.6 SHA
      because an already-published package cannot be rewritten.
- [x] The exact tarball hashes, registry provenance, GitHub Release, and stable
      `v1` ref are recorded in `docs/release-evidence-v1.0.7.json`.

## Local verification

- [x] `npm run check`
- [x] `npm run audit:dependencies`
- [x] `npm run release:preflight`
- [x] `npm run release:verify` against the exact registry tarball
- [x] `git diff --check`
- [x] Clean-room install of `@ahoooooo/reviewready@1.0.7` followed by valid
      `validate` and ready `check --json` CLI smoke.

## Public verification

- [x] Publish `@ahoooooo/reviewready@1.0.7` through npm Trusted Publishing.
- [x] Verify the exact registry artifact and npm provenance.
- [x] Create immutable Git tag `v1.0.7` and its GitHub Release.
- [x] Move stable `v1` only after npm and GitHub release verification.
- [x] Update the trusted workflow to the exact v1.0.7 release commit in this
      protected follow-up change.
- [x] Merge the registry-smoke fixture correction without republishing or
      rewriting v1.0.7.

## Verified coordinates

- Package: `@ahoooooo/reviewready@1.0.7`
- Release candidate, immutable `v1.0.7`, stable `v1`, and release target:
  `f21ed2e94efedb01f73e518c39765cef72c58e1c`
- Registry tarball: `https://registry.npmjs.org/@ahoooooo/reviewready/-/reviewready-1.0.7.tgz`
- Local audited SHA-512: `8df75a340d9196d0e309b60ab6e36eb0f38ab5ead7f0acddf15c663791c6082490a7a1c5f69c4812aa0cf93fc07ea8caea1fd1b28e82e49fa9fa8a58912b51d5`
- npm integrity: `sha512-jfdaNA2RltDjCbYKtuNusPOKterX8Kzd8VxmN5HGCCSQp6HF9pxIEqoM+T/AfqjK6h/Rso6C5J+p+opYkStR1Q==`
- npm shasum: `d82f119eb5775cbbede975fee35c9058ad5daa66`
- GitHub Release: `https://github.com/ahoooooooo/reviewready/releases/tag/v1.0.7`
- Provenance predicate: `https://slsa.dev/provenance/v1`
- Provenance repository: `https://github.com/ahoooooooo/reviewready`
- Provenance workflow/ref: `.github/workflows/release-publish.yml` on
  `refs/heads/main`
- Provenance commit: `f21ed2e94efedb01f73e518c39765cef72c58e1c`

The first publish workflow attempt completed npm publication but stopped while
the new registry version was still propagating. An idempotent rerun observed
the existing version, completed the GitHub Release and tags, and did not
republish or rewrite the package. Its final registry-smoke job then exposed an
invalid empty policy condition; PR #52 corrected that fixture and added a
regression test without changing the published bytes or release refs.

This evidence proves artifact and release-coordinate consistency; it does not
claim that all GitHub issues are closed or that external governance blockers
have been resolved.

No placeholder checksum or provenance value is evidence.
