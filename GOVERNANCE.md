# Governance

ReviewReady is a maintainer-led open-source project. This document explains how
technical decisions, project roles, and repository authority are managed. It
does not replace GitHub's branch rules or grant access by itself.

## Principles

- Preserve deterministic, fail-closed readiness behavior and the trust boundaries
  in `docs/product-spec.md` and `docs/architecture.md`.
- Prefer public, reversible, evidence-backed decisions.
- Keep one observable outcome per issue and pull request.
- Separate implementation, release, external authority, and adoption claims.
- Apply the same review standard to human- and AI-assisted contributions.

## Roles

Contributors may open issues and pull requests, review public changes, and help
other users. A merged contribution does not automatically grant repository or
release access.

Maintainers are listed in [MAINTAINERS.md](MAINTAINERS.md). They triage work,
review and merge changes, steward the product contract, handle conduct and
security reports, and protect release credentials and repository settings.

The release steward is the maintainer performing a particular release. That
role is temporary and must follow `docs/releasing.md`; it does not allow the
release gate to be bypassed.

## Decisions

Routine, backward-compatible changes are decided through issue and pull-request
review. The maintainer seeks consensus, but may make the final decision when
reasonable alternatives remain and must explain the product or trust-boundary
reason in public.

Changes to the public schema, output format, authority model, permissions,
release process, or governance require an issue or ADR before implementation.
Security-sensitive details may be handled privately until coordinated disclosure
is safe.

## Becoming a maintainer

Maintainer access is earned through sustained, constructive work rather than a
fixed contribution count. A candidate should demonstrate:

- sound judgment at ReviewReady's trust boundaries;
- reliable reviews and follow-through;
- respect for compatibility, evidence quality, and the code of conduct; and
- willingness to share maintenance, security, and release responsibilities.

An existing maintainer nominates the candidate in a public issue or pull request
unless security or privacy requires a private discussion. Repository access is
granted only after the responsibilities and scope are accepted explicitly.

## Inactivity, removal, and succession

A maintainer may step down at any time. Access may be reduced after sustained
inactivity, a security need, or a documented code-of-conduct violation. Whenever
practical, the project records the role change and transfers open release,
security, and infrastructure responsibilities before removing access.

The project currently has a single active maintainer, which is a visible
continuity risk. The preferred mitigation is to earn additional maintainers
through real collaboration, keep releases reproducible, minimize credential
scope, and document project authority. Contributor or adoption evidence must
never be manufactured to make this risk appear smaller.

## Project spaces and conduct

Contributors must follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Usage support
belongs in the channels described by [SUPPORT.md](SUPPORT.md), and suspected
vulnerabilities must follow [SECURITY.md](SECURITY.md). Governance changes use
the normal pull-request process and require maintainer review.
