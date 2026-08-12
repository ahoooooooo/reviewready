# ReviewReady v1.0.6 release evidence

This release candidate contains the deterministic trust-core hardening that
landed after v1.0.5. It must be published only from the verified final main
commit, and the exact audited tarball must be the bytes submitted to npm.

## Scope

- [ ] P0/P1/P2 implementation work was reviewed locally with regression tests
      after the final candidate is frozen.
- [ ] The Action bundle is regenerated from the final release candidate and
      checked for synchronization.
- [ ] The package and lockfile versions are aligned at 1.0.6.
- [ ] The exact tarball path, SHA-512, npm integrity, registry provenance, Git
      tag, GitHub Release, and stable v1 ref are recorded after publication.

## Local verification

- [ ] npm run check
- [ ] npm run audit:dependencies
- [ ] npm run release:preflight -- --artifact-dir <verified-directory>
- [ ] Clean-room install and CLI ready/not-ready/invalid smoke
- [ ] Windows Node.js 22 packaged smoke

## Public verification

- [ ] Publish @ahoooooo/reviewready@1.0.6 through npm Trusted Publishing.
- [ ] Verify the registry tarball integrity equals the audited local tarball.
- [ ] Verify exact-version install and CLI smoke from the registry package.
- [ ] Create immutable Git tag v1.0.6 at the verified main commit.
- [ ] Create the GitHub Release from that tag and move v1 only after npm
      verification.
- [ ] Verify the GitHub trusted workflow and ruleset require the intended
      immutable Action/check identity.
- [ ] Verify the GitHub release environment has the required reviewers
      configured, and record the protection result without exposing secrets.
- [ ] Verify the npm Trusted Publisher is bound to this repository, the exact
      `.github/workflows/release-publish.yml` filename, `main`, and release
      environment; record the configuration result.

## Coordinates

The final machine-readable coordinates belong in
docs/release-evidence-v1.0.6.json and must pass
npm run release:verify -- docs/release-evidence-v1.0.6.json --artifact
<exact-tarball> after all public resources exist. No placeholder checksum or
provenance value is evidence.
