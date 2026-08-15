# ReviewReady v1.0.10 release evidence

This document records the v1.0.10 workflow-audit false-positive fix. The
machine-readable public coordinates are in
docs/release-evidence-v1.0.10.json; all values below are tied to the exact
published package bytes and protected release workflow.

## Scope

- [x] package.json and package-lock.json are aligned at 1.0.10.
- [x] CHANGELOG.md contains the v1.0.10 workflow-audit fix.
- [x] The `statuses: read` regression has a failing-then-passing focused test.
- [x] Publish the exact audited tarball through npm Trusted Publishing in
      protected workflow run
      https://github.com/ahoooooooo/reviewready/actions/runs/31896849734.
- [x] Verify npm latest, registry integrity, shasum, provenance, and clean-room
      install against that exact tarball; the registry smoke job passed.
- [x] Create and verify immutable semantic-version tag v1.0.10 and GitHub
      Release at commit
      bffe33502395ce27ab046efa242789d6b25333de.
- [x] Move and verify the stable v1 Action tag only after npm verification.
- [x] Record exact public coordinates in docs/release-evidence-v1.0.10.json.

## Local verification

- [x] npm run check
- [x] npm run audit:dependencies
- [x] git diff --check

## Known boundary

This patch corrects a deterministic audit parser false positive. It does not
change readiness semantics, public readiness JSON schemas, workflow authority,
or the fail-closed treatment of genuinely unknown repository governance.

The first publish verification failed closed while npm propagation was still
incomplete and created no GitHub refs. The idempotent recovery resumed only
after the public npm coordinates were visible; audit, publish, and registry
smoke then completed successfully.
