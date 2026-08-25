# ReviewReady v1.0.12 release evidence

This document records the public coordinates verified after the protected
release workflow completed for the exact main revision below.

## Release scope

- [x] package.json and package-lock.json were aligned at 1.0.12.
- [x] CHANGELOG.md recorded the v1.0.12 documentation release.
- [x] The exact audited tarball was published through npm Trusted Publishing.
- [x] npm integrity, shasum, provenance, and clean-consumer verification match
      the published tarball.
- [x] The immutable semantic tag and GitHub Release target the verified commit.
- [x] Stable v1 targets the same verified commit after npm verification.

## Protected publication coordinates

- Source commit: 1790a526751ca7e6274d7c51d3a678ec7fb528f4
- Immutable semantic tag: v1.0.12
- Stable Action ref: v1
- npm package: @ahoooooo/reviewready@1.0.12
- npm tarball:
  https://registry.npmjs.org/@ahoooooo/reviewready/-/reviewready-1.0.12.tgz
- npm shasum: fdfdac852ee829452a6cd28d0a96fa757f8a625b
- npm integrity: sha512-SYVi/J32lc9cWVzUJY6gvDuybZzSdFHpUFNQOFRCJLHSie9NszwqXxp/wRYg4tLXSDm1xD1nEU/+2+bb3J+u+w==
- npm provenance predicate: https://slsa.dev/provenance/v1
- protected workflow run:
  https://github.com/ahoooooooo/reviewready/actions/runs/32829063063
- GitHub Release:
  https://github.com/ahoooooooo/reviewready/releases/tag/v1.0.12

## Verification boundary

The published package contains the audited 111-file allowlisted surface. The
immutable release and earlier release evidence are retained; this document
does not alter historical commits, tags, package bytes, or external clones.
