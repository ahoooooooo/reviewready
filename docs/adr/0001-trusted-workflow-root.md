# ADR 0001: trusted workflow root for authoritative readiness

## Status

Accepted. The repository carries a staged metadata-only reference workflow at
.github/workflows/reviewready-trusted.yml. Until v1.0.6 is published, the file
uses the v1.0.5 bootstrap pin; the v1.0.6 candidate adds the required
pull_request_target support. The workflow is not authoritative until the pin
is updated to the exact verified v1.0.6 commit and GitHub branch protection,
rulesets, and workflow-file protection are independently configured and
verified.

## Context

ReviewReady loads the effective policy from the pull request base revision and
never executes pull request code. That protects policy data, but it does not
make an ordinary pull_request caller workflow trustworthy. A pull request can
propose changes to its workflow, action reference, policy-path input, job graph,
permissions, or a same-name check. GitHub required-check names do not by
themselves prove which immutable workflow produced the result.

The sample workflow remains useful as an advisory integration. It must not be
described as the only authoritative merge gate until the workflow root and
repository rules are protected separately.

## Decision

The authoritative integration must have a trusted root stored on the protected
base branch. It must:

1. run from a trusted workflow revision and use an immutable ReviewReady Action
   reference;
2. avoid checking out, downloading, building, importing, caching, or executing
   pull request content;
3. request read-only permissions only;
4. bind the evaluation to the current pull request number, base SHA, head SHA,
   body, label set, and a reliable freshness marker such as updated_at;
5. collect policy and all evidence for one snapshot, re-check the identity
   after collection, and retry once or fail closed if it changed;
6. publish a uniquely identified required result whose implementation cannot be
   replaced by a pull request workflow with the same display name.

The ordinary pull_request workflow remains the place for untrusted project CI.
ReviewReady may consume the results of those jobs, but the trusted root must not
execute that workflow's code while evaluating readiness.

For a personal repository, the viable topology is a base-branch-controlled
metadata-only trigger such as pull_request_target, or an equivalent protected
ruleset-required workflow. The exact GitHub topology and permissions must be
validated in the repository settings before it is made authoritative. A
pull_request_target workflow must never checkout or run the pull request head.

## Alternatives considered

### Keep the ordinary pull_request workflow as the required gate

Rejected. The workflow file and its action inputs can be changed by the
contribution being evaluated, so the check is not an immutable authority.

### Use pull_request_target and checkout the pull request

Rejected. This would put untrusted pull request code in a privileged event
context and violates ReviewReady's trust boundary.

### Trust the display name of a required check

Rejected. A same-name job can spoof a required check unless the protected
workflow identity and result binding are independently enforced.

### Solve the problem only with Actions concurrency

Rejected. Concurrency can reduce stale runs, but it is not a correctness proof
that a completed result belongs to the current base/head and policy snapshot.

## Required follow-up verification

The following are repository settings and operational checks, not claims made by
local source code:

- the trusted workflow file is protected from pull request modification;
- the required check is attached to the trusted workflow/job identity;
- workflow and policy changes invalidate prior readiness results;
- force pushes and branch deletion are restricted as appropriate;
- the Action reference and any policy path are immutable or base-bound;
- pull_request CI remains read-only and untrusted;
- review submitted, edited, and dismissed events trigger a trusted
  reevaluation.

Until those checks are confirmed in GitHub, README and SECURITY wording should
call the normal workflow advisory rather than authoritative.
