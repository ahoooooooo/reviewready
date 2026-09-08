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

The last verified stable coordinate set recorded here is v1.0.15. The `v1` and
npm `latest` rows describe that publication observation; consult GitHub and npm
for their live targets:

| Surface                | Coordinate                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| Source commit          | `53c1c679387ad4005e07a5350609cca302d882d4`                                                 |
| Immutable semantic tag | `v1.0.15`                                                                                  |
| Stable Action tag      | `v1`                                                                                       |
| npm latest             | `@ahoooooo/reviewready@1.0.15`                                                             |
| Immutable Action pin   | `ahoooooooo/reviewready@53c1c679387ad4005e07a5350609cca302d882d4`                          |
| Immutable schema URL   | `https://raw.githubusercontent.com/ahoooooooo/reviewready/v1.0.15/reviewready.schema.json` |
| Release evidence       | [v1.0.15 evidence](release-evidence-v1.0.15.md) and [JSON](release-evidence-v1.0.15.json)  |

The fixed source commit, immutable semantic tag, published npm package, and
historical release evidence identify one publication. The release process also
verifies the mutable `v1` alias and npm `latest` tag at publication time. Later
releases may update those aliases after verification; later documentation commits
do not rewrite historical package bytes, tags, or observations.

## Reference policy

| Surface               | Policy                                        |
| --------------------- | --------------------------------------------- |
| Full commit SHA       | Fixed source revision                         |
| `vX.Y.Z`              | Immutable release tag                         |
| Published npm version | Immutable package                             |
| `v1`                  | Mutable alias updated only after verification |
| npm latest            | Mutable registry tag                          |
| Release evidence      | Historical publication observation            |

A full commit SHA fixes source identity. A semantic-version tag and published
package must not be moved, overwritten, or reused. Release evidence records
what was verified for that publication; it does not promise that a mutable alias
will retain that target forever.

## Source versus published artifact

The public consistency baseline recorded in sourcePolicy.completedMilestone is
complete. It covered existing documentation and checks, revalidation of #121 then
#129 then #130 on updated bases, package/Action/PR acceptance, and the v1.0.15
patch release. New capabilities, App/SDK hosting, a new protocol version, and
large refactors remained outside that release scope.

The machine-readable mainStatus distinguishes post-release development from
release-candidate preparation. Either source state may be ahead of the verified
stable artifact because documentation, dependency, or other unreleased changes
can be merged before publication. Therefore:

- a `main` checkout is not automatically the published v1.0.15 tarball;
- the package manifest remains at the last published version until release
  preparation selects a new unused version;
- a new release must build, audit, publish, and record one exact artifact; and
- source, generated `dist`, package privacy, and release evidence are checked by
  `verify:public-baseline`, `verify:dist`, `verify:package`, and
  `release:preflight`.

Before packing a candidate, its README package version must match the package
manifest. Verified Action and schema examples may retain the last verified
stable release while a candidate is prepared, and are labeled separately from
the candidate package version. The baseline's stable coordinates advance only
after publication evidence exists. A candidate does not embed its own future
commit SHA; the release evidence binds the actual source commit and artifact.

This is an explicit status distinction, not a rewrite of release history. The
published source commit, artifact hashes, registry coordinates, and observed release refs
are recorded in the v1.0.15 evidence file; later documentation commits do not
rewrite that historical record.

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

| Capability  | Status      | Authority                              |
| ----------- | ----------- | -------------------------------------- |
| action      | shipped     | advisory                               |
| cli         | shipped     | local and read-only                    |
| library     | shipped     | not a provider or merge authority      |
| githubApp   | not-shipped | no production hosted enforcement       |
| providerSdk | not-shipped | no public provider conformance surface |

The checked-in workflow is displayed as **ReviewReady trusted evidence** and
keeps its `readiness` check identity. Its bounded wait does not subscribe to
later CI reruns: a CI-only rerun after readiness completes requires a manual
trusted-workflow rerun once CI finishes. Configured PR events cover new commits
and body edits; the resulting check must match the current head and metadata.

## Live project truth

Backlog, branches, pull requests, review state, commit verification, and release
freshness change on GitHub. Use the live [issues](https://github.com/ahoooooooo/reviewready/issues),
[pull requests](https://github.com/ahoooooooo/reviewready/pulls),
[branches](https://github.com/ahoooooooo/reviewready/branches),
[main commits](https://github.com/ahoooooooo/reviewready/commits/main), and
[releases](https://github.com/ahoooooooo/reviewready/releases) pages instead of
relying on frozen counts in documentation.

## Public-surface boundary

The public repository contains product source, generated Action output, schemas,
tests, and intentional product documentation. The npm allowlist ships the CLI
runtime, declarations and source maps, schemas, README, and license; repository
`docs/` and `fixtures/` are not installed. README links to those documents use
explicit GitHub URLs, and fixture commands are labeled as requiring a checkout.
Parent-agent controls,
the live Handoff, raw control/review evidence, private research, credentials,
profiles, sessions, and other secret material remain local-only and are checked
by the repository ignore and package privacy gates.
