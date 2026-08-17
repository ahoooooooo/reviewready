# ReviewReady v1.0.11 release evidence

This document records the verified public coordinates for the package
source-map delivery fix. Every public coordinate below is tied to the exact
artifact audited by the protected workflow at commit
`e9cd421ac106adb5731dd22b714701a136e937f8`.

## Release scope

- [x] package.json and package-lock.json are aligned at 1.0.11.
- [x] CHANGELOG.md contains the v1.0.11 source-map delivery fix.
- [x] The package surface includes generated JavaScript and declaration maps.
- [x] The exact audited tarball is published through npm Trusted Publishing in
      workflow run
      https://github.com/ahoooooooo/reviewready/actions/runs/32017160523.
- [x] npm latest, integrity, shasum, provenance, and clean-room install are
      verified against that exact tarball; the registry smoke job passed.
- [x] Immutable semantic-version tag v1.0.11 and GitHub Release target the
      verified main commit e9cd421ac106adb5731dd22b714701a136e937f8.
- [x] The stable v1 Action tag is moved only after npm verification and targets
      the same verified commit.
- [x] The public Marketplace listing is reachable at
      https://github.com/marketplace/actions/reviewready; this records listing
      state only and makes no authority, usage, or adoption claim.
- [x] docs/release-evidence-v1.0.11.json records the exact public coordinates.

## Local gates

- [x] The release PR passed npm run check, dependency audit, the committed
      Action bundle parity gate, Windows/Node package smoke, and release
      preflight.
- [x] The protected workflow used one exact main revision and one exact tarball
      through audit, publish, registry verification, provenance, and clean-room
      smoke.

## External protection

GitHub future release immutability was enabled before this release. The
v1.0.11 GitHub Release is immutable, and the `release` environment retains its
required reviewer. Historical v1.0.10 coordinates remain unchanged and are not
rewritten by this release. The first post-publish registry check failed closed
while npm propagation was incomplete; the idempotent rerun continued only after
the public version and `latest` tag were visible.

## Known boundary

The release does not change readiness behavior or public v1 JSON schemas, and
it does not introduce a hosted service. Marketplace listing reachability is not
evidence of adoption or third-party usage.
