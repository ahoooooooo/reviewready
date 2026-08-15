# ReviewReady v1.0.8 release evidence

This document records the v1.0.8 package and Action release. The
machine-readable public coordinates are in
docs/release-evidence-v1.0.8.json; all values were checked against the exact
artifact and protected release workflow.

## Scope

- [x] package.json and package-lock.json are aligned at 1.0.8.
- [x] CHANGELOG.md contains the v1.0.8 release notes.
- [x] The package includes the deterministic audit collect/replay surface and
      both the frozen v1 and versioned v2 evidence contracts.
- [x] The main-bound TA-2 promotion run passed collection and offline replay at
      the verified main revision before this release candidate.

## Local verification

- [x] npm run check
- [x] npm run audit:dependencies
- [x] npm run release:preflight
- [x] git diff --check
- [x] Clean-room package smoke passed with lifecycle scripts disabled.

## Public verification

- [x] Publish the exact audited tarball through npm Trusted Publishing.
- [x] Verify npm latest, registry integrity, shasum, provenance, and clean-room
      install against that exact tarball.
- [x] Create and verify immutable semantic-version tag v1.0.8 and GitHub Release.
- [x] Move and verify the stable v1 Action tag only after npm verification.
- [x] Record exact public coordinates in
      docs/release-evidence-v1.0.8.json.
- [ ] Update the trusted workflow pin in a protected follow-up change to the
      verified v1.0.8 release commit.

## Known boundaries

The TA-2 promotion workflow keeps raw evidence in runner temporary storage.
Issue #55 remains open until a durable saved bundle and independent artifact
review satisfy its acceptance criteria. Issue #56 remains the separate
workflow-provider authority design gate. No placeholder checksum, provenance,
or adoption value is evidence.
