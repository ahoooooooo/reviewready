# ReviewReady v1.0.4 local candidate evidence

This is an unreleased candidate record. Commit `65f363f` is pushed to the
`agent/release-readiness-v1` branch; this does not claim an npm publish,
GitHub release, tag movement, or `main` branch update.

## Scope

- Candidate package version: `1.0.4`.
- Public v1.0.3 remains the latest released version.
- The candidate adds the offline repository audit, trusted-ingress primitives,
  bounded live GitHub collector/App helpers, webhook replay/binding primitives,
  bounded AI-workflow analysis, separate readiness-result schema, dogfood
  fixture, and adversarial regression coverage.

## Release controls

- [x] Commit and push the candidate after explicit approval: commit
      `65f363f` is verified on `agent/release-readiness-v1`.
- [x] Run the exact local tarball audit and clean-room package install from the
      current working tree: 46 packaged files, SHA-512
      `4ece7af7c11007a1f6477da34764467ea4856f382f0cb7a83a181b52039910744a6527f88f62626a828967a290897a9901c02ba6117214b432ead1c988acf3b0`.
- [ ] Publish npm only after the package audit and authentication checks pass.
- [ ] Move GitHub release and Action tags only after npm integrity verification.

## Local verification

- [x] `npm run check` passed: 18 test files and 321 tests; statements 91.97%,
      branches 87.09%, functions 95.56%, and lines 92.05%.
- [x] The TypeScript build, regenerated Action bundle, and 46-file exact
      tarball audit passed.
- [x] Focused audit, API, App, webhook, compatibility, package, and release
      regression suites passed.
- [x] Built CLI JSON and SARIF smoke tests passed against the checked-in
      dogfood audit fixture with the expected nonzero result; the fixture
      intentionally reports both trusted-root and pull-request workflow
      protection findings for the current repository posture.
- [x] The same exact tarball installed in a clean room and passed `validate`
      plus a ready `check --json` smoke test.
- [x] `git diff --check` passed.

No external release claim belongs in this file until a separate release
decision, clean exact-commit install, npm integrity verification, and GitHub
tag review are complete.
