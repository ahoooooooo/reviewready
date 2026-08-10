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

Trusted inputs:

- code and bundled dependencies pinned by an adopter;
- policy bytes fetched for the event's base SHA as the repository's authoritative
  policy, while their syntax and resource bounds remain validated;
- repository owner/name and API endpoint derived from the event environment.

Untrusted inputs:

- the entire event payload;
- changed paths, titles, bodies, labels, reviewers, and check names;
- API responses and local fixture files.

The system validates boundaries, never executes input, and should render untrusted
strings as data. `ready` is informational unless the adopter separately configures
the job as a required status check.

The Action supports `pull_request` and `pull_request_review` events. Review events
may be submitted, edited, or dismissed; the adapter uses review timestamps when
GitHub provides them. A workflow that requires other checks must schedule
ReviewReady after those jobs; incomplete checks do not count as evidence.

The GitHub adapter combines completed Check Runs with terminal commit statuses and
uses explicit bounds for several API collections. The intended invariant is to
fail closed whenever authoritative evidence completeness cannot be proven. Current
known gaps at GitHub's exact Check Runs cap and legacy status pagination are tracked
in issues #4 and #14; they must not be described as fully resolved until their
regression tests cover the documented platform behavior.

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
