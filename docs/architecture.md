# Architecture and trust boundaries

## Modules

1. `policy`: parses YAML and validates a closed, versioned schema.
2. `domain`: stable policy, pull-request, evidence, and result types.
3. `matcher`: selects every rule triggered by normalized PR data.
4. `engine`: evaluates requirements without I/O or platform knowledge.
5. `report`: renders stable JSON, terminal text, and Markdown.
6. `github`: fetches base policy and normalizes GitHub event/API data.
   `github-api` is the isolated Octokit transport implementation.
7. `cli` and `action`: thin entry points that translate errors to public outputs.

Dependencies point inward: entry points -> adapters/report -> engine -> domain.
The engine must never import GitHub, filesystem, process, or Actions modules.

## Trust model

Trusted inputs:

- code and bundled dependencies pinned by an adopter;
- policy bytes fetched for the event's base SHA;
- repository owner/name and API endpoint derived from the event environment.

Untrusted inputs:

- the entire event payload;
- changed paths, titles, bodies, labels, reviewers, and check names;
- API responses and local fixture files.

The system validates every boundary, never executes input, and renders untrusted
strings as data. `ready` is informational unless the adopter separately configures
the job as a required status check.

The Action supports `pull_request` and `pull_request_review` events. A workflow
that requires other checks must schedule ReviewReady after those jobs; incomplete
checks do not count as evidence.

## Error model

- `PolicyError`: invalid YAML, schema, semantics, or unsupported policy version.
- `InputError`: malformed normalized input or unsafe repository path.
- `PlatformError`: event or GitHub API failure.
- Unexpected defects are reported without tokens, response bodies, or stack traces
  in default user-facing output.

Every public error has a stable code and actionable message.
