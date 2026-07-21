# Positioning and adjacent tools

ReviewReady is not the only tool concerned with pull requests before human review.
Its narrower distinction is repository-owned, change-specific evidence policy.

ReviewGate evaluates general PR shape with built-in heuristics such as size,
description strength, risky paths, mixed concerns, and splitability. ReviewReady
instead lets a repository state deterministic obligations for matching path and
label classes: exact CI conclusions, body sections, closing issues, accountable
human attestations, and permission-verified reviews.

Completion gates answer whether an agent finished its task. Repository-readiness
linters assess whether an entire repository is prepared for agents. ReviewReady
answers whether one contribution has the evidence that this target repository
requires before review.

These categories can coexist. ReviewReady should integrate trustworthy external
evidence rather than reimplement code review, PR-size heuristics, test runners,
provenance scanners, or agent execution.

No claim of Agent Governance Manifest compatibility should be made until a stable
public interoperability contract exists and has been tested with its authors.
