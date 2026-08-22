import {
  MAX_AUDIT_EVIDENCE_SOURCE_BYTES,
  verifyAuditEvidenceSourceArtifact
} from "./audit-evidence-artifact.js";
import {
  assertSortedUniqueStrings,
  boundedText,
  fail,
  hasOwn,
  requiredArray,
  requiredBoolean,
  requiredRecord,
  requiredSafeInteger,
  requiredSha,
  requiredText,
  SHA1,
  SHA256,
  workflowPath
} from "./audit-evidence-bundle-primitives.js";
import { canonicalizeAuditEvidenceJsonValue, type JsonValue } from "./audit-evidence.js";
import { auditRepository, type AuditReport, type AuditSnapshot } from "./audit.js";

type HydratedCheck = AuditSnapshot["policy"]["requiredChecks"][number];
type HydratedBranchActor = NonNullable<
  NonNullable<AuditSnapshot["branchProtection"]>["requiredPullRequestReviews"]
>["bypassActors"][number];
type HydratedRulesetActor = AuditSnapshot["rulesets"][number]["bypassActors"][number];

function hydrateChecks(value: JsonValue, code: string): HydratedCheck[] {
  const checks = requiredArray(value, code);
  return checks.map((entry) => {
    const check = requiredRecord(entry, code);
    return {
      name: requiredText(check.name, code),
      ...(hasOwn(check, "appId") ? { appId: requiredSafeInteger(check.appId, code) } : {}),
      ...(hasOwn(check, "appSlug") ? { appSlug: requiredText(check.appSlug, code) } : {})
    };
  });
}

function redactedActorType(actorType: string): "user" | "team" | "app" | "integration" {
  if (actorType === "user" || actorType === "team" || actorType === "integration") {
    return actorType;
  }
  return "app";
}

function hydrateBranchBypassActors(value: JsonValue): HydratedBranchActor[] {
  const summaries = requiredArray(value, "bundle-bypass");
  const actors: HydratedBranchActor[] = [];
  let index = 0;
  for (const entry of summaries) {
    const summary = requiredRecord(entry, "bundle-bypass");
    const actorType = requiredText(summary.actorType, "bundle-bypass");
    const count = requiredSafeInteger(summary.count, "bundle-bypass");
    for (let offset = 0; offset < count; offset += 1) {
      index += 1;
      actors.push({
        id: "redacted:" + actorType + ":branch:" + String(index),
        type: redactedActorType(actorType)
      });
    }
  }
  return actors;
}

function hydrateRulesetBypassActors(value: JsonValue): HydratedRulesetActor[] {
  const summaries = requiredArray(value, "bundle-bypass");
  const actors: HydratedRulesetActor[] = [];
  let index = 0;
  for (const entry of summaries) {
    const summary = requiredRecord(entry, "bundle-bypass");
    const actorType = requiredText(summary.actorType, "bundle-bypass");
    const bypassMode = requiredText(summary.bypassMode, "bundle-bypass");
    const count = requiredSafeInteger(summary.count, "bundle-bypass");
    for (let offset = 0; offset < count; offset += 1) {
      index += 1;
      actors.push({
        id: "redacted:" + actorType + ":" + bypassMode + ":" + String(index),
        type: redactedActorType(actorType),
        actorType: actorType as HydratedRulesetActor["actorType"],
        bypassMode: bypassMode as HydratedRulesetActor["bypassMode"]
      });
    }
  }
  return actors;
}

function hydrateBranchProtection(value: JsonValue): AuditSnapshot["branchProtection"] {
  if (value === null) {
    return null;
  }
  const branchProtection = requiredRecord(value, "bundle-branch-protection");
  const requiredStatusChecks =
    branchProtection.requiredStatusChecks === null ||
    branchProtection.requiredStatusChecks === undefined
      ? null
      : (() => {
          const checks = requiredRecord(
            branchProtection.requiredStatusChecks,
            "bundle-branch-protection"
          );
          return {
            strict: requiredBoolean(checks.strict, "bundle-branch-protection"),
            checks: hydrateChecks(checks.checks as JsonValue, "bundle-branch-protection")
          };
        })();
  const requiredPullRequestReviews =
    branchProtection.requiredPullRequestReviews === null ||
    branchProtection.requiredPullRequestReviews === undefined
      ? null
      : (() => {
          const reviews = requiredRecord(
            branchProtection.requiredPullRequestReviews,
            "bundle-branch-protection"
          );
          const known = requiredBoolean(reviews.bypassActorsKnown, "bundle-branch-protection");
          return {
            requiredApprovingReviewCount: requiredSafeInteger(
              reviews.requiredApprovingReviewCount,
              "bundle-branch-protection"
            ),
            bypassActors: hydrateBranchBypassActors(reviews.bypassActorSummaries as JsonValue),
            bypassActorsKnown: known
          };
        })();
  return {
    branch: requiredText(branchProtection.branch, "bundle-branch-protection"),
    exists: requiredBoolean(branchProtection.exists, "bundle-branch-protection"),
    enforceAdmins: requiredBoolean(branchProtection.enforceAdmins, "bundle-branch-protection"),
    allowForcePushes: requiredBoolean(
      branchProtection.allowForcePushes,
      "bundle-branch-protection"
    ),
    allowDeletions: requiredBoolean(branchProtection.allowDeletions, "bundle-branch-protection"),
    requiredStatusChecks,
    requiredPullRequestReviews
  };
}

function hydrateRulesetPullRequest(
  value: JsonValue
): NonNullable<AuditSnapshot["rulesets"][number]["pullRequest"]> {
  const pullRequest = requiredRecord(value, "bundle-ruleset-review");
  const allowedMergeMethods = assertSortedUniqueStrings(
    pullRequest.allowedMergeMethods,
    (entry) => entry === "merge" || entry === "squash" || entry === "rebase",
    "bundle-ruleset-review"
  ) as ("merge" | "squash" | "rebase")[];
  return {
    allowedMergeMethods,
    dismissStaleReviewsOnPush: requiredBoolean(
      pullRequest.dismissStaleReviewsOnPush,
      "bundle-ruleset-review"
    ),
    requireCodeOwnerReview: requiredBoolean(
      pullRequest.requireCodeOwnerReview,
      "bundle-ruleset-review"
    ),
    requireLastPushApproval: requiredBoolean(
      pullRequest.requireLastPushApproval,
      "bundle-ruleset-review"
    ),
    requiredApprovingReviewCount: requiredSafeInteger(
      pullRequest.requiredApprovingReviewCount,
      "bundle-ruleset-review"
    ),
    requiredReviewThreadResolution: requiredBoolean(
      pullRequest.requiredReviewThreadResolution,
      "bundle-ruleset-review"
    ),
    requiredReviewers: []
  };
}

function hydrateRequiredStatusChecksPolicy(
  value: JsonValue
): NonNullable<AuditSnapshot["rulesets"][number]["requiredStatusChecksPolicy"]> {
  const policy = requiredRecord(value, "bundle-ruleset-status");
  return {
    doNotEnforceOnCreate: requiredBoolean(policy.doNotEnforceOnCreate, "bundle-ruleset-status"),
    strictRequiredStatusChecksPolicy: requiredBoolean(
      policy.strictRequiredStatusChecksPolicy,
      "bundle-ruleset-status"
    )
  };
}

function hydrateRulesets(value: JsonValue, snapshotVersion: 1 | 2): AuditSnapshot["rulesets"] {
  return requiredArray(value, "bundle-rulesets").map((entry) => {
    const ruleset = requiredRecord(entry, "bundle-ruleset");
    return {
      id: requiredSafeInteger(ruleset.id, "bundle-ruleset"),
      name: requiredText(ruleset.name, "bundle-ruleset"),
      target: requiredText(ruleset.target, "bundle-ruleset") as
        "branch" | "tag" | "push" | "repository",
      refPatterns: assertSortedUniqueStrings(ruleset.refPatterns, boundedText, "bundle-ruleset"),
      ...(hasOwn(ruleset, "repositoryPatterns")
        ? {
            repositoryPatterns: assertSortedUniqueStrings(
              ruleset.repositoryPatterns,
              boundedText,
              "bundle-ruleset"
            )
          }
        : {}),
      enforcement: requiredText(ruleset.enforcement, "bundle-ruleset") as
        "active" | "evaluate" | "disabled",
      bypassActors: hydrateRulesetBypassActors(ruleset.bypassActorSummaries as JsonValue),
      bypassActorsKnown: requiredBoolean(ruleset.bypassActorsKnown, "bundle-ruleset"),
      ...(hasOwn(ruleset, "allowForcePushes")
        ? { allowForcePushes: requiredBoolean(ruleset.allowForcePushes, "bundle-ruleset") }
        : {}),
      ...(hasOwn(ruleset, "allowDeletions")
        ? { allowDeletions: requiredBoolean(ruleset.allowDeletions, "bundle-ruleset") }
        : {}),
      requiredChecks: hydrateChecks(ruleset.requiredChecks as JsonValue, "bundle-ruleset"),
      ...(snapshotVersion === 2 && hasOwn(ruleset, "pullRequest")
        ? { pullRequest: hydrateRulesetPullRequest(ruleset.pullRequest as JsonValue) }
        : {}),
      ...(snapshotVersion === 2 && hasOwn(ruleset, "requiredStatusChecksPolicy")
        ? {
            requiredStatusChecksPolicy: hydrateRequiredStatusChecksPolicy(
              ruleset.requiredStatusChecksPolicy as JsonValue
            )
          }
        : {})
    };
  });
}

function hydrateWorkflows(
  snapshot: Record<string, JsonValue>,
  artifacts: Record<string, JsonValue>,
  requestedBaseSha: string
): AuditSnapshot["workflows"] {
  const artifactEntries = requiredArray(artifacts.workflows, "bundle-artifacts");
  const artifactsByPath = new Map<string, JsonValue>();
  for (const artifact of artifactEntries) {
    const item = requiredRecord(artifact, "bundle-artifacts");
    artifactsByPath.set(requiredText(item.path, "bundle-artifacts"), artifact);
  }
  return requiredArray(snapshot.workflows, "bundle-workflows").map((entry) => {
    const workflow = requiredRecord(entry, "bundle-workflow");
    const path = requiredText(workflow.path, "bundle-workflow");
    const artifactValue = artifactsByPath.get(path);
    if (artifactValue === undefined || artifactValue === null) {
      fail("bundle-artifact-binding");
    }
    const artifact = requiredRecord(artifactValue, "bundle-artifacts");
    const verified = verifyAuditEvidenceSourceArtifact(artifact, "workflow");
    if (
      verified.bytes.byteLength > MAX_AUDIT_EVIDENCE_SOURCE_BYTES ||
      requiredText(workflow.revisionSha, "bundle-workflow") !== requestedBaseSha ||
      requiredText(workflow.artifactSha256, "bundle-workflow") !==
        requiredText(artifact.sha256, "bundle-artifacts")
    ) {
      fail("bundle-artifact-binding");
    }
    return {
      path,
      revisionSha: requestedBaseSha,
      protectedFromPullRequest: false,
      trustedRoot: false,
      source: verified.text
    };
  });
}

function hydrateAuditSnapshot(
  bundle: Record<string, JsonValue>,
  snapshot: Record<string, JsonValue>,
  requestedBaseSha: string,
  policyPath: string
): AuditSnapshot {
  const repository = requiredRecord(snapshot.repository, "bundle-snapshot");
  const baseRevision = requiredRecord(snapshot.baseRevision, "bundle-revision");
  const policy = requiredRecord(snapshot.policy, "bundle-policy");
  const completeness = requiredRecord(snapshot.completeness, "bundle-completeness");
  const tagProtection = requiredRecord(snapshot.tagProtection, "bundle-tag-protection");
  const artifacts = requiredRecord(bundle.artifacts, "bundle-artifacts");
  return {
    version: 1,
    repository: {
      owner: requiredText(repository.owner, "bundle-snapshot"),
      name: requiredText(repository.name, "bundle-snapshot"),
      defaultBranch: requiredText(repository.defaultBranch, "bundle-snapshot")
    },
    baseRevision: {
      sha: requestedBaseSha,
      policyPath,
      policyRevisionSha: requiredSha(baseRevision.policyRevisionSha, SHA1, "bundle-revision"),
      policySha256: requiredSha(baseRevision.policySha256, SHA256, "bundle-revision"),
      policyLoadedFromBase: requiredBoolean(baseRevision.policyLoadedFromBase, "bundle-revision")
    },
    policy: {
      requiredChecks: hydrateChecks(policy.requiredChecks as JsonValue, "bundle-policy"),
      workflowPaths: assertSortedUniqueStrings(policy.workflowPaths, workflowPath, "bundle-policy")
    },
    completeness: {
      complete: requiredBoolean(completeness.complete, "bundle-completeness"),
      missing: assertSortedUniqueStrings(
        completeness.missing,
        (entry) =>
          entry === "settings-authority-incomplete" || entry === "settings-observation-mismatch",
        "bundle-completeness"
      )
    },
    branchProtection: hydrateBranchProtection(snapshot.branchProtection as JsonValue),
    rulesets: hydrateRulesets(
      snapshot.rulesets as JsonValue,
      requiredSafeInteger(snapshot.snapshotVersion, "bundle-snapshot") as 1 | 2
    ),
    tagProtection: {
      known: requiredBoolean(tagProtection.known, "bundle-tag-protection"),
      allowsDeletion: requiredBoolean(tagProtection.allowsDeletion, "bundle-tag-protection"),
      allowsUpdate: requiredBoolean(tagProtection.allowsUpdate, "bundle-tag-protection")
    },
    workflows: hydrateWorkflows(snapshot, artifacts, requestedBaseSha)
  };
}

export function recomputeAuditReport(
  bundle: Record<string, JsonValue>,
  snapshot: Record<string, JsonValue>,
  requestedBaseSha: string,
  policyPath: string
): { readonly snapshot: AuditSnapshot; readonly report: AuditReport } {
  const hydratedSnapshot = hydrateAuditSnapshot(bundle, snapshot, requestedBaseSha, policyPath);
  const report = auditRepository(hydratedSnapshot);
  const savedReport = requiredRecord(bundle.report, "bundle-report");
  if (
    canonicalizeAuditEvidenceJsonValue(report) !== canonicalizeAuditEvidenceJsonValue(savedReport)
  ) {
    fail("bundle-report-recomputed");
  }
  return { snapshot: hydratedSnapshot, report };
}
