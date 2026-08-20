<!-- REVIEWREADY_HANDOFF_JSON_BEGIN -->

```json
{
  "document_type": "REVIEWREADY_CANONICAL_AGENT_HANDOFF",
  "schema_version": 1,
  "project": "ReviewReady",
  "updated_at": "2026-08-20T05:49:49.700Z",
  "revision": "0a52f289a8d6be972eda0626c7656c73731fb287",
  "branch": "codex/reviewready-context-and-skills",
  "worktree_state": "dirty",
  "changed_paths": [
    ".gitignore",
    "AGENTS.md",
    "docs/adr/0017-canonical-agent-handoff.md",
    "docs/agent-handoff.schema.json",
    "docs/ai-development.md",
    "docs/current-status.md",
    "docs/operational-lessons.md",
    "docs/oss-upgrade-process.md",
    "docs/research/deep-research-process.md",
    "package.json",
    "scripts/agent-handoff.mjs",
    "scripts/reviewer-admission.mjs",
    "scripts/reviewer-watchdog.mjs",
    "scripts/windows-child-canary.mjs",
    "skills/reviewready-base-delivery/SKILL.md",
    "skills/reviewready-base-delivery/references/reviewer-contract.md",
    "skills/reviewready-deep-research/SKILL.md",
    "skills/reviewready-deep-research/references/research-method.md",
    "test/agent-handoff.test.ts",
    "test/reviewer-admission.test.ts",
    "test/reviewer-watchdog.test.ts",
    "test/upgrade-process.test.ts"
  ],
  "change_digest": "sha256:e0069677a5aaba0227fd1177756578579b0406a8927a62338ef85ed68e9ad24f",
  "handoff_digest": "sha256:a3f1d0d1eed91735ee31180db3271020fac74011c1048ce78344e5b0aa144ad7",
  "route": "base+deep-research",
  "phase": "handoff",
  "outcome": "defer-external",
  "active_slice": {
    "id": "repair-batch-promotion",
    "objective": "Promote the locally proven reviewer, Windows capture, handoff, and process-skill repair batch without mixing in a new product upgrade.",
    "scope": [
      "canonical root handoff file",
      "reviewer admission, report, observation, and host-close lifecycle",
      "Windows spawn, external scheduling, and failure-batch evidence paths",
      "the confirmed files in this feature-branch repair batch and their commit/push"
    ],
    "non_goals": [
      "update PR #99",
      "publish npm or create a release",
      "change global Codex settings, hooks, credentials, or provider authority"
    ],
    "falsifier": "The final gate fails, the staged scope contains an unrelated path or secret, the commit does not contain the confirmed repair batch, or the remote feature-branch ref cannot be verified after push.",
    "exit_gate": "The final diff review and complete npm gate pass, only confirmed paths are committed, the current feature branch is pushed through the authorized HTTPS/GCM route, and the post-push remote ref plus clean handoff are verified."
  },
  "next_action": {
    "action": "Run the final complete gate, stage only the confirmed repair batch, commit it, push the current feature branch, then finalize and verify the clean handoff; do not update PR #99.",
    "owner": "integrator",
    "gate": "The final independent reviewer is still current for the unchanged code digest, the complete gate and failure ledger are current, and commit/push authorization is explicit for this batch."
  },
  "blockers": [
    {
      "id": "reviewer-control-plane",
      "class": "external",
      "status": "resolved",
      "symptom": "The first elevated doctor was rejected by TERM=dumb and the list_threads path previously hung.",
      "evidence": "Process-local TERM=xterm-256color made doctor warning-only with auth/WebSocket/state/MCP/runtime checks passing; list_projects control canary and a fresh worker canary both completed.",
      "next_action": "Use the proven list_projects plus worker route; keep list_threads as a bounded non-authoritative diagnostic and never make reviewer admission depend on it."
    },
    {
      "id": "reviewer-report",
      "class": "external",
      "status": "resolved",
      "symptom": "A historical LUNA MAX reviewer ran through 300 seconds plus continuation without a final report.",
      "evidence": "Fresh agent 01a01ba8-02fc-75e2-a33b-6e3409e068e5 used one raw artifact, returned the exact REVIEWER_REPORT_V1 after the first observation window, and host close reported completed; review:validate passed.",
      "next_action": "Keep the bounded packet and non-terminal observation rule as the durable route."
    },
    {
      "id": "streaming-review-findings",
      "class": "product",
      "status": "resolved",
      "symptom": "The fresh reviewer found missing stderr backpressure coverage and timeout cleanup that returned before close confirmation.",
      "evidence": "Final fresh no-context LUNA MAX reviewer 01a01be7-41bd-7452-957a-c13049fb59de returned REVIEWER_REPORT_V1 with recommendation=promote after both streams, stdin close, and host-confirmed child close were implemented; the agent was closed exactly once and review:validate passed for .reviewready-reviewer-streaming-lifecycle.json.",
      "next_action": "Preserve the large-output dual-stream regression and the rule that timeout cleanup is non-terminal until the child close event is confirmed."
    },
    {
      "id": "handoff-digest-staging",
      "class": "process",
      "status": "resolved",
      "symptom": "Staging unchanged files changed the handoff change_digest because Git index status was included in the digest.",
      "evidence": "scripts/agent-handoff.mjs now hashes each changed path and its current bytes while excluding the two-character index status; the regression test compares ` M` and `M `, and fresh reviewer 01a01dac-7157-7cd0-95df-109a90c57d26 returned REVIEWER_REPORT_V1 recommendation=promote with review:validate passing.",
      "next_action": "Keep the digest content-bound so validation evidence survives staging but still changes on file-content edits."
    },
    {
      "id": "thread-inventory-path",
      "class": "external",
      "status": "resolved",
      "symptom": "codex_app list_threads remained unresolved for more than 120 seconds.",
      "evidence": "The inventory endpoint itself remains unproven, but the operational failure is rooted at the workflow boundary: list_projects, the exact worker readiness canary, and the substantive reviewer route completed, and reviewer admission never depends on list_threads. The same unresolved fingerprint was not retried.",
      "next_action": "Keep list_threads diagnostic-only; never make reviewer admission, report completion, or close cleanup depend on the inventory path."
    },
    {
      "id": "public-promotion",
      "class": "external",
      "status": "deferred",
      "symptom": "PR #99 is still a draft at the previous revision and does not contain this local repair batch.",
      "evidence": "Public PR state was read-only verified; the current authorization covers commit and push only, and does not authorize a PR update.",
      "next_action": "Keep PR #99 unchanged in this batch; a later explicitly authorized PR batch may use the pushed feature branch."
    },
    {
      "id": "retained-failure-groups",
      "class": "evidence",
      "status": "resolved",
      "symptom": "The append-only ledger retains historical groups and the current promotion slice recorded staging, patch, focused-test, and reviewer-handoff evidence events.",
      "evidence": "All new non-zero exits and wrapper failures were recorded before retry; the final triage result reports 464 total groups, resolvedGroups=464, and openGroups=[].",
      "next_action": "For future failures, record at the boundary, do not retry an open fingerprint, and resolve only after focused proof in the matching authority context."
    }
  ],
  "completed": [
    {
      "id": "watchdog-silence",
      "summary": "Silent reviewer observation windows are repeatable and cannot become timeout or close without host terminal evidence.",
      "evidence": "scripts/reviewer-watchdog.mjs and focused reviewer-watchdog tests passed."
    },
    {
      "id": "context-cost",
      "summary": "Manual 1M/900K context overrides are absent and scoped context loading is documented.",
      "evidence": "local Codex config audit plus official model/config research recorded in the current task."
    },
    {
      "id": "error-boundary",
      "summary": "Non-zero, timeout, provider, and tool failures are recorded before retry, with unknown hook payloads kept unknown.",
      "evidence": "agent-failure batch records, hook tests, and existing AGENTS.md protocol."
    },
    {
      "id": "canonical-handoff",
      "summary": "The project now has one root HANDOFF.md with a strict JSON Schema payload, refresh command, content/worktree digests, and a check gate.",
      "evidence": "docs/agent-handoff.schema.json, scripts/agent-handoff.mjs, ADR-0017, and focused handoff tests."
    },
    {
      "id": "validation-freshness",
      "summary": "Passed validation evidence is now bound to the current worktree change_digest; stale green proof is rejected after any meaningful file change.",
      "evidence": "The stale-digest regression test produced the expected red validation, then the current 38-test focused suite and complete gate passed."
    },
    {
      "id": "reviewer-admission",
      "summary": "The reviewer route now has a proven host admission path with process-local terminal normalization, an app control canary, and a fresh no-context LUNA MAX worker canary.",
      "evidence": "codex.cmd doctor with TERM=xterm-256color returned warning-only with required checks passing; list_projects succeeded; worker 01a01ba5-893e-79f1-8d96-e4e04271acba returned REVIEWER_CANARY_OK and host close reported completed."
    },
    {
      "id": "substantive-reviewer",
      "summary": "A fresh no-context LUNA MAX reviewer completed the assigned watchdog lifecycle report after a silent first observation window and was host-closed exactly once.",
      "evidence": "reviewer:validate passed for .reviewready-reviewer-lifecycle.json; report and close evidence are bound to agent 01a01ba8-02fc-75e2-a33b-6e3409e068e5."
    },
    {
      "id": "admission-and-child-adapters",
      "summary": "Doctor admission and Windows child spawning now use deterministic, tested adapters with process-local terminal normalization, no shell quoting, and a large-output pipe check.",
      "evidence": "real elevated doctor admission returned admitted=true; node scripts/windows-child-canary.mjs returned passed for the small and 128 KiB streaming canaries; focused adapter tests passed."
    },
    {
      "id": "captured-child-pipe",
      "summary": "The false post-restart doctor timeout was rooted in parent-side pipe backpressure and now has an executable regression guard.",
      "evidence": "A cold direct Codex entrypoint passed after concurrent stdout/stderr draining and stdin close; the streaming child regression fails if a wrapper waits before draining."
    },
    {
      "id": "final-review-and-complete-gate",
      "summary": "The repaired Windows capture lifecycle passed an independent no-context LUNA MAX reviewer and the complete repository gate.",
      "evidence": "Final reviewer 01a01be7-41bd-7452-957a-c13049fb59de returned REVIEWER_REPORT_V1 recommendation=promote and was host-closed exactly once; review:validate passed; the elevated process-local npm/Git gate passed 42 files, 951 tests, package audit, release preflight, and package smoke."
    },
    {
      "id": "handoff-digest-independent-review",
      "summary": "The content-bound handoff digest repair passed a fresh independent no-context LUNA MAX review.",
      "evidence": "Reviewer 01a01dac-7157-7cd0-95df-109a90c57d26 returned REVIEWER_REPORT_V1 recommendation=promote for raw:scripts/agent-handoff.mjs after the initial observation window was silent; the same agent was host-closed exactly once and .reviewready-reviewer-handoff-digest.json passed review:validate."
    }
  ],
  "validation": [
    {
      "command": "npm run handoff:validate (current handoff digest)",
      "status": "deferred",
      "observed_at": "2026-08-20 Asia/Taipei",
      "revision": "0a52f289a8d6be972eda0626c7656c73731fb287",
      "change_digest": "sha256:8c883d763afae235f111e353edf59b62a09d0c9133cc2748cb0b292fb09f8aeb"
    },
    {
      "command": "npm run format:check, npm run lint, npm run typecheck (current handoff digest)",
      "status": "deferred",
      "observed_at": "2026-08-20 Asia/Taipei",
      "revision": "0a52f289a8d6be972eda0626c7656c73731fb287",
      "change_digest": "sha256:8c883d763afae235f111e353edf59b62a09d0c9133cc2748cb0b292fb09f8aeb"
    },
    {
      "command": "npm run test -- --run handoff/upgrade/watchdog/research/reviewer tests (37 passed; current handoff digest)",
      "status": "deferred",
      "observed_at": "2026-08-20 Asia/Taipei",
      "revision": "0a52f289a8d6be972eda0626c7656c73731fb287",
      "change_digest": "sha256:8c883d763afae235f111e353edf59b62a09d0c9133cc2748cb0b292fb09f8aeb"
    },
    {
      "command": "npm run check (approved elevated context with process-local cache; 41 files, 945 passed, 6 skipped; current handoff digest)",
      "status": "deferred",
      "observed_at": "2026-08-20 Asia/Taipei",
      "revision": "0a52f289a8d6be972eda0626c7656c73731fb287",
      "change_digest": "sha256:8c883d763afae235f111e353edf59b62a09d0c9133cc2748cb0b292fb09f8aeb"
    },
    {
      "command": "independent reviewer control-plane canary",
      "status": "deferred",
      "observed_at": "2026-08-20 Asia/Taipei",
      "revision": "0a52f289a8d6be972eda0626c7656c73731fb287",
      "change_digest": "sha256:8c883d763afae235f111e353edf59b62a09d0c9133cc2748cb0b292fb09f8aeb"
    },
    {
      "command": "codex.cmd doctor --strict-config --json with process-local TERM=xterm-256color (elevated host)",
      "status": "deferred",
      "observed_at": "2026-08-20 Asia/Taipei",
      "revision": "0a52f289a8d6be972eda0626c7656c73731fb287",
      "change_digest": "sha256:8c883d763afae235f111e353edf59b62a09d0c9133cc2748cb0b292fb09f8aeb"
    },
    {
      "command": "Codex app list_projects control-plane canary",
      "status": "deferred",
      "observed_at": "2026-08-20 Asia/Taipei",
      "revision": "0a52f289a8d6be972eda0626c7656c73731fb287",
      "change_digest": "sha256:8c883d763afae235f111e353edf59b62a09d0c9133cc2748cb0b292fb09f8aeb"
    },
    {
      "command": "fresh worker readiness canary REVIEWER_CANARY_OK plus host close",
      "status": "deferred",
      "observed_at": "2026-08-20 Asia/Taipei",
      "revision": "0a52f289a8d6be972eda0626c7656c73731fb287",
      "change_digest": "sha256:8c883d763afae235f111e353edf59b62a09d0c9133cc2748cb0b292fb09f8aeb"
    },
    {
      "command": "real elevated doctor JSON through reviewer-admission with process-local TERM=xterm-256color",
      "status": "deferred",
      "observed_at": "2026-08-20 Asia/Taipei",
      "revision": "0a52f289a8d6be972eda0626c7656c73731fb287",
      "change_digest": "sha256:3f71d08a02a77a30d53df387d453d29716d67066d5dd1f3463c376f738502b3a"
    },
    {
      "command": "node scripts/windows-child-canary.mjs",
      "status": "deferred",
      "observed_at": "2026-08-20 Asia/Taipei",
      "revision": "0a52f289a8d6be972eda0626c7656c73731fb287",
      "change_digest": "sha256:3f71d08a02a77a30d53df387d453d29716d67066d5dd1f3463c376f738502b3a"
    },
    {
      "command": "npm run review:validate -- --file .reviewready-reviewer-lifecycle.json",
      "status": "deferred",
      "observed_at": "2026-08-20 Asia/Taipei",
      "revision": "0a52f289a8d6be972eda0626c7656c73731fb287",
      "change_digest": "sha256:3f71d08a02a77a30d53df387d453d29716d67066d5dd1f3463c376f738502b3a"
    },
    {
      "command": "npm run handoff:validate -- --file HANDOFF.md (final handoff)",
      "status": "deferred",
      "observed_at": "2026-08-20 Asia/Taipei",
      "revision": "0a52f289a8d6be972eda0626c7656c73731fb287",
      "change_digest": "sha256:3f71d08a02a77a30d53df387d453d29716d67066d5dd1f3463c376f738502b3a"
    },
    {
      "command": "focused reviewer/admission/watchdog/handoff/research/upgrade tests (28 passed)",
      "status": "deferred",
      "observed_at": "2026-08-20 Asia/Taipei",
      "revision": "0a52f289a8d6be972eda0626c7656c73731fb287",
      "change_digest": "sha256:3f71d08a02a77a30d53df387d453d29716d67066d5dd1f3463c376f738502b3a"
    },
    {
      "command": "npm run review:validate -- --file .reviewready-reviewer-streaming-lifecycle.json (final independent report)",
      "status": "deferred",
      "observed_at": "2026-08-20 Asia/Taipei",
      "revision": "0a52f289a8d6be972eda0626c7656c73731fb287",
      "change_digest": "sha256:3f71d08a02a77a30d53df387d453d29716d67066d5dd1f3463c376f738502b3a"
    },
    {
      "command": "npm run agent:triage (final append-only failure ledger)",
      "status": "deferred",
      "observed_at": "2026-08-20 Asia/Taipei",
      "revision": "0a52f289a8d6be972eda0626c7656c73731fb287",
      "change_digest": "sha256:3f71d08a02a77a30d53df387d453d29716d67066d5dd1f3463c376f738502b3a"
    },
    {
      "command": "npm run check (approved elevated context with process-local GIT_CONFIG and npm cache; 42 files, 951 passed, 6 skipped)",
      "status": "deferred",
      "observed_at": "2026-08-20 Asia/Taipei",
      "revision": "0a52f289a8d6be972eda0626c7656c73731fb287",
      "change_digest": "sha256:3f71d08a02a77a30d53df387d453d29716d67066d5dd1f3463c376f738502b3a"
    },
    {
      "command": "final repair-batch diff, scope, ignored-evidence, and handoff consistency review",
      "status": "deferred",
      "observed_at": "2026-08-20 Asia/Taipei",
      "revision": "0a52f289a8d6be972eda0626c7656c73731fb287",
      "change_digest": "sha256:3f71d08a02a77a30d53df387d453d29716d67066d5dd1f3463c376f738502b3a"
    },
    {
      "command": "npm run handoff:validate -- --file HANDOFF.md (current promotion digest)",
      "status": "passed",
      "observed_at": "2026-08-20 Asia/Taipei",
      "revision": "0a52f289a8d6be972eda0626c7656c73731fb287",
      "change_digest": "sha256:e0069677a5aaba0227fd1177756578579b0406a8927a62338ef85ed68e9ad24f"
    },
    {
      "command": "npm run review:validate -- --file .reviewready-reviewer-handoff-digest.json (fresh independent reviewer)",
      "status": "passed",
      "observed_at": "2026-08-20 Asia/Taipei",
      "revision": "0a52f289a8d6be972eda0626c7656c73731fb287",
      "change_digest": "sha256:e0069677a5aaba0227fd1177756578579b0406a8927a62338ef85ed68e9ad24f"
    },
    {
      "command": "focused handoff/admission/watchdog/upgrade/research tests (29 passed)",
      "status": "passed",
      "observed_at": "2026-08-20 Asia/Taipei",
      "revision": "0a52f289a8d6be972eda0626c7656c73731fb287",
      "change_digest": "sha256:e0069677a5aaba0227fd1177756578579b0406a8927a62338ef85ed68e9ad24f"
    },
    {
      "command": "npm run check (approved elevated context after handoff digest repair; 42 files, 952 passed, 6 skipped)",
      "status": "passed",
      "observed_at": "2026-08-20 Asia/Taipei",
      "revision": "0a52f289a8d6be972eda0626c7656c73731fb287",
      "change_digest": "sha256:e0069677a5aaba0227fd1177756578579b0406a8927a62338ef85ed68e9ad24f"
    },
    {
      "command": "final npm run agent:triage (append-only failure ledger)",
      "status": "passed",
      "observed_at": "2026-08-20 Asia/Taipei",
      "revision": "0a52f289a8d6be972eda0626c7656c73731fb287",
      "change_digest": "sha256:e0069677a5aaba0227fd1177756578579b0406a8927a62338ef85ed68e9ad24f"
    }
  ],
  "external_writes": {
    "pr": "forbidden-this-round",
    "commit": "authorized-not-done",
    "push": "authorized-not-done"
  },
  "read_order": [
    "AGENTS.md",
    "HANDOFF.md",
    "skills/reviewready-base-delivery/SKILL.md",
    "skills/reviewready-deep-research/SKILL.md",
    "docs/exec-plans/active/post-v1.md"
  ]
}
```

<!-- REVIEWREADY_HANDOFF_JSON_END -->

# CANONICAL AGENT HANDOFF — READ THIS FIRST

This is the one live cross-turn handoff for ReviewReady. Read it after
`AGENTS.md` and before deciding what the project is doing. The JSON payload
between the two `REVIEWREADY_HANDOFF_JSON` markers is authoritative; the
validator rejects missing fields, stale worktree state, changed files, or an
edited handoff that was not refreshed.

## Source-of-truth boundaries

- `HANDOFF.md`: current task state, one active slice, blockers, next action, and
  validation freshness.
- `AGENTS.md`: durable operating rules and safety gates.
- `docs/current-status.md`: dated public/mainline snapshot, not live task state.
- `docs/exec-plans/active/post-v1.md`: fixed product node order and promotion
  gates, not a replacement for this handoff.
- `scripts/independent-review-handoff.mjs` JSON: one review-gate handoff, not
  the whole project handoff.

## Resume protocol

1. Read the JSON payload and obey `outcome`, `blockers`, `external_writes`, and
   exactly one `next_action`.
2. Do not infer completion from old prose, a green fixture, elapsed time, or a
   previous conversation. Re-check the revision and evidence named here.
3. After every meaningful discovery, repair, validation, or external attempt,
   run `npm run handoff:refresh -- --file HANDOFF.md`, update the state fields
   when the slice changed, and run `npm run handoff:validate -- --file HANDOFF.md`.
4. If validation fails, the handoff is incomplete. Repair the handoff state
   before handing work to another agent or ending the turn.

This file is intentionally separate from the per-review JSON contract and from
historical/current-status documents so a new or weaker model has one obvious
place to resume instead of guessing among several partially overlapping files.
