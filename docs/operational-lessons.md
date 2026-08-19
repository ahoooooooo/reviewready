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
not independent evidence. Give report-only reviewers one bounded wait budget
(60 seconds by default, 120 seconds only for a deliberately approved long
read). On a silent timeout, close once, record the failure, and produce a
defer-external handoff. Do not poll indefinitely or launch a replacement solely
because the reviewer timed out; reserve one replacement for an explicit
pre-dispatch tool failure where the reviewer never started.

Agent ids are lifecycle handles, not disposable notes. Save each id at dispatch
and invoke the host close-agent control exactly once after completion, timeout,
interruption, or error. Never make the user clean up a subagent in the UI. If
closure cannot be confirmed, stop dispatching until the agent control plane is
healthy.

Before any reviewer spawn, run `codex.cmd --strict-config doctor --json`
once for the current host. Failed Codex auth, reachability, WebSocket,
active-rollout, or thread-control checks are a control-plane blocker: do not
spawn an agent, record defer-external, and repair the app host first. Opening a
new chat does not create a new host.

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
