---
name: reviewready-base-delivery
description: Use when working on any task in the ReviewReady repository, including project status, implementation, documentation, tests, security, trust, release, architecture, process, or skill changes.
---

# ReviewReady Base Delivery

Apply this skill to every ReviewReady task. It is the mandatory base contract;
the selected route controls evidence breadth, and other skills add evidence
lanes without replacing the base contract.

## Hard gates

- Emit the route, outcome, scope, and exit gate before the first tool call.
- Do not edit files until the baseline is anchored and the decision is framed.
- Do not start the next slice until the current slice has focused evidence and a
  plan update.
- Do not claim complete, fixed, passing, or ready without fresh verification
  output from the command or evidence that proves that exact claim.
- Treat every GitHub, npm, or other provider CLI/API/network command as a
  separate approval boundary, including read-only operations. Ask for the
  operation-specific approval before the first external call; do not use a
  cached page, historical evidence, or a previous session approval as a
  substitute.

## Start before tools or edits

Send a compact route and plan update:

```text
Route: base + <overlays, if any>
Outcome: <one observable result>
Scope/non-goals: <what is and is not changing>
Exit gate: <evidence required to finish>
```

Always attach `base`. Add overlays from the prompt:

- `process-self-optimization`: change or compare a workflow, prompt, skill,
  routing rule, agent method, or repository process;
- `promotion`: publish, commit, push, merge, tag, deploy, credentials, secrets,
  permissions, provider writes, or repository-setting changes;
- `consequential`: security, trust, provenance, release, package, workflow,
  Action, schema, public API, compatibility, migration, architecture, or
  multi-surface work; and
- `deep-research`: the user explicitly requests deep research, or the decision
  needs material multi-source current/external evidence, comparison, synthesis,
  or authority. Read and apply `$reviewready-deep-research` as an overlay.

Base is conservative by default. Do not infer a reduced path from
prompt brevity, casual wording, or a familiar file name. Every task uses anchor
→ frame → relevant attack → focused proof → handoff. Use the full reasoning loop
for behavior, security, trust, public, release, architecture, process-rule, or
external-write work. Use the complete repository gate for executable/public
changes; use relevant focused validation and process replay for documentation,
skill, or process-only changes until final PR/promotion. Escalate when the trust
boundary or changed surface expands.

## External provider gate

Run `npm run auth:status` once before the first GitHub/npm provider
operation in a bounded external batch. It is the local machine-readable
authority map and makes no network request. Reuse that routing result only while
the provider authority, repository/package scope, network context, and
credential context remain unchanged; a new batch or changed context requires a
fresh preflight. Do not substitute model memory, a historical note, or another
auth channel for its result.

- Git fetch/push uses browser-backed Windows Git Credential Manager. GitHub API
  work uses the explicitly approved connected provider/browser channel. GitHub
  CLI is forbidden as an auth preflight or fallback.
- npm publication uses the protected GitHub Actions release workflow and npm
  Trusted Publishing OIDC. Local npm login/whoami is irrelevant and forbidden
  as a release-health check.
- `connected_context_required` and `context_unavailable` are context results,
  not logout evidence. Stop and use the connected context. Do not retry in the
  same context or request login. Only `not_logged_in` from one connected-user
  GCM probe may hand off a separate human login decision.
- Credential probing has one attempt and zero same-context retries. Never emit
  account names, tokens, credential files, or raw provider responses.

Keep ordinary work in the local sandbox. When the result is
`connected_context_required` or `context_unavailable`, record the
context boundary, stop retrying in the sandbox, and request one approved
connected/elevated execution context for the exact provider operation. Execute
only the approved provider, resource scope, network context, and read/write
effect there, then return to the sandbox for local validation. Never disable
the sandbox globally or select danger-full-access/--yolo automatically.

For each actual provider operation, name the provider, intended resource scope,
network context, and read/write effect in the approval request. Keep the batch
bounded; a read approval does not authorize authentication changes, commits,
pushes, releases, tag movement, settings mutation, or deployment. If the
required connected channel is unavailable, defer the external operation once
and continue independent local work; never switch authority channels silently.

## Windows sandbox gate

When a Windows command fails with spawn EPERM, CreateProcess failure,
helper_unknown_error, an ACL/deny-read sandbox error, or a nested npm/package
child process reports ETIMEDOUT:

1. Record the exact command, error, Codex version, sandbox mode, and whether
   the operation was local or external.
2. Run one read-only child-process canary in the current context:

   ```powershell
   node -e "const { spawnSync } = require('node:child_process'); const r = spawnSync(process.execPath, ['-e', 'process.stdout.write(\"codex-spawn-ok\")'], { encoding: 'utf8' }); if (r.error) { console.error(r.error.code || r.error.message); process.exit(1); } process.stdout.write(r.stdout);"
   ```

3. If it fails, preserve the error and retry the original command at most once
   in an explicitly approved fresh/connected Codex execution context. If the
   canary passes but a nested npm/package command still times out, retry the
   exact command at most once in an approved elevated context with
   `REVIEWREADY_NPM_CACHE=.reviewready-npm-cache` or the equivalent
   process-local cache. Do not loop in the same sandbox or resumed conversation.
4. If the fresh-context retry fails, hand off the environment blocker with the
   sandbox log path and exact reproduction. Never select danger-full-access or
   --yolo automatically to hide the failure.
5. Run repository validation only after the canary passes; otherwise mark the
   result environment-blocked, not product-passing or product-failing.

## Context budget

Keep the default context small: `AGENTS.md`, this skill, the exact active plan,
and only the files needed for the current slice. Load `reviewready-deep-research`
only for its overlay. Load rationale documents on demand rather than alongside
the skill: use product/architecture for behavior or trust, post-v1 for node
planning, release/operational/status documents for public or external work, and
research documents for research or process-method changes. Use `rg` to locate
headings and read bounded ranges. Do not preload all of `docs/`, `src/`, or
`test/`, and do not reread unchanged context after compaction.

The broad baseline-read rule belongs to the integrator. A fresh reviewer or
research source pass is a bounded worker: its supplied packet is the raw context
for that assignment, and it must not preload AGENTS, the full repository, or
unassigned references. If the packet lacks evidence needed to answer its one
question, report an evidence gap/defer rather than widening context.

## Iterative loop

The base loop applies to every task. Phase depth follows the changed surface;
do not add unrelated attacks or a full `npm run check` to documentation or
skill-only work unless scope escalates or final promotion requires it.

### 1. Anchor the baseline

Read the nearest `AGENTS.md`, product and architecture contracts, active plan or
issue, relevant tests, fixtures, evidence, and release rules. Inspect the exact
revision and current worktree before deciding what to change. Preserve unrelated
dirty work. Classify observations as local, live, externally enforced, public
artifact, or adoption evidence. Record dates and revisions for time-sensitive
facts. Start a new round if the target moves materially.

### 2. Frame one decision

Define one observable outcome, trust boundary, work kind, non-goals,
prerequisites, falsifier, and exit gate. Keep exactly one active slice. If the
prompt contains multiple outcomes, split them into ordered slices instead of
quietly widening scope.

### 2.1 Dispatch an independent reviewer when the route requires it

Read [references/reviewer-contract.md](references/reviewer-contract.md) before
any reviewer-required route. It is the detailed contract for host/worker
admission, one-artifact packets, exact report shape, watchdog transitions,
adaptive scheduling, and `reviewerReadiness` handoff validation.

The short routing rule is: doctor and control-plane canary first; worker canary
second; one bounded substantive packet third; exact report validation and
host-bound close fourth. If that report completes without a material repair or
scope/revision change, it is the final current-epoch review; after such a change,
run one fresh final review before proof or promotion. Do not dispatch a duplicate
final reviewer merely to rename an unchanged completed report.
Any timeout, malformed/off-scope report, unconfirmed close, packet mismatch, or
missing handoff field is incomplete evidence and yields `defer-external`.

For every subagent spawn, set `model=gpt-5.6-luna` and
`reasoning_effort=max`. For the normal bounded packet, dispatch a fresh
`default` agent with `fork_context=false`; do not substitute another model or
reasoning profile. Use `luna-max-long-read` only after a recorded 120-second
LUNA MAX timeout, with exactly two small artifacts and a 180-second budget.
This routing choice does not loosen the report, watchdog, or handoff
requirements.

These hard invariants apply even when the detailed reference is not loaded:

- `fork_context=false`, elevated doctor/control canary, then exact
  `REVIEWER_CANARY_OK` worker canary and one confirmed close;
- one primary raw artifact, one falsifier, one question, and exact
  `REVIEWER_REPORT_V1` evidence binding by default;
- timeout is terminal, replacement is forbidden unless the reviewer never
  started because of an explicit pre-dispatch tool failure, and close-agent is
  exactly once through an agent-bound host adapter;
- `assertDispatchAllowed()` must pass before any next dispatch; otherwise the
  round is `defer-external`; and
- `reviewerReadiness` plus `npm run review:validate` is required before proof or
  promotion.

The minimum reviewer report fields are exactly `surface`, `falsifier`,
`evidence`, `missed_surface`, `authority_gap`, and `recommendation`, preceded by
`REVIEWER_REPORT_V1`; evidence must bind to the packet artifact. The minimum
`reviewerReadiness` fields are canary id, `fork_context=false`, 30-second budget,
exact sentinel/output, passed/deferred status, closed flag, and agent-bound host
close evidence. Close evidence must be a structured host proof with `source`,
`agentId`, `previousStatus`, and `closed` (or an explicit error shape); a
complete/passed proof must have `previousStatus=completed` and `closed=true`.
A complete final reviewer assignment in the handoff must also carry that exact
validated report and structured close evidence bound to its substantive reviewer
id.

### 3. Attack before repairing

Batch independent attacks before choosing a fix. Cover the relevant surfaces:
correctness, hostile input, authority and provenance, compatibility, operations,
public artifacts, and evidence freshness. Preserve failed attempts and the
strongest unresolved objection. Do not patch the first finding while an
unexplored surface could change the decision.

### 3.1 Capture errors before repairing

For a non-critical failure, write one compact record in the current plan, PR,
issue, or task handoff before changing anything. If no durable container exists,
keep it in the current round; do not create an external record for a one-off:

For recurring local/process/environment failures, use the workspace-local batch
tool as the durable container:

```console
npm run agent:record -- --failure-class environment --impact P1 --stage proof --next repair-batch --command "<command>" --symptom "<bounded symptom>" --evidence "<bounded evidence>"
npm run agent:triage
```

Do not retry an open fingerprint in the same context. Repair open groups at the
stage boundary as one dependency-ordered batch, then append a resolution only
after focused proof. Sandbox/provider failures are deferred; never change ACLs,
credentials, authority channels, or global Codex hooks automatically.

```text
Error: <symptom>
Evidence: <command, output, source, or URL>
Impact: P0/P1/P2 and blocking/non-blocking
Class: product | process | environment | evidence | external
Next: <repair, retry, defer, or continue>
```

Stop and address P0 security, data-loss, corruption, or required-gate blockers.
Capture P1 blockers before the next repair batch. Continue past non-blocking P2
errors when safe, then batch them. Do not create a new memory document or test
for a one-off failure unless it is recurring, material, or executable behavior.

### 4. Synthesize and choose the smallest safe slice

Separate product defects, design gaps, process defects, environment failures,
evidence gaps, and external dependencies. Connect findings to sources, tests,
or falsifiable examples. A bug fix starts with a failing regression;
diagnosis-only work stays read-only and records a reproduction or falsifier
instead. A trust, schema, identity, persistence, execution, migration, or
release change needs a design gate before implementation.

### 5. Iterate with evidence

For every slice, use:

```text
evidence → finding or hypothesis → smallest action → focused validation → plan update
```

Keep one plan step in progress. If validation finds a gap, return to attack with
the failed attempt intact. Continue safe local work when an external dependency
is unavailable; do not rename an unresolved result into a pass.

Keep iteration updates compact:

```text
Phase: <current phase>
Evidence: <what changed or was verified>
Decision: <continue, reopen, defer-external, or promote>
Next: <one action and its exit gate>
```

### 6. Prove the current attempt

Use route-appropriate proof:

- documentation or skill-only changes:
  the relevant validator, format/diff checks, and review; run the complete gate
  only at final PR, promotion, or escalation;
- behavior, security, trust, public, release, architecture, or external-write
  changes: focused regression, then `npm run check`;
- process-rule, documentation, or skill-only changes: relevant validator,
  format/diff checks, process replay/review, and the complete gate only at final
  PR, promotion, or escalation;
- routes covered by the independent-review gate: include the fresh no-context
  review report in proof; a self-review or same-context agreement is not
  independent evidence;
- research overlay: primary sources, reproducible queries, dates, revisions,
  counter-evidence, claim boundaries, and refresh triggers;
- package, Action, release, or public surface: exact artifact, generated parity,
  clean-room/package checks, public-coordinate verification, and authorization.

Inspect generated or public artifacts included in the diff. Stale, incomplete,
contradictory, oversized, race-affected, or unbound evidence cannot satisfy a
gate. Do not add tests that only snapshot prose instructions; add executable
tests only for behavior, public contracts, or deterministic artifacts.

### 7. Promote, reopen, or defer

Promote only when the exit gate passes for the exact current attempt, no material
in-scope objection remains, and the next authority boundary is explicit.

- `reopen`: a material local or evidence gap requires another iteration;
- `defer-external`: the remaining action belongs to a named provider, maintainer,
  consented pilot, credential, deployment, or other external authority; and
- `blocked`: only after safe alternatives and independent work are exhausted and
  the same external condition prevents progress.

Internal proof does not mean merged, published, adopted, or production-authoritative.
Do not commit, push, publish, deploy, mutate settings, or move tags without the
required authorization and project release gates.

## PR evidence gate

Before creating or updating a PR, read the effective `.reviewready.yml` and
`.github/PULL_REQUEST_TEMPLATE.md`. Match changed paths to required evidence and
copy the exact required headings into the body. Do not substitute `Why`,
`Validation`, or `Scope` for a required `Risk` or `Testing` section. Inspect the
final body before submitting; a policy check is exact and fails closed on a
missing section even when CI is green.

## Process/skill changes

For this rare route, add `process-self-optimization`, read the process rationale
on demand, and pressure-test old versus candidate behavior with a few realistic
prompts. Compare skipped gates, unnecessary work, stale claims, handoff quality,
and completion claims. Record the result as process evidence; do not add tests
that only assert skill prose, and keep the simpler version without material gain.
Forward-test the candidate with a fresh no-context reviewer; do not let the
candidate process certify its own dispatch or promotion gate.

## ReviewReady invariants

Keep readiness deterministic. Never let an LLM decide readiness, approve, merge,
or establish human identity. Load effective policy from the immutable base
revision. Treat PR metadata, paths, labels, events, Markdown, API responses,
workflow source, and external settings as untrusted. Never execute pull-request
code in a trusted path. Bound inputs, requests, retries, pagination, concurrency,
deadlines, matching work, output, and artifacts. Keep readiness, audit,
evidence-bundle, ingress, observability, AI analysis, and SARIF contracts
separate.
