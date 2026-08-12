# ReviewReady v1.0.7 release evidence

This document records the documentation-synchronization patch release. It must
be completed only after the exact audited tarball, npm provenance, immutable
GitHub tag, GitHub Release, and stable `v1` ref have all been verified.

## Scope

- [ ] The package and lockfile versions are aligned at 1.0.7.
- [ ] The published npm README matches the verified GitHub release coordinates.
- [ ] The exact tarball hashes, registry provenance, GitHub Release, and stable
      `v1` ref are recorded in `docs/release-evidence-v1.0.7.json`.

## Local verification

- [ ] `npm run check`
- [ ] `npm run audit:dependencies`
- [ ] `npm run release:preflight`
- [ ] `git diff --check`

## Public verification

- [ ] Publish `@ahoooooo/reviewready@1.0.7` through npm Trusted Publishing.
- [ ] Verify the exact registry artifact and npm provenance.
- [ ] Create immutable Git tag `v1.0.7` and its GitHub Release.
- [ ] Move stable `v1` only after npm and GitHub release verification.
- [ ] Update the trusted workflow to the exact v1.0.7 release commit in a
      protected follow-up change.

No placeholder checksum or provenance value is evidence.
