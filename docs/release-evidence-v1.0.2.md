# ReviewReady v1.0.2 release recovery evidence

This file records the 2026-08-10 recovery release after npm v1.0.0 and v1.0.1
were fully unpublished to remove public personal email metadata. It is a
historical record; statements about npm tags describe the state at the time of
verification, not the repository's current latest release.

## Scope and historical public state

- The GitHub repository and Marketplace Action remained public.
- At verification time, `@ahoooooo/reviewready@1.0.2` was public and npm
  `latest` pointed to `1.0.2`; npm `latest` has since advanced.
- Removed npm versions were not reused.
- A third-party npmmirror cache purge was tracked separately at
  <https://github.com/cnpm/cnpmcore/issues/1115>.

## Preventive release controls

- [x] Inspect the exact file list produced by `npm pack --dry-run --json`.
- [x] Allow only the documented runtime, schema, README, and license files.
- [x] Reject email addresses and Windows, Linux, or macOS user-directory paths.
- [x] Reject private-key headers and common GitHub, npm, OpenAI, Anthropic, and
      AWS credential formats.
- [x] Reject package manifest author, contributor, and maintainer identity fields.
- [x] Pin public publication to `https://registry.npmjs.org`.
- [x] Run the privacy audit in both `npm run check` and `prepublishOnly`.

## Local release-candidate verification

- [x] `npm run check` passed from the v1.0.2 source tree: 79 tests passed and all
      configured coverage thresholds were met.
- [x] `npm pack --dry-run --json --ignore-scripts` listed 28 approved files.
- [x] The planned v1.0.2 tarball contents passed the package privacy audit.
- [x] A clean temporary install ran policy validation and a ready fixture check
      without using the source tree.
- [x] `npm audit` reported no known vulnerabilities for the locked tree.

## Public verification

- [x] Published `@ahoooooo/reviewready@1.0.2` to the official npm registry.
- [x] Verified package metadata and tarball contents from the public registry.
- [x] Verified a clean exact-version registry install, policy validation, and a
      ready fixture check without the source tree.
- [x] Created immutable Git tag `v1.0.2` and moved the stable `v1` Action tag to
      the verified release commit.
- [ ] A GitHub Release object was not created at publication time and should be
      backfilled separately without changing the immutable tag.

## Final public coordinates

- Release commit: `95bb3ccf4e375a9783833a4f7a817f0cc34a8d6e`
- Package: <https://www.npmjs.com/package/@ahoooooo/reviewready>
- Tarball: <https://registry.npmjs.org/@ahoooooo/reviewready/-/reviewready-1.0.2.tgz>
- Integrity: `sha512-C+yelTnjf9FkH9gv3YlFsDL9uj3J4t6/5fXOvovBX+efW/voLYVDqf9VdHNr99WukhmcM1YPqhcFMGuJeYlXiw==`
- SHA-1: `d8b6633551f930339585ada67808234cfc89e8a9`
- Immutable Git tag: <https://github.com/ahoooooooo/reviewready/tree/v1.0.2>
- GitHub Release object: not published as of 2026-08-11
