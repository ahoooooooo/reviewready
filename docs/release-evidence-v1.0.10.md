# ReviewReady v1.0.10 release evidence

This document records the v1.0.10 workflow-audit false-positive fix. Public
coordinates will be added only after the protected release workflow verifies
the exact package bytes, npm provenance, GitHub refs, and stable Action tag.

## Scope

- [x] package.json and package-lock.json are aligned at 1.0.10.
- [x] CHANGELOG.md contains the v1.0.10 workflow-audit fix.
- [x] The `statuses: read` regression has a failing-then-passing focused test.
- [ ] Publish the exact audited tarball through npm Trusted Publishing.
- [ ] Verify npm latest, registry integrity, shasum, provenance, and clean-room
      install against that exact tarball.
- [ ] Create and verify immutable semantic-version tag v1.0.10 and GitHub
      Release at the exact verified release commit.
- [ ] Move and verify the stable v1 Action tag only after npm verification.
- [ ] Record exact public coordinates in docs/release-evidence-v1.0.10.json.

## Local verification

- [x] npm run check
- [x] npm run audit:dependencies
- [x] git diff --check

## Known boundary

This patch corrects a deterministic audit parser false positive. It does not
change readiness semantics, public readiness JSON schemas, workflow authority,
or the fail-closed treatment of genuinely unknown repository governance.
