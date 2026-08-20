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
Doctor admission is evaluated by scripts/reviewer-admission.mjs: required
checks must be ok; only an explicitly listed non-functional advisory may leave
the overall status at warning. When the host is non-interactive, normalize
TERM for that process only. Use a small app/control canary plus the worker
canary; a hanging inventory path such as list_threads is path-specific
evidence, not proof that the actual worker dispatch path is unusable.
If a host wrapper captures doctor JSON, attach stdout and stderr readers before
waiting for process exit and close stdin first. Waiting before draining a large
report can fill a Windows pipe and create a false control-plane timeout; the
streaming child canary is required evidence for this wrapper path. A timeout
kill must then await the child close event; returning before close is not
valid cleanup evidence.

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
120-second read may pair two small artifacts; after a recorded LUNA MAX timeout,
the explicit `luna-max-long-read` profile may pair two small artifacts for 300
seconds. Never give one reviewer a whole repository or ask it to run the full
repository gate.

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
- Give each reviewer one initial observation window: 60 seconds by default, or
  120 seconds only for a deliberately approved paired-artifact read. These
  values are not completion deadlines. After a recorded host-confirmed LUNA MAX
  120-second timeout, use only the explicit `luna-max-long-read` two-artifact
  profile with a 300-second observation window.
- A silent observation-window expiry is non-terminal: record `observing`, keep
  the same worker running, and allow another observation window. Never call
  `timeout()` or close merely because the observation window elapsed. The
  watchdog accepts only a host-confirmed terminal status in `timeout(hostStatus)`;
  `running` or a missing host status is rejected. Only that terminal path closes
  once and yields `defer-external`; never poll indefinitely in the parent turn.
- One replacement is allowed only for an explicit pre-dispatch tool failure
  where the reviewer never started and the round budget remains.
- Store every id. On completion, timeout, interruption, or error, invoke the
  host close-agent adapter exactly once. If close cannot be confirmed, stop
  dispatching.
  Use one bounded wait call per observation window and continue with the same
  agent id using backoff. The wait duration is an observer budget, not a worker
  completion deadline; a parent turn may yield while the host worker remains
  running. Do not close, replace, or dispatch a second worker because a wait
  call returned without a final report.
  A host not_found result proves that no live worker is currently addressable,
  but it is not a synthetic passed close proof. Record the explicit error shape
  and keep that historical review out of promotion; future workers still need
  the normal one-call structured close evidence.

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
  close evidence, and status. Complete evidence binds a known host
  `previousStatus` and `closed=true`; `running` is valid when the report arrived
  before close, while observing assignments have no close evidence yet.
  Incomplete terminal outcomes may use the explicit error shape.
- exactly one owner per covered surface;
- severity-ordered findings, strongest falsifier, missed surface, authority gap,
  recommendation, and exactly one outcome.

Validate with `npm run review:validate -- --file <handoff.json>`. A
host-confirmed timeout, observing/deferred worker, tool failure, malformed
report, missing canary, unconfirmed close, or packet mismatch is valid only with
`defer-external`; it cannot be promoted as independently reviewed.
