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

The last verified stable coordinate set recorded here is v1.0.16. The `v1` and
npm `latest` rows describe that publication observation; consult GitHub and npm
for their live targets:

| Surface                | Coordinate                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| Source commit          | `754bc035821b2ca89fe61c7db690e63a332c9526`                                                 |
| Immutable semantic tag | `v1.0.16`                                                                                  |
| Stable Action tag      | `v1`                                                                                       |
| npm latest             | `@ahoooooo/reviewready@1.0.16`                                                             |
| Immutable Action pin   | `ahoooooooo/reviewready@754bc035821b2ca89fe61c7db690e63a332c9526`                          |
| Immutable schema URL   | `https://raw.githubusercontent.com/ahoooooooo/reviewready/v1.0.16/reviewready.schema.json` |
| Release evidence       | [v1.0.16 evidence](release-evidence-v1.0.16.md) and [JSON](release-evidence-v1.0.16.json)  |

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

The v1.0.17 candidate closes three remaining baseline gaps: bounded raw HTML
recognition, reusable release-candidate validation, and exact Markdown link
target checks. New capabilities, App/SDK hosting, a new protocol version, and
large refactors remain outside this release scope.

The machine-readable mainStatus distinguishes post-release development from
release-candidate preparation. Either source state may be ahead of the verified
stable artifact because documentation, dependency, or other unreleased changes
can be merged before publication. Therefore:

- a `main` checkout is not automatically the published v1.0.16 tarball;
- this checkout is a v1.0.17 release candidate, not a published npm artifact;
- a new release must build, audit, publish, and record one exact artifact; and
- source, generated `dist`, package privacy, and release evidence are checked by
  `verify:public-baseline`, `verify:dist`, `verify:package`, and
  `release:preflight`.

Before packing a candidate, its README package version, semantic-version Action
examples, schema URLs, and version-bound product-document links must use the same
candidate version. The baseline's stable coordinates advance only after
publication evidence exists. A candidate does not embed its own future commit
SHA; the release evidence binds the actual source commit and artifact.

This is an explicit status distinction, not a rewrite of release history. The
published source commit, artifact hashes, registry coordinates, and observed release refs
are recorded in the v1.0.16 evidence file; later documentation commits do not
rewrite that historical record.

## TA-2 dogfood acceptance

Workflow run
[`34184361828`](https://github.com/ahoooooooo/reviewready/actions/runs/34184361828)
saved and independently replayed the artifact for revision
`704e0da930aca14ed1ee37ce7c2f3b95184f5fd4`. Artifact digest
`sha256:4e334e73be48d0dd97a2075661cd82304d04d09ffa9d5ea380bb9d6de9621335`
and review job `101929673227` are recorded in the machine-readable baseline.

The artifact and replay were internally consistent, so the review job succeeded.
The repository-audit report itself was `incomplete`, with
`settings-authority-incomplete` recorded as missing evidence. Replay integrity,
report completeness, repository-audit status, and milestone acceptance are
separate results; this observation is not an audit `pass`.

The 19 replayed findings were: four incomplete governance observations
(`AUDIT_BRANCH_PROTECTION_UNKNOWN`, `AUDIT_RULESET_BYPASS_UNKNOWN`,
`AUDIT_SNAPSHOT_INCOMPLETE`, and `AUDIT_TAG_PROTECTION_UNKNOWN`); six
`AUDIT_TRUSTED_ROOT_MISSING` and six `AUDIT_WORKFLOW_NOT_PROTECTED`
findings, one for each inspected workflow; and one each for
`DEPLOYMENT_SINK`, `PULL_REQUEST_TARGET_WORKFLOW`, and
`WORKFLOW_WRITE_PERMISSION`. These findings are preserved as the historical
result; the baseline correction does not suppress or reclassify them.

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
