# Public baseline

This document defines the public coordinate and capability policy for the
ReviewReady Evidence Protocol. Live GitHub and npm state remains authoritative;
this file prevents a repository checkout, a published artifact, and an advisory
check from being described as the same thing when they are not.

## Identity

- Product: **ReviewReady**
- Protocol: **ReviewReady Evidence Protocol**
- Positioning: **Trusted Review Intake** before human or AI review
- npm package: `@ahoooooo/reviewready`
- Machine-readable policy: [public-baseline.json](public-baseline.json)

## Stable published coordinates

The current stable coordinate set is v1.0.13:

| Surface                | Coordinate                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| Source commit          | `8c889b17b19e62988025401470a08b880fd74ef5`                                                 |
| Immutable semantic tag | `v1.0.13`                                                                                  |
| Stable Action tag      | `v1`                                                                                       |
| npm latest             | `@ahoooooo/reviewready@1.0.13`                                                             |
| Immutable Action pin   | `ahoooooooo/reviewready@8c889b17b19e62988025401470a08b880fd74ef5`                          |
| Immutable schema URL   | `https://raw.githubusercontent.com/ahoooooooo/reviewready/v1.0.13/reviewready.schema.json` |
| Release evidence       | [v1.0.13 evidence](release-evidence-v1.0.13.md) and [JSON](release-evidence-v1.0.13.json)  |

The semantic tag, release object, npm artifact, stable `v1` ref, and release
evidence are immutable release surfaces. They are verified together by the
release process; a later documentation commit does not move them.

## Source versus published artifact

`main` is currently a release-candidate baseline for v1.0.14. The candidate is
not yet published and its package manifest is intentionally ahead of npm
latest. Therefore:

- a `main` checkout is not automatically the published v1.0.14 tarball;
- the package manifest is 1.0.14 while npm latest remains the stable 1.0.13
  release until the protected workflow completes;
- a new release must build, audit, publish, and record one exact artifact; and
- source, generated `dist`, package privacy, and release evidence are checked by
  `verify:public-baseline`, `verify:dist`, `verify:package`, and
  `release:preflight`.

The candidate status is an explicit transition state, not a rewrite of release
history. After publication, the baseline is updated with the actual source
commit, artifact hashes, registry coordinates, and release refs.

## Capability and authority

The shipped Action is an advisory, read-only evidence evaluator. The shipped
CLI is local and deterministic, with bounded read-only GitHub collection only
when the caller names an environment variable. The npm surface supports the
CLI entry point and versioned schemas; bundled App, webhook, and ingress code
does not constitute a hosted provider or a supported provider SDK.

No production GitHub App, durable external enforcement service, provider
conformance ecosystem, or external pilot is shipped or implied. A successful
named check is evidence output, not unique issuer identity or merge
authorization.

## Live project truth

Backlog, branches, pull requests, review state, commit verification, and release
freshness change on GitHub. Use the live [issues](https://github.com/ahoooooooo/reviewready/issues),
[pull requests](https://github.com/ahoooooooo/reviewready/pulls),
[branches](https://github.com/ahoooooooo/reviewready/branches),
[main commits](https://github.com/ahoooooooo/reviewready/commits/main), and
[releases](https://github.com/ahoooooooo/reviewready/releases) pages instead of
relying on frozen counts in documentation.

## Public-surface boundary

The public tree and npm archive contain product source, generated Action output,
schemas, tests, and intentional product documentation. Parent-agent controls,
the live Handoff, raw control/review evidence, private research, credentials,
profiles, sessions, and other secret material remain local-only and are checked
by the repository ignore and package privacy gates.
