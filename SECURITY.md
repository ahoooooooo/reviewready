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
- user-facing failures redact unexpected exception details;
- Markdown output escapes policy-derived text.

## Known limitations

- A mutable major Action tag is convenient but weaker than a full commit SHA.
  High-assurance adopters should pin the release commit and use update automation.
- A successful named check proves only that GitHub recorded that conclusion; it
  does not prove the check itself is trustworthy. Restrict app where identity
  matters and protect workflow changes separately.
- linked_issue currently uses GitHub closing issue references, not every possible
  textual or sidebar relationship.
- Repository permissions are evaluated at Action run time. Organization role
  changes can therefore change later evaluations.
- GitHub APIs cap pull-request files at 3,000 and check runs at the 1,000 most
  recent suites for a ref. Oversized cases may need explicit future handling.
- Readiness is evidence presence, never correctness, safety, or approval.
