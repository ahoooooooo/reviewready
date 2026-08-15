# ReviewReady v1.0.9 release evidence

This document records the v1.0.9 pagination hotfix release. The
machine-readable public coordinates are in
docs/release-evidence-v1.0.9.json; all values below are tied to the exact
published package bytes and protected release workflow.

## Scope

- [x] package.json and package-lock.json are aligned at 1.0.9.
- [x] CHANGELOG.md contains the v1.0.9 hotfix notes.
- [x] The GitHub pagination regression has a failing-then-passing focused test.
- [x] Publish the exact audited tarball through npm Trusted Publishing in
      protected workflow run
      https://github.com/ahoooooooo/reviewready/actions/runs/31894549666.
- [x] Verify npm latest, registry integrity, shasum, provenance, and clean-room
      install against that exact tarball; the registry smoke job passed.
- [x] Create and verify immutable semantic-version tag v1.0.9 and GitHub
      Release at commit
      4e31bca93116e0de737d6792fd32a8a5211fdbf5.
- [x] Move and verify the stable v1 Action tag only after npm verification.
- [x] Record exact public coordinates in docs/release-evidence-v1.0.9.json.

## Local verification

- [x] npm run check
- [x] npm run audit:dependencies
- [x] git diff --check

## Known boundary

The hotfix exists to repair the already-published v1.0.8 Action's handling of
GitHub's empty pagination probe response. It does not alter readiness semantics,
evidence schemas, or the TA-2 durable-artifact work in PR #72.

The release workflow's environment approval was granted only for this
run-scoped deployment. The repository ruleset remained active and its bypass
list was restored to empty immediately after the bootstrap merge. A failed
first publish verification due to npm propagation did not create GitHub refs;
the idempotent recovery resumed only after the public npm coordinates were
visible and the final workflow completed successfully.
