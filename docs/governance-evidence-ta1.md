# TA-1 live governance evidence

Status: **revision-bound evidence captured on 2026-08-13 (Asia/Taipei).**
This record is read-only evidence for TA-1. It is not a claim that the current
GitHub Actions check is a unique trusted provider, and it is not a readiness
result.

## Evidence coordinates

| Item                          | Observed value                                                                |
| ----------------------------- | ----------------------------------------------------------------------------- |
| Repository                    | ahooooooo/reviewready (public, not archived)                                  |
| Default branch                | main                                                                          |
| Default branch revision       | 6947c357d1c1af4688552f9c18211731a064c223                                      |
| Policy path                   | .reviewready.yml                                                              |
| Policy blob at main           | cfa77bd470502c903f3651443055acb677e241c8                                      |
| Trusted workflow path         | .github/workflows/reviewready-trusted.yml                                     |
| Trusted workflow blob at main | 3fc79adf20432100b0e697b822efa647b7d8bc28                                      |
| Action pin in that workflow   | ahoooooooo/reviewready@f21ed2e94efedb01f73e518c39765cef72c58e1c (v1.0.7)      |
| Ruleset                       | 19504404, Main branch protection, active, target branch, default-branch scope |

The branch, policy, workflow, and Action coordinates were collected from the
same live main revision. The policy is therefore bound to the base revision
for this record; no proposed-head policy or workflow bytes were used.

## Effective controls observed

The active ruleset reports:

- deletion and non-fast-forward updates blocked;
- pull requests required, with thread resolution required;
- strict required status checks;
- required contexts check and readiness, each expected from GitHub Actions
  App ID 15368;
- zero required approving reviews, stale-review dismissal disabled, and no
  bypass actors;
- no duplicate required-check context names in this ruleset.

The separate branch-protection REST endpoint returned 404 Branch not
protected. This is recorded as unavailable independent branch-protection
evidence, not converted into a pass; the active ruleset is the observed branch
control.

The Actions settings returned:

- Actions enabled;
- allowed actions all;
- default workflow token permissions read;
- pull-request review approval by workflows disabled;
- SHA pinning not enforced by repository settings.

The trusted workflow itself is metadata-only. At the recorded blob it uses
pull_request_target, requests only contents: read, pull-requests: read,
checks: read, statuses: read, and issues: read, and invokes the
commit-pinned Action with the base policy path. It does not checkout, download,
restore a cache, build, import, or execute pull-request code.

## Explicit limitations

GitHub Actions App ID 15368 identifies the provider class, but the required
check context does not uniquely bind a workflow definition, job, or event.
Therefore the current check/readiness requirement is **advisory for unique
workflow provenance**. A pull request cannot change the workflow bytes used by
the current pull_request_target base workflow during its evaluation, but the
repository does not yet have an independent provider identity that proves the
workflow root and result authority.

The legacy tag-protection endpoint returned 404, so no independent legacy tag
protection evidence is claimed. The v1.0.7 release exists and targets
f21ed2e94efedb01f73e518c39765cef72c58e1c, but its live immutable field is
false; historical release immutability is not rewritten. These are findings
for future release governance, not evidence of a stronger current control.

Any unavailable, contradictory, or incomplete setting above remains
incomplete/advisory; it cannot produce a pass or a readiness decision. The
dedicated provider/workflow-identity closure is TA-3 design issue
https://github.com/ahoooooooo/reviewready/issues/56.

## Collection provenance

This record was collected with read-only GitHub API calls for the repository,
default branch ref, ruleset list/details, Actions permissions, release/tag
coordinates, workflow list/content, and commit check runs. It contains no
token, secret, API response body, or private repository content.
