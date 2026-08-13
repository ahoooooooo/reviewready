# ReviewReady v1.0.6 release evidence

This document records the public v1.0.6 release containing the deterministic
trust-core hardening that landed after v1.0.5. The exact audited tarball was
submitted to npm through Trusted Publishing. The release candidate commit was
`9cb239e3b81e00b0f82239eaf43843863ab51e2d`; main later advanced with a
release-workflow recovery fix that does not change the published package bytes.

## Scope

- [x] The v1 trust-core implementation was reviewed locally with regression
      tests after the final candidate was frozen.
- [x] The Action bundle was regenerated from the final release candidate and
      checked for synchronization.
- [x] The package and lockfile versions are aligned at 1.0.6.
- [x] The exact tarball SHA-512, npm integrity, registry provenance, Git tag,
      GitHub Release, and stable v1 ref are recorded after publication.

## Local verification

- [x] npm run check
- [x] npm run audit:dependencies
- [x] npm run release:preflight -- --artifact-dir <verified-directory>
- [x] Clean-room install and CLI ready/not-ready/invalid smoke
- [x] Windows Node.js 22 packaged smoke

## Public verification

- [x] Publish @ahoooooo/reviewready@1.0.6 through npm Trusted Publishing.
- [x] Verify the registry tarball integrity equals the audited local tarball.
- [x] Verify exact-version install and CLI smoke from the registry package.
- [x] Create semantic-version Git tag v1.0.6 at the verified release commit;
      project release policy treats that tag as non-moving.
- [x] Create the GitHub Release from that tag and move v1 only after npm
      verification.
- [ ] Verify that GitHub rules require the trusted workflow and intended
      Action/check authority. The personal-repository ruleset still
      lacks an organization-level required-workflow trust root.
- [ ] Verify the release environment's required reviewers include an
      independent reviewer and platform-enforced tag protection; the current
      release environment has only the repository owner available.
- [x] Verify that the npm Trusted Publisher is bound to this repository, the
      exact `.github/workflows/release-publish.yml` filename, `main`, and
      release environment through the published provenance.

## Coordinates

The final machine-readable coordinates belong in
docs/release-evidence-v1.0.6.json. `npm run release:verify` passed against the
exact registry tarball URL recorded below. No placeholder checksum or
provenance value is evidence, and the temporary downloaded artifact path is
intentionally not committed.

This evidence proves artifact and release-coordinate consistency; it does not
claim that all GitHub issues are closed or that external governance blockers
have been resolved.

PL-0 verification on 2026-08-13 found GitHub release immutability disabled and
the v1.0.6 release not platform-immutable. This evidence also did not establish
platform-enforced tag protection. The SHA alignment below is an observed
coordinate match, not an enforcement guarantee.

## Verified coordinates

- Package: `@ahoooooo/reviewready@1.0.6`
- Release candidate, project-policy semantic-version tag `v1.0.6`, stable `v1`,
  and release target:
  `9cb239e3b81e00b0f82239eaf43843863ab51e2d`
- Registry tarball: `https://registry.npmjs.org/@ahoooooo/reviewready/-/reviewready-1.0.6.tgz`
- SHA-512: `4102b7ede0368c97fea5d9a479f1277e0cf08bbcb31ce3e1d92cfd39679f8a11915dc65528709c79488aa13162ab3e8650a8e8ac6558ecff446731b43114877d`
- npm integrity: `sha512-QQK37eA2jJf+pdmkefEnfgzwi7yzHOPh2Sz9OWefihGRXcZVKHCceUiKoTFiqz6GUKjorGVY7P9EZzG0MRSHfQ==`
- npm shasum: `53480590d40b254ef2d3eb22eca69918090154ef`
- GitHub Release: `https://github.com/ahoooooooo/reviewready/releases/tag/v1.0.6`
- Public verification: `npm run release:verify` passed against the exact
  registry tarball and this evidence JSON.

The initial publish workflow run completed npm publication but stopped while
the registry propagated the new version. An idempotent rerun then created the
semantic-version tag but stopped while `gh release` inferred a repository in
its checkout-free job. The release was completed from that already verified
tag without republishing or moving it; the explicit repository binding fix is
now merged for future resumable releases.
