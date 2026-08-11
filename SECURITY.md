# Security policy

## Supported versions

Security fixes are provided for the latest v1 release. Until v1 is publicly
tagged, only the current main branch is supported.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. After the GitHub
repository is published, use its private security-advisory reporting form. If
private reporting is not enabled, contact the repository owner through the
security contact listed in the GitHub profile.

Include the affected version, a minimal reproduction, impact, and any suggested
mitigation. Do not include real tokens, private repository content, or third-party
personal data.

## Threat model

The main assets are repository policy integrity, GitHub tokens, private pull
request metadata, and the credibility of the readiness result.

ReviewReady assumes its released Action bundle and the target repository's base
commit are trusted. It treats event payloads, PR bodies, labels, paths, reviewers,
check names, local JSON fixtures, and API responses as untrusted.

Security invariants:

- policy is fetched by immutable base SHA;
- no PR code, commands, expressions, modules, or configuration are executed;
- only read-only GitHub permissions are requested;
- path traversal and absolute paths are rejected;
- policy and input sizes are bounded;
- malformed or missing evidence fails closed;
- a current pull-request snapshot must remain stable while evidence is
  collected;
- a newer failed or pending check/status cannot be masked by an older success;
- user-facing failures redact unexpected exception details;
- Markdown output escapes policy-derived text.

## Known limitations

- A mutable major Action tag is convenient but weaker than a full commit SHA.
  High-assurance adopters should pin the release commit and use update automation.
- A successful named check proves only that GitHub recorded that conclusion; it
  does not prove the check itself is trustworthy. Restrict app where identity
  matters and protect workflow changes separately. The ordinary pull_request
  sample workflow is advisory until a trusted workflow root is protected and
  required in repository settings.
- linked_issue currently uses GitHub closing issue references, not every possible
  textual or sidebar relationship.
- Repository permissions are evaluated at Action run time. Organization role
  changes can therefore change later evaluations.
- GitHub APIs cap pull-request files at 3,000 and check runs at the 1,000 most
  recent suites for a ref. ReviewReady rejects responses at or beyond its safe
  boundary, and rejects closing-issue pagination, rather than evaluating
  incomplete evidence.
- `merge_group` is not supported by the v1 Action. Its synthetic commit does
  not carry a complete per-PR body/review/issue context, so enabling it without
  an explicit aggregator would weaken the readiness guarantee.
- Readiness is evidence presence, never correctness, safety, or approval.

The repository audit is read-only and separate from readiness. Its normalized
snapshot, finding count, workflow source, paths, and provider identities are
bounded; rulesets are evaluated only when their target/ref scope covers the
evaluated default branch and repository; malformed, missing, contradictory,
stale, redacted, or over-limit settings are reported as incomplete or failed.
The live collector reads policy and workflow source at one immutable base SHA,
rechecks the branch revision, and requires explicit protected/trusted workflow
roots supplied out of band. Audit output is not an approval and does not claim
that repository code is safe.

The static AI-workflow analyzer treats workflow source as data. It never runs a
workflow, evaluates expressions, invokes an LLM, resolves secrets, or executes
a shell command. Prompt injection, code execution, capability exposure, and
provenance findings remain distinct. SARIF is an additional report format, not
a replacement for the stable readiness JSON contract.

Webhook HMAC verification is only a pure ingress primitive: callers must pass
the exact raw request bytes, use an external durable store that atomically
claims both delivery and body-replay namespaces, enforce freshness, and bind
delivery, pull number, base/head SHA, policy revision, and trusted workflow
identity. The App JWT/token helpers validate bounded credentials and responses,
but no HTTP service, secret manager, durable store, or deployment is included.
