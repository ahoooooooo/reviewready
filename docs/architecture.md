# Architecture and trust boundaries

## Modules

1. `policy`: parses YAML and validates a closed, versioned schema.
2. `domain`: policy, pull-request, evidence, and result types.
3. `matcher`: selects every rule triggered by normalized PR data.
4. `engine`: evaluates requirements without I/O or platform knowledge.
5. `report`: renders versioned JSON, terminal text, and Markdown.
6. `github`: fetches base policy and normalizes GitHub event/API data.
   `github-api` is the isolated Octokit transport implementation.
7. `cli` and `action`: thin entry points that translate errors to public outputs.

Dependencies point inward: entry points -> adapters/report -> engine -> domain.
The engine must never import GitHub, filesystem, process, or Actions modules.

## Trust model

Trusted inputs and execution components:

- a verified Action bundle pinned by the adopter;
- the workflow definition that invokes the Action;
- the Action pin, `policy-path`, job graph, event selection, and permissions defined
  by that workflow;
- policy bytes fetched for the event's base SHA as the repository's authoritative
  policy, while their syntax and resource bounds remain validated;
- repository owner/name and API endpoint derived from the event environment.

Untrusted inputs:

- the entire event payload;
- changed paths, titles, bodies, labels, reviewers, and check names;
- API responses and local fixture files;
- pull-request code and workflow changes proposed by the pull request.

The system validates boundaries, never executes evidence input, and should render
untrusted strings as data. `ready` is informational unless the adopter separately
establishes a trusted enforcement root and configures the result as required.

## Workflow bootstrap boundary

Fetching policy bytes from the base SHA prevents a pull request from replacing the
policy **contents** used by the evaluator. It does not protect the workflow that
selects the policy path and invokes the Action.

GitHub loads ordinary `pull_request` and `pull_request_review` workflow versions
from the pull-request merge ref. A contribution can therefore propose changes to
the Action pin, input path, permissions, job dependencies, or even the job that
reports a required check. Required status checks match job/check names and may pin
the GitHub App, but that does not identify an immutable workflow definition.

Issue #35 tracks the supported trusted topology. Candidate roots include an
organization ruleset-required workflow selected by repository/ref/SHA,
independently protected workflow and policy files, or a metadata-only
`pull_request_target` workflow from the base branch. A trusted
`pull_request_target` design must not check out, download, import, cache, build, or
execute pull-request code. Untrusted build and test CI remains on `pull_request`
with fork-safe permissions.

Review-submitted events require a separate design decision because
`pull_request_review` also uses the pull-request merge ref, while
`pull_request_target` has no review-submitted activity type. Approval freshness may
need to remain a GitHub branch-rule responsibility or use another authenticated,
trusted reconciliation path.

## Evidence collection

The Action supports `pull_request` and `pull_request_review` event payload shapes at
runtime. That runtime support does not by itself make every caller workflow
trusted. Review events may be submitted, edited, or dismissed; the adapter uses
review timestamps when GitHub provides them. A workflow that requires other checks
must schedule ReviewReady after those jobs; incomplete checks do not count as
evidence.

The GitHub adapter combines Check Runs with terminal commit statuses and uses
explicit bounds for several API collections. The intended invariant is to fail
closed whenever authoritative evidence completeness cannot be proven. Current gaps
at GitHub's exact Check Runs cap, latest-run selection, and legacy status pagination
are tracked in issues #4, #34, and #14.

`merge_group` is intentionally unsupported because its payload does not contain
enough per-pull-request evidence to evaluate the v1 policy safely.

## Compatibility boundary

`outputVersion` identifies the public JSON result contract used by CLI `--json` and
the Action's `report-json` output. Internal map keys, parser representations, or
adapter implementation details must not change public fields without an explicit
compatibility decision. The v1.0.3 requirement-key drift is tracked in issue #25.

## Error model

- `PolicyError`: invalid YAML, schema, semantics, or unsupported policy version.
- `InputError`: malformed normalized input or unsafe repository path.
- `PlatformError`: event or GitHub API failure.
- Unexpected defects are reported without tokens, response bodies, or stack traces
  in default user-facing output.

Every public error should have a stable code and actionable, safely rendered
message.
