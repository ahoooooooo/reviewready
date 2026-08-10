# Security policy

## Supported versions

ReviewReady provides security fixes for the latest published v1.x release and for
the current `main` branch. Fixes are not backported to every earlier patch release;
users may be required to upgrade.

| Version            | Supported               |
| ------------------ | ----------------------- |
| Latest v1.x        | Yes                     |
| Earlier v1.x       | Upgrade may be required |
| Earlier than 1.0.0 | No                      |

The mutable `v1` Action tag is a convenience pointer, not an immutable security
boundary. High-assurance users should pin a verified release commit and use update
automation.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use the repository's
private vulnerability reporting form. If private reporting is unavailable, contact
the repository owner through the maintainer contact shown on the GitHub profile.

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
- malformed or missing authoritative evidence fails closed;
- user-facing failures redact unexpected exception details;
- Markdown output escapes policy-derived text.

## Known limitations

- A mutable major Action tag is convenient but weaker than a full commit SHA.
  High-assurance adopters should pin the release commit and use update automation.
- A successful named check proves only that GitHub recorded that conclusion; it
  does not prove the check itself is trustworthy. Restrict app identity where it
  matters and protect workflow changes separately.
- `linked_issue` currently uses GitHub closing issue references, not every possible
  textual or sidebar relationship.
- Repository permissions are evaluated at Action run time. Organization role
  changes can therefore change later evaluations.
- `maintainer_review` uses the latest review state returned by GitHub but does not
  bind an approval to the current head commit. Repositories that require fresh
  review after every push should enable GitHub's stale-approval dismissal or an
  equivalent branch-protection rule.
- GitHub caps pull-request file responses at 3,000 files and the Check Runs endpoint
  at the 1,000 most recent check suites for a ref. Completeness at the exact Check
  Runs boundary cannot currently be proven by requesting another page; this is
  tracked in issue #4.
- Legacy commit statuses are not yet explicitly paginated, so repositories with
  many status contexts can receive incomplete evidence. This is tracked in issue
  #14.
- The current PR-body parser does not yet model every invisible Markdown region or
  nested section boundary. HTML comments and related cases are tracked in issue
  #12.
- Renamed files currently contribute only their new path to matching. Policies that
  must protect the old path of a rename should track issue #13 before relying on
  this behavior as a security boundary.
- `merge_group` is not supported by the v1 Action. Its synthetic commit does not
  carry a complete per-PR body, review, and issue context, so enabling it without
  an explicit aggregator would weaken the readiness guarantee.
- Readiness is evidence presence, never correctness, safety, or approval.
