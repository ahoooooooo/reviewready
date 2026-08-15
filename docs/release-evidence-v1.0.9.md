# ReviewReady v1.0.9 release evidence

This document records the v1.0.9 pagination hotfix candidate. The public
coordinates will be recorded only after the protected release workflow verifies
the exact package bytes, npm provenance, GitHub refs, and stable Action tag.

## Scope

- [x] package.json and package-lock.json are aligned at 1.0.9.
- [x] CHANGELOG.md contains the v1.0.9 hotfix notes.
- [x] The GitHub pagination regression has a failing-then-passing focused test.
- [ ] Publish the exact audited tarball through npm Trusted Publishing.
- [ ] Verify npm latest, registry integrity, shasum, provenance, and clean-room
      install against that exact tarball.
- [ ] Create and verify immutable semantic-version tag v1.0.9 and GitHub
      Release at the exact verified release commit.
- [ ] Move and verify the stable v1 Action tag only after npm verification.
- [ ] Record exact public coordinates in docs/release-evidence-v1.0.9.json.

## Local verification

- [ ] npm run check
- [ ] npm run audit:dependencies
- [ ] git diff --check

## Known boundary

The hotfix exists to repair the already-published v1.0.8 Action's handling of
GitHub's empty pagination probe response. It does not alter readiness semantics,
evidence schemas, or the TA-2 durable-artifact work in PR #72.
