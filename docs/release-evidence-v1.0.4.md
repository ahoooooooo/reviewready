# ReviewReady v1.0.4 release evidence

This record covers the published npm package built from source commit
`662604d`. It is synchronized in the final release-evidence commit on the
`agent/release-readiness-v1` branch. npm publication and the GitHub v1.0.4
release/tag state are verified against that final evidence commit; `main`
remains unchanged.

## Scope

- Released package version: `1.0.4`.
- Public `@ahoooooo/reviewready@1.0.4` is now the latest npm release.
- The candidate adds the offline repository audit, trusted-ingress primitives,
  bounded live GitHub collector/App helpers, webhook replay/binding primitives,
  bounded AI-workflow analysis, separate readiness-result schema, dogfood
  fixture, and adversarial regression coverage.

## Release controls

- [x] Commit and push the candidate after explicit approval: commit
      `662604d6123378d7b1aea242065f74afc9aea5b8` is verified on
      `agent/release-readiness-v1`.
- [x] Run the exact local tarball audit and clean-room package install from the
      current working tree: 46 packaged files, SHA-512
      `4ece7af7c11007a1f6477da34764467ea4856f382f0cb7a83a181b52039910744a6527f88f62626a828967a290897a9901c02ba6117214b432ead1c988acf3b0`.
- [x] Publish npm only after the package audit and authentication checks pass:
      `@ahoooooo/reviewready@1.0.4` is public, and registry SHA-512
      `4ece7af7c11007a1f6477da34764467ea4856f382f0cb7a83a181b52039910744a6527f88f62626a828967a290897a9901c02ba6117214b432ead1c988acf3b0`
      matches the clean-room artifact; registry shasum is
      `7737facc197c48f127eb6087af1ff7e2bfec7098`.
- [x] Create the GitHub `v1.0.4` release and move the Action `v1` tag to the
      final evidence-synchronized release commit; the published package
      content remains the verified `662604d` source state and `main` remains
      unchanged.

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

The GitHub release is available at
`https://github.com/ahoooooooo/reviewready/releases/tag/v1.0.4`. Both
`v1.0.4` and `v1` resolve to the final commit containing this synchronized
evidence. The release commit is documentation-only relative to the verified
`662604d` package source, so the npm artifact SHA-512 remains identical.
