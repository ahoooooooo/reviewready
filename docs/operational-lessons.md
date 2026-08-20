# Operational lessons and guardrails

This document records recurring development and integration failures that can
be prevented by a durable operating rule. It is an engineering aid, not a
readiness authority, a release permission, or a substitute for GitHub's
external controls. It must never contain credentials, tokens, or private
account data.

## Compact error capture

During a task, record non-critical failures in the current plan, PR, issue, or
task handoff before repairing them. Do not create an external record for a
one-off:

```text
Error | Evidence | Impact | Class | Next action | Status
```

Do not turn every transient or one-off failure into a permanent document. Promote
an error here only when it recurs, changes a trust/release decision, exposes a
process gap, or deserves a durable guard. P0 security, data-loss, corruption,
and required-gate blockers stop the current work; non-blocking errors are batched
after discovery.

## Authentication authority and repository targeting

Run `npm run auth:status` once before the first GitHub or npm provider
operation in a bounded external batch. Reuse its routing result only while the
provider authority, repository/package scope, network context, and credential
context remain unchanged. The command validates the canonical HTTPS remote,
Windows Git Credential Manager, and npm Trusted Publishing wiring locally. It
prints a machine-readable state, never an account name or credential, and
performs zero network requests.

Git fetch/push uses GCM. GitHub API work uses the explicitly approved connected
provider/browser channel and the repository selected by that channel. Do not
derive identity through GitHub CLI, type a remembered owner, or switch from an
unavailable connector to a different authentication channel. A missing connected
channel stops that external operation once; it does not start a login or retry
loop.

## Authentication status is channel- and context-bound

The Windows GCM store, a connected GitHub provider/browser session, the Codex
sandbox, and npm OIDC are separate contexts. The sandbox cannot read the
interactive Windows credential store. Therefore `connected_context_required`
or `context_unavailable` is not evidence that GitHub is logged out. The only
allowed response is to stop and use the connected context, with no same-context
retry and no GitHub CLI fallback.

npm is intentionally different again: local login is irrelevant. `ENEEDAUTH`
after logout is expected while the protected GitHub Actions OIDC Trusted
Publishing path remains the release authority. Do not run local login/whoami as
a health check, store a token, or turn a local npm session into a prerequisite.

## Bounded external lane and nested npm execution

Keep local inspection, edits, and tests in the sandbox. If the sandbox reports
`connected_context_required` or `context_unavailable`, stop sandbox
retries and route only the exact approved provider operation through a
connected/elevated context; return to the sandbox for local validation.

A direct child-process canary may pass while a nested npm/package smoke command
still receives Windows `ETIMEDOUT` or stalls on the sandbox user/cache
boundary. Record it once, retry the exact command at most once in an approved
elevated context with `REVIEWREADY_NPM_CACHE=.reviewready-npm-cache`, then
classify the result as environment-routed or environment-blocked. Do not change
product code, credentials, or global sandbox settings to hide the failure.

## Reviewer watchdog

A reviewer that stays running without a report is an execution-context failure,
not independent evidence. Give report-only reviewers one initial observation
window (60 seconds by default, 120 seconds only for a deliberately approved
long read), not a completion deadline. On each silent window expiry, record
`observing` and leave the same agent running; on a host-confirmed terminal
status, call the terminal timeout path, close once, record the failure, and
produce a defer-external handoff. Elapsed time, `running`, or a missing host
status cannot trigger timeout or close. Do not poll indefinitely or launch a
replacement solely because a window expired; reserve one replacement for an
explicit pre-dispatch tool failure where the reviewer never started.

Agent ids are lifecycle handles, not disposable notes. Save each id at dispatch
and invoke the host close-agent control exactly once after completion, timeout,
interruption, or error. Never make the user clean up a subagent in the UI. If
closure cannot be confirmed, stop dispatching until the agent control plane is
healthy.

## 2026-08-19: bounded reviewer execution profile

The fixed `reviewer` role uses high reasoning and intermittently exceeded the
60-second initial observation window even for one-artifact packets. A diagnostic
`default`/medium run completed and found a real close-proof gap, but it is not
the project profile. The durable route is now a fresh `default` agent with
`model=gpt-5.6-luna` and `reasoning_effort=max`; use the user's required LUNA MAX
profile even when it needs the deliberate 300-second paired-artifact observation
window.
This changes latency routing only: `fork_context=false`, exact report, watchdog
close, structured host proof, and handoff validation remain mandatory. A timeout
is still terminal `defer-external`, never a reason to replace the reviewer.

Before any reviewer spawn, run `codex.cmd --strict-config doctor --json`
once in the approved connected/elevated host context used by scheduling, not
the restricted sandbox. A sandbox-only no-credentials result is a context
boundary, not the app-host authority result. Require elevated doctor overall ok
and one tiny control-plane canary. Failed elevated auth, reachability, WebSocket,
active-rollout, or thread-control checks are a control-plane blocker: do not
spawn an agent, record defer-external, and repair the app host first. Opening a
new chat does not create a new host.

## 2026-08-19: green control-plane did not prove reviewer completion

The elevated Codex doctor and child-process canary passed, but two broad,
no-context reviewer assignments stayed `running` without a final report within
60 seconds. A minimal reviewer worker canary then returned the exact
`REVIEWER_CANARY_OK` sentinel, and a one-file reviewer returned within the same
budget (although its evidence was off-scope). The failure was therefore not a
total app or spawn outage. The broad assignment exceeded the bounded review
contract, and the process had no machine-checkable worker-readiness or report
shape gate.

The durable correction is two-stage admission: pass a fresh 30-second worker
canary and confirm its close, then dispatch only one-surface packets with one
primary raw artifact, one falsifier, and an exact
`REVIEWER_REPORT_V1` report contract. A malformed/off-scope report or
host-confirmed timeout is terminal in that round; a silent observation-window
expiry leaves the worker running with `observing`. Close evidence comes from
the host control, and dispatch is never allowed again for that assignment; the watchdog's
`assertDispatchAllowed()` ticket throws unless a completed review has a
host-verified close. It remains `defer-external`; it is never hidden by a
replacement or a self-review.

## 2026-08-19: deep-research source-agent forward path remains external

The base-skill planning forward test returned a bounded route/plan after the
progressive-disclosure refactor. A fresh default subagent asked only for a
deep-research planning contract still did not return within 60 seconds, even
after the deep skill gained a planning-only branch and deferred reference load.
This does not prove the deep skill's local contract is wrong; it isolates a
remaining execution-lane latency/skill-injection boundary for default deep
subagents.

The safe rule is to complete planning in the integrator when possible, then
start source-agent execution only after the base worker canary and research-pass
packet are admitted. A silent forward/source-agent observation expiry is recorded
as `observing` and left running; only a host-confirmed terminal failure is closed
and deferred. Never loop or claim research execution succeeded before its report.

## 2026-08-17: malformed repository target during PR monitoring

While monitoring PR #84, the former GitHub CLI path accepted a mistyped owner,
then converted a proxy failure into an empty `/reviewready` target. No repository
mutation occurred, but the secondary error hid the real context failure and
wasted time.

That CLI path is retired. The durable correction is the executable auth contract:
validate the canonical remote locally, use GCM for Git and the connected provider
for API work, and stop once when the required context is unavailable. Future
sessions must not replay the historical CLI workaround.

## 2026-08-18: PR #99 readiness failed on an exact body heading

The draft PR changed `AGENTS.md`, `README.md`, and `docs/**`, so the base policy
required a visible `Risk` section. The generated body used `Why`, `Validation`,
and `Scope` instead. CI, type compatibility, CodeQL, and package checks passed,
but the trusted `readiness` check failed closed because the policy matches exact
section headings. The repository PR template already contained `## Testing` and
`## Risk`; the durable fix is to read the template and effective policy before
creating or updating a PR and to preserve exact required headings. A green CI
check does not prove ReviewReady evidence is complete.

## How lessons become fixes

When the same class of failure recurs, first add a focused regression or
replayable check when the behavior can be tested locally. Then repair the
smallest safe boundary, validate the exact attempt, and keep the lesson linked
from the active process. Do not turn a one-off workaround into a permanent
credential, global configuration, or bypass of an external safety control.

## 2026-08-20: reviewer admission must separate health, dispatch, and lifecycle

The elevated doctor initially returned a failure only because the non-interactive
host exposed TERM=dumb. A process-local terminal normalization changed that to
warning-only; required auth, WebSocket, state, MCP, runtime, and sandbox checks
remained healthy. The durable rule is to validate required check ids rather than
treat every advisory warning as a total control-plane outage.

A list_threads inventory call then remained unresolved while list_projects and a
fresh worker canary succeeded. The inventory adapter is therefore a path-specific
observability failure, not proof that reviewer dispatch is unusable. The current
route records both facts and uses the actual worker canary as the dispatch proof.

A fresh no-context gpt-5.6-luna max reviewer read one artifact, remained alive
through its first observation window, returned REVIEWER_REPORT_V1 in the next
window, and was host-closed exactly once. This is the required proof that an
observation window is not a completion deadline; the previous broad reviewer
failure must not be repaired by shortening the window or replacing the worker.
The admission and child-process adapters are scripts/reviewer-admission.mjs and
scripts/windows-child-canary.mjs. Handoff refresh and validation are dependent
commands and must run serially.

## 2026-08-20: captured doctor output can create a false timeout

A cold doctor launched through a PowerShell ProcessStartInfo wrapper first
failed because the cmd quoting was malformed. After that was corrected, both
the codex.cmd wrapper and the direct Codex JavaScript entrypoint stayed alive
until their bounded waits expired. The decisive replay captured the large JSON
report while draining stdout and stderr concurrently, closed stdin before the
wait, and passed doctor admission with exit code zero. The failure was a
parent-side pipe backpressure deadlock, not a slow reviewer or a broken
doctor.

The durable guard is scripts/windows-child-canary.mjs: it now runs a large
streaming child and fails unless the parent drains both output streams before
close. Any future external wrapper must use that ordering; increasing a wait
window alone is not a repair.

The first independent review of that guard found two gaps before promotion:
the child only exercised stdout backpressure, and timeout cleanup returned
immediately after kill without confirming the close event. The repair now
writes 128 KiB to both streams and waits for the close event after timeout
cleanup. It does not return a close-unconfirmed result: without the close event
there is no truthful terminal result for this child lifecycle.
Focused tests cover both the normal stream path and the timeout-close path.
