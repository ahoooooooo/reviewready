# ReviewReady

[![CI](https://github.com/ahoooooooo/reviewready/actions/workflows/ci.yml/badge.svg)](https://github.com/ahoooooooo/reviewready/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/%40ahoooooo%2Freviewready.svg)](https://www.npmjs.com/package/@ahoooooo/reviewready)
[![npm downloads](https://img.shields.io/npm/dm/%40ahoooooo%2Freviewready.svg)](https://www.npmjs.com/package/@ahoooooo/reviewready)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

ReviewReady is a deterministic evidence gate for pull requests. A repository
declares what must be present before a particular kind of change consumes human
review time; ReviewReady reports what is verified and what is still missing.

It answers one narrow question:

> Does this pull request contain the evidence required to begin human review?

It does **not** review code, establish correctness, detect AI authorship, approve,
or merge. There are no model calls, hosted service, database, or execution of
pull-request code.

## Current status

The published CLI and Action are available for evaluation and advisory workflows.
Do not treat v1.0.3 as the sole authoritative merge gate until the open P0
correctness and workflow-root issues are resolved. In particular, a normal
`pull_request` workflow is loaded from the pull-request merge ref and can be
modified by the contribution it evaluates. Loading policy contents from the base
SHA does not by itself protect the caller workflow, Action pin, or `policy-path`.

Issue [#35](https://github.com/ahoooooooo/reviewready/issues/35) tracks the trusted
enforcement topology. [SECURITY.md](SECURITY.md) lists the other current evidence
boundary limitations. Existing immutable release tags will not be rewritten;
corrections belong in a new patch release.

## Quick start

Install the CLI from npm. Node.js 22 or newer is required:

```console
npm install --global @ahoooooo/reviewready
reviewready validate --policy .reviewready.yml
```

The Action can also be used in an advisory workflow:

```yaml
- uses: ahooooooo/reviewready@14147f5d2084999065145f657ca36ac743e6151f # v1.0.3
```

The mutable `v1` tag is convenient, but an immutable verified commit is safer.
The advisory workflow below must not be configured as the repository's only
trusted merge authority unless its workflow and policy selection are protected by
an independent repository or organization rule.

Version 1 intends to keep the policy, result, and exit-code contracts stable.
A v1.0.3 public JSON key-format regression is documented in issue
[#25](https://github.com/ahoooooooo/reviewready/issues/25) and will be repaired
without rewriting the existing release.

## How it works

The target repository owns a `.reviewready.yml` policy on its base branch:

```yaml
# yaml-language-server: $schema=./reviewready.schema.json
version: 1
rules:
  - id: source-change
    when:
      paths:
        any: ["src/**"]
    require:
      - type: pr_body_section
        heading: Testing
      - type: linked_issue
      - type: check
        name: test
        app: github-actions
        conclusions: [success]
      - type: human_attestation
        text: I understand and take responsibility for this change.

  - id: workflow-change
    when:
      paths:
        any: [".github/workflows/**"]
    require:
      - type: pr_body_section
        heading: Risk
```

All matching rules apply. Equivalent requirements are checked once and attributed
to every rule that requested them.

On GitHub, the Action fetches policy bytes from the pull request's immutable base
SHA, then reads changed paths, checks, closing issue references, and reviews
through read-only APIs. The policy content proposed by the pull request is not
used. The workflow that invokes the Action is a separate trust boundary and must
also be protected for authoritative enforcement.

### Editor schema

The npm package includes `reviewready.schema.json`. A repository that installs the
package as a development dependency can reference it directly:

```yaml
# yaml-language-server: $schema=./node_modules/@ahoooooo/reviewready/reviewready.schema.json
```

Action-only repositories can copy the schema into the repository or reference an
immutable release URL:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/ahoooooooo/reviewready/v1.0.3/reviewready.schema.json
```

Keep the schema version aligned with the Action or CLI version being used. A local
relative schema is preferable when editor access to remote URLs is restricted.

## GitHub Action

### Advisory integration

The following workflow is useful for evaluation. It runs tests on the pull-request
merge ref and evaluates metadata with least-privilege job permissions. Because a
`pull_request` workflow version comes from that merge ref, a pull request can also
propose changes to this workflow. Protect the workflow and policy selection
independently before relying on its result for enforcement.

```yaml
name: review-ready-advisory

on:
  pull_request:
    types: [opened, synchronize, edited, reopened, labeled, unlabeled, ready_for_review]

jobs:
  test:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - run: npm ci
      - run: npm test

  reviewready:
    if: always()
    needs: [test]
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: read
      checks: read
      statuses: read
      issues: read
    steps:
      - uses: ahooooooo/reviewready@14147f5d2084999065145f657ca36ac743e6151f # v1.0.3
```

Replace the example test commands with the target repository's own verification.
When a policy requires another check, schedule ReviewReady after that job with
`needs`; otherwise the required check may still be pending and cannot count as
evidence. Specify the expected GitHub App in the policy where provider identity
matters.

### Authoritative enforcement

A trusted deployment needs an enforcement workflow that the evaluated pull request
cannot rewrite. Depending on repository ownership and available GitHub features,
that may involve:

- an organization ruleset that requires a selected workflow by source repository
  and immutable ref;
- repository rules that independently protect the ReviewReady workflow, policy,
  Action pin, and policy path;
- a metadata-only `pull_request_target` workflow from the trusted base branch with
  explicit read-only permissions and **no checkout, download, cache restore,
  build, import, or execution of pull-request code**;
- delegating approval freshness and required human review to GitHub branch rules
  when review events cannot be reconciled through a trusted workflow.

These choices have different availability and security tradeoffs. Issue #35 will
produce the supported reference topology for personal and organization-owned
repositories. Until then, do not present a pull-request-modifiable check as a
complete security boundary merely because its job name is required.

The Action writes a job summary and exports:

- `status`: `ready` or `not_ready`;
- `report-json`: the versioned deterministic result.

It fails the job when evidence is missing or cannot be loaded safely.

## CLI

After installing `reviewready` globally, or as a development dependency and
invoking it with `npx`, run:

```console
reviewready validate --policy fixtures/basic/.reviewready.yml
reviewready explain --policy fixtures/basic/.reviewready.yml
reviewready check --policy fixtures/basic/.reviewready.yml --input fixtures/basic/ready.json
```

Stable exit codes:

- `0`: policy valid or contribution ready;
- `1`: contribution not ready;
- `2`: invalid configuration, input, event, or runtime failure.

The local CLI consumes normalized JSON rather than contacting GitHub. This keeps
the engine reproducible and makes policies easy to test with fixtures.

## Policy reference

### Conditions

Each rule has paths, labels, or both. Each match set supports:

- `any`: at least one pattern or value must match;
- `all`: every pattern or value must match somewhere;
- `none`: no pattern or value may match.

Paths use repository-relative POSIX globs. Labels match case-insensitively.
Absolute paths, traversal, backslashes, empty path segments, and leading glob
negation are rejected.

### Requirements

- `pr_body_section`: a Markdown heading exists and has non-empty content.
- `linked_issue`: GitHub reports at least one closing issue reference.
- `check`: a completed check or commit status has the exact name, allowed
  conclusion, and optional GitHub App slug for Check Runs.
- `maintainer_review`: the latest qualifying maintainer opinion satisfies the
  configured minimum. Current review-state limitations are tracked in issue #32.
- `human_attestation`: the PR body contains the exact checked task-list text.

The full editor schema is [reviewready.schema.json](reviewready.schema.json). The
executable behavior is specified in [docs/product-spec.md](docs/product-spec.md).

ReviewReady v1 intentionally does not evaluate `merge_group`: GitHub's synthetic
merge commit does not carry a complete per-PR body, review, and closing-issue
context. Do not make the current check a merge-queue requirement without a
separate trustworthy aggregation design.

## Security model

- Policy bytes are fetched from the base SHA, never from the proposed head.
- The Action itself does not check out or execute pull-request code.
- A caller workflow is authoritative only when its definition, Action pin, inputs,
  and policy path are protected independently from the pull request.
- User-controlled text is escaped in Markdown summaries.
- Public errors omit stack traces, tokens, API response bodies, and local paths.
- Invalid or unavailable authoritative input fails closed.
- `pull_request` is fork-safe for running untrusted CI with a read-only token, but
  its workflow definition is not a trusted enforcement root.
- `pull_request_target` uses a trusted base workflow, but becomes dangerous if it
  checks out, downloads, imports, caches, or executes untrusted pull-request code.

See [SECURITY.md](SECURITY.md) and [docs/architecture.md](docs/architecture.md) for
the trust model and current known limitations.

## Development

```console
npm ci
npm run check
```

`npm run check` enforces formatting, strict linting, TypeScript types, coverage
thresholds, production build, package privacy checks, and the bundled JavaScript
Action. See [CONTRIBUTING.md](CONTRIBUTING.md) for the red/green/regression workflow.

## License

MIT. See [LICENSE](LICENSE).
