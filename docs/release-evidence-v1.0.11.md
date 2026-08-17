# ReviewReady v1.0.11 release evidence

This document is the release-candidate checklist for the package source-map
delivery fix. The exact public coordinate matrix is added only after the
protected workflow has published and independently verified the exact
artifact; this file must not be marked complete from local evidence alone.

## Candidate scope

- [x] package.json and package-lock.json are aligned at 1.0.11.
- [x] CHANGELOG.md contains the v1.0.11 source-map delivery fix.
- [x] The package surface includes generated JavaScript and declaration maps.
- [ ] The exact audited tarball is published through npm Trusted Publishing.
- [ ] npm latest, integrity, shasum, provenance, and clean-room install are
      verified against that exact tarball.
- [ ] Immutable semantic-version tag v1.0.11 and GitHub Release target the
      verified main commit.
- [ ] The stable v1 Action tag is moved only after npm verification.
- [ ] Marketplace state and documentation wording are checked without making
      an unsupported authority or adoption claim.
- [ ] docs/release-evidence-v1.0.11.json records the exact public coordinates.

## Local gates

The release PR must pass npm run check, dependency audit, the committed Action
bundle parity gate, the Windows/Node package smoke, and the release preflight.
The protected workflow must use one exact main revision and one exact tarball
through audit, publish, registry verification, and clean-room smoke.

## External protection

GitHub future release immutability was enabled before this candidate. The
release environment retains its required reviewer. Historical v1.0.10
coordinates remain unchanged and are not rewritten by this release.

## Known boundary

Until every unchecked public step has exact evidence, v1.0.11 is a verified
candidate, not a completed public release. No readiness behavior, public v1
JSON schema, or hosted service is introduced by this patch.
