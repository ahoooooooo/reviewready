# ReviewReady roadmap

This roadmap is the canonical view of current product priorities. Historical
delivery details remain in `docs/exec-plans/completed/`; GitHub issues own
single-outcome implementation work.

## Product direction

ReviewReady stays deliberately narrow: it is a deterministic evidence gate that
answers whether a pull request contains the repository-defined evidence needed
to begin human review. It is not a general AI reviewer, correctness oracle, or
merge authority.

The project optimizes for:

1. trustworthy, fail-closed evidence evaluation;
2. a low-friction first successful run;
3. reproducible security and release evidence;
4. maintainability for contributors; and
5. honest proof of use outside this repository.

## Current baseline

- Stable release: `v1.0.11`.
- Verified release commit:
  `e9cd421ac106adb5731dd22b714701a136e937f8`.
- npm provenance, immutable release tag, stable `v1` Action ref, Marketplace
  listing, and clean-install smoke are recorded in
  `docs/release-evidence-v1.0.11.md` and its JSON companion.
- The v1 readiness contract, trusted-workflow reference, repository audit,
  replayable evidence bundle, and local GitHub App ingress primitives exist.
- No hosted ReviewReady service or production GitHub App is currently offered.
- Marketplace availability and self-use are not evidence of external adoption.

## Now: make the released core easy to adopt

The next internal work should reduce the distance between discovering the
project and obtaining a truthful first result:

- keep README, security guidance, examples, and release coordinates synchronized;
- release and document the source-implemented initialization and offline demo
  commands in the next minor version without weakening their no-overwrite boundary;
- publish a small sample repository or fixture-backed walkthrough with expected
  ready and not-ready output;
- add concise maintainer, support, ownership, and contribution paths;
- keep dependency, static-analysis, and supply-chain checks reproducible and
  least-privileged; and
- split oversized audit and GitHub API modules along existing contract boundaries
  without changing public behavior.

Each change requires its own issue or pull request, focused regression coverage,
the full repository gate, and artifact parity checks when generated output moves.

## Next: prove usefulness with an external pilot

Issue [#61](https://github.com/ahoooooooo/reviewready/issues/61) is the highest
priority external-evidence milestone. A pilot must be opt-in and run only with
the target maintainer's consent.

The pilot should record sanitized, reproducible evidence:

- repository and policy class;
- ReviewReady version and immutable Action pin;
- setup time and removal path;
- ready/not-ready outcomes and the reason for each;
- false positives, false negatives, and operational friction; and
- maintainer feedback that is explicitly approved for publication.

One consenting pilot is evidence of one pilot, not broad adoption. Missing
consent or usage data remains an external dependency and must never be replaced
with generated testimonials or inflated metrics.

## Conditional: hosted provider authority

Issues [#78](https://github.com/ahoooooooo/reviewready/issues/78) and
[#79](https://github.com/ahoooooooo/reviewready/issues/79) cover a production
GitHub App and external enforcement evidence. This work is intentionally
conditional on adopter demand because it adds hosting, secrets, persistence,
operations, privacy, and incident-response obligations.

Before implementation, the design must define least privilege, installation and
repository identity, replay protection, durable storage, bounded retries,
observability, deletion, incident handling, and a sustainable operator. Local
ingress primitives do not by themselves prove a production service exists.

## Versioning and promotion

- Patch releases contain backward-compatible fixes and documentation or packaging
  corrections only.
- New user-visible functionality targets the next minor release (`v1.1.0` or
  later), with compatibility tests and migration notes where needed.
- Protected-branch merges, releases, tag movement, publishing, ruleset changes,
  deployments, and credentials require their explicit promotion authorization.
- Technical completion, public release, external authority, and adoption are
  separate evidence levels; none implies another.

## How priorities change

A priority changes only when new product evidence, a security finding, or an
adopter need materially changes the decision. Update this file in the same
focused change, link the owning issue, and preserve completed execution history
instead of rewriting it as current work.
