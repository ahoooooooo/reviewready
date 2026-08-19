# Independent reviewer contract

Read this reference only when the base route selects independent review. The
base skill remains the lifecycle authority; this file supplies the detailed
reviewer dispatch, packet, watchdog, and handoff contract.

## Host and worker admission

Before any reviewer spawn, run `codex.cmd --strict-config doctor --json` in the
approved connected/elevated host context used by scheduling, then one tiny
control-plane child canary. A sandbox-only no-credentials result is a context
boundary, not logout evidence. If doctor, reachability, WebSocket, active
rollout, or thread control is not usable, record `defer-external` and do not
spawn.

Before a substantive reviewer, run one fresh worker-readiness canary with
`fork_context=false`. Give it one 30-second budget and require the exact output
`REVIEWER_CANARY_OK`. Save its id and close it exactly once through the host
close-agent adapter. Record the host response as close evidence. A timeout,
malformed output, or unconfirmed close is terminal for the round; do not spend
tokens on a substantive reviewer.

Every subagent uses `model=gpt-5.6-luna` and `reasoning_effort=max`. Use a fresh
`default` agent with `fork_context=false` for the normal bounded packet; do not
substitute another model or reasoning profile. The routing choice never changes
report, watchdog, close, or handoff validation.

## Bounded surface packet

The default packet contains exactly one named surface, one primary raw artifact,
explicit exclusions, one falsifier, and one concrete question. A packet that
needs more evidence becomes a disjoint assignment. Only a deliberately approved
120-second read may pair two small artifacts. Never give one reviewer a whole
repository or ask it to run the full repository gate.

Pass only the target revision, worktree state, raw artifact, exclusions,
falsifier, and question. Do not pass integrator conclusions, sibling reports,
claim maps, intended fixes, or the expected answer.

The integrator owns the broad baseline. The fresh reviewer must not preload
AGENTS, the full repository, or unassigned references; the packet is its raw
context. Missing evidence is reported as an authority/evidence gap, not solved
by widening the packet silently.

Require exactly this report shape:

```text
REVIEWER_REPORT_V1
surface=<one assigned surface>
falsifier=<strongest falsifier>
evidence=<artifact path or id>
missed_surface=<one missed surface or none>
authority_gap=<one gap or none>
recommendation=<promote|reopen|defer-external>
```

Reject malformed, incomplete, off-scope, or artifact-unbound output. Close the
agent once, record a tool-failure/defer-external handoff, and do not replace it
solely to obtain a better-shaped report.

## Adaptive schedule and lifecycle

- Start with one fresh reviewer, not a fixed panel.
- Add a reviewer only when the first report identifies an unresolved,
  decision-changing falsifier and the new surface has disjoint artifacts and
  falsifiers.
- Cap the base route at three substantive reviewers and two active reviewers.
- Give each reviewer one total wait budget: 60 seconds by default, or 120
  seconds only for a deliberately approved paired-artifact read.
- A silent timeout is terminal. Close once, record the environment failure, and
  defer-external. Never poll indefinitely or replace solely for timeout.
- One replacement is allowed only for an explicit pre-dispatch tool failure
  where the reviewer never started and the round budget remains.
- Store every id. On completion, timeout, interruption, or error, invoke the
  host close-agent adapter exactly once. If close cannot be confirmed, stop
  dispatching.

Use `scripts/reviewer-watchdog.mjs` for exact worker/report validation,
terminal timeout, close-once, host proof binding, no replacement, and the
throwing `assertDispatchAllowed()` ticket. A dispatch ticket exists only after
a completed report and host-confirmed close; timeout can never produce one.

## Handoff and promotion

The completed substantive review is also the final current-epoch review when no
material repair, revision, scope, source, or trust-boundary change follows it.
After any such change, invalidate the prior epoch and run one fresh final review
before proof or promotion. Do not dispatch a duplicate final reviewer merely to
rename an unchanged completed report.

The JSON handoff must contain:

- route, review epoch, revision, worktree, scope, artifacts, and evidence;
- `reviewerReadiness` with canary id, exact sentinel, 30-second wait budget,
  observed output, passed/deferred status, closed flag, and host close evidence
  bound to the canary id;
- reviewer assignments with id, role, `fork_context=false`, one-primary or
  deliberately paired packet mode, wait budget, owned/excluded surfaces,
  artifacts, exact validated report when complete, structured substantive-agent
  close evidence, and status. Complete evidence binds
  `previousStatus=completed` and `closed=true`; incomplete outcomes may use the
  explicit error shape.
- exactly one owner per covered surface;
- severity-ordered findings, strongest falsifier, missed surface, authority gap,
  recommendation, and exactly one outcome.

Validate with `npm run review:validate -- --file <handoff.json>`. A timeout,
tool failure, deferred worker, malformed report, missing canary, unconfirmed
close, or packet mismatch is valid only with `defer-external`; it cannot be
promoted as independently reviewed.
