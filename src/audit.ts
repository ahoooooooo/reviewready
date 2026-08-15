import { z } from "zod";
import micromatch from "micromatch";

import {
  MAX_WORKFLOW_SOURCE_BYTES,
  analyzeWorkflowSource,
  type WorkflowSecurityFinding
} from "./workflow-security.js";

export const AUDIT_VERSION = 1 as const;
export const MAX_AUDIT_CHECKS = 100;
export const MAX_AUDIT_RULESETS = 100;
export const MAX_AUDIT_WORKFLOWS = 100;
export const MAX_AUDIT_FINDINGS = 500;

const SHA = z.string().regex(/^[0-9a-f]{40}$/iu);
const UNSAFE_TEXT = /[\p{Control}\p{Format}\p{Surrogate}\u2028\u2029]/u;
const TEXT = z
  .string()
  .min(1)
  .refine((value) => Array.from(value).length <= 512)
  .refine((value) => !UNSAFE_TEXT.test(value));

const REPOSITORY_PATH = TEXT.refine(
  (value) =>
    !value.includes("\\") &&
    !value.startsWith("/") &&
    !/^[a-z]:/iu.test(value) &&
    !value.split("/").some((part) => part === "" || part === "." || part === "..") &&
    !UNSAFE_TEXT.test(value),
  "must be a bounded repository-relative path"
);

const actorSchema = z
  .object({
    id: TEXT,
    type: z.enum(["user", "team", "app", "integration"]).optional(),
    actorType: z
      .enum(["user", "team", "integration", "organization_admin", "repository_role", "deploy_key"])
      .optional(),
    bypassMode: z.enum(["always", "exempt", "pull_request"]).optional()
  })
  .strict();
const checkSchema = z
  .object({
    name: TEXT,
    appId: z.number().int().min(1).max(2_147_483_647).optional(),
    appSlug: TEXT.optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.appId !== undefined && value.appSlug !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["appSlug"],
        message: "appId and appSlug are mutually exclusive"
      });
    }
  });
const checksSchema = z.array(checkSchema).max(MAX_AUDIT_CHECKS);

const rulesetPullRequestSchema = z
  .object({
    allowedMergeMethods: z
      .array(z.enum(["merge", "squash", "rebase"]))
      .min(1)
      .max(3),
    dismissStaleReviewsOnPush: z.boolean(),
    requireCodeOwnerReview: z.boolean(),
    requireLastPushApproval: z.boolean(),
    requiredApprovingReviewCount: z.number().int().nonnegative().max(100),
    requiredReviewThreadResolution: z.boolean(),
    requiredReviewers: z.array(z.never()).max(100)
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.allowedMergeMethods).size !== value.allowedMergeMethods.length) {
      context.addIssue({
        code: "custom",
        path: ["allowedMergeMethods"],
        message: "allowed merge methods must be unique"
      });
    }
  });

const requiredStatusChecksPolicySchema = z
  .object({
    doNotEnforceOnCreate: z.boolean(),
    strictRequiredStatusChecksPolicy: z.boolean()
  })
  .strict();

const branchProtectionSchema = z
  .object({
    branch: TEXT,
    exists: z.boolean(),
    enforceAdmins: z.boolean(),
    allowForcePushes: z.boolean(),
    allowDeletions: z.boolean(),
    requiredStatusChecks: z
      .object({ strict: z.boolean(), checks: checksSchema })
      .strict()
      .nullable(),
    requiredPullRequestReviews: z
      .object({
        requiredApprovingReviewCount: z.number().int().nonnegative().max(100),
        bypassActors: z.array(actorSchema).max(100),
        bypassActorsKnown: z.boolean().optional()
      })
      .strict()
      .nullable()
  })
  .strict();

const rulesetSchema = z
  .object({
    id: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    name: TEXT,
    target: z.enum(["branch", "tag", "push", "repository"]),
    refPatterns: z.array(TEXT).max(100),
    repositoryPatterns: z.array(TEXT).max(100).optional(),
    enforcement: z.enum(["active", "evaluate", "disabled"]),
    bypassActors: z.array(actorSchema).max(100),
    bypassActorsKnown: z.boolean().optional(),
    allowForcePushes: z.boolean().optional(),
    allowDeletions: z.boolean().optional(),
    requiredChecks: checksSchema,
    pullRequest: rulesetPullRequestSchema.optional(),
    requiredStatusChecksPolicy: requiredStatusChecksPolicySchema.optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.target === "branch" || value.target === "tag") &&
      (value.allowForcePushes === undefined || value.allowDeletions === undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["allowForcePushes"],
        message: "branch and tag rulesets require force-push and deletion facts"
      });
    }
    if (value.target === "repository") {
      if (value.enforcement === "evaluate") {
        context.addIssue({
          code: "custom",
          path: ["enforcement"],
          message: "repository rulesets cannot use evaluate enforcement"
        });
      }
      if (value.refPatterns.length > 0) {
        context.addIssue({
          code: "custom",
          path: ["refPatterns"],
          message: "repository rulesets cannot contain ref patterns"
        });
      }
      if (value.repositoryPatterns === undefined || value.repositoryPatterns.length === 0) {
        context.addIssue({
          code: "custom",
          path: ["repositoryPatterns"],
          message: "repository rulesets require an evaluated repository scope"
        });
      }
      if (value.allowForcePushes !== undefined || value.allowDeletions !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["allowForcePushes"],
          message: "repository rulesets cannot contain branch control facts"
        });
      }
    }
    if (value.target === "push") {
      if (value.refPatterns.length > 0) {
        context.addIssue({
          code: "custom",
          path: ["refPatterns"],
          message: "push rulesets cannot contain ref patterns"
        });
      }
      if (value.allowForcePushes !== undefined || value.allowDeletions !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["allowForcePushes"],
          message: "push rulesets cannot contain branch control facts"
        });
      }
    }
  });

const auditSnapshotSchema = z
  .object({
    version: z.literal(1),
    repository: z.object({ owner: TEXT, name: TEXT, defaultBranch: TEXT }).strict(),
    baseRevision: z
      .object({
        sha: SHA,
        policyPath: REPOSITORY_PATH,
        policyRevisionSha: SHA,
        policySha256: z
          .string()
          .regex(/^[0-9a-f]{64}$/iu)
          .optional(),
        policyLoadedFromBase: z.boolean()
      })
      .strict(),
    policy: z
      .object({
        requiredChecks: checksSchema,
        workflowPaths: z.array(REPOSITORY_PATH).max(MAX_AUDIT_WORKFLOWS)
      })
      .strict(),
    completeness: z.object({ complete: z.boolean(), missing: z.array(TEXT).max(100) }).strict(),
    branchProtection: branchProtectionSchema.nullable(),
    rulesets: z
      .array(rulesetSchema)
      .max(MAX_AUDIT_RULESETS)
      .superRefine((rulesets, context) => {
        const ids = new Set<number>();
        rulesets.forEach((ruleset, index) => {
          if (ids.has(ruleset.id)) {
            context.addIssue({
              code: "custom",
              path: [index, "id"],
              message: "ruleset IDs must be unique"
            });
          }
          ids.add(ruleset.id);
        });
      }),
    tagProtection: z
      .object({ known: z.boolean(), allowsDeletion: z.boolean(), allowsUpdate: z.boolean() })
      .strict(),
    workflows: z
      .array(
        z
          .object({
            path: REPOSITORY_PATH,
            revisionSha: SHA,
            protectedFromPullRequest: z.boolean(),
            trustedRoot: z.boolean(),
            source: z
              .string()
              .max(MAX_WORKFLOW_SOURCE_BYTES)
              .refine((value) => Buffer.byteLength(value, "utf8") <= MAX_WORKFLOW_SOURCE_BYTES)
          })
          .strict()
      )
      .max(MAX_AUDIT_WORKFLOWS)
  })
  .strict();

export type AuditSnapshot = z.infer<typeof auditSnapshotSchema>;

export type AuditStatus = "pass" | "fail" | "incomplete";
export type AuditFindingCategory =
  "completeness" | "integrity" | "configuration" | "provenance" | "workflow";

export interface AuditFinding {
  readonly code: string;
  readonly category: AuditFindingCategory;
  readonly severity: "error" | "warning";
  readonly path?: string | undefined;
  readonly line?: number | undefined;
  readonly message: string;
}

export interface AuditReport {
  readonly auditVersion: typeof AUDIT_VERSION;
  readonly status: AuditStatus;
  readonly repository: {
    readonly owner: string;
    readonly name: string;
    readonly baseSha: string;
  };
  readonly findings: readonly AuditFinding[];
  readonly checked: readonly string[];
}

function auditFinding(
  code: string,
  category: AuditFindingCategory,
  message: string,
  path?: string,
  severity: "error" | "warning" = "error"
): AuditFinding {
  return { code, category, severity, ...(path === undefined ? {} : { path }), message };
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sarifUri(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function checkIdentity(check: {
  readonly appId?: number | undefined;
  readonly appSlug?: string | undefined;
}): string {
  if (check.appId !== undefined) {
    return `app-id:${String(check.appId)}`;
  }
  if (check.appSlug !== undefined) {
    return `app:${check.appSlug.toLowerCase()}`;
  }
  return "unknown";
}

function appendCheckFindings(
  checks: readonly {
    readonly name: string;
    readonly appId?: number | undefined;
    readonly appSlug?: string | undefined;
  }[],
  path: string,
  findings: AuditFinding[]
): void {
  const byName = new Map<string, Set<string>>();
  for (const check of checks) {
    const identities = byName.get(check.name) ?? new Set<string>();
    identities.add(checkIdentity(check));
    byName.set(check.name, identities);
  }
  const names = [...byName.keys()].sort(compareStrings);
  for (const [index, name] of names.entries()) {
    const identities = byName.get(name);
    if (identities === undefined) {
      continue;
    }
    const findingPath = `${path}[${String(index)}]`;
    if (identities.has("unknown")) {
      findings.push(
        auditFinding(
          "AUDIT_CHECK_PROVENANCE_UNKNOWN",
          "provenance",
          "Required check has no trusted App or provider identity.",
          findingPath
        )
      );
    }
    if (identities.size > 1) {
      findings.push(
        auditFinding(
          "AUDIT_CHECK_NAME_AMBIGUOUS",
          "provenance",
          "The same required check name has multiple producer identities.",
          findingPath
        )
      );
    }
  }
}

interface RulesetScopeEvaluation {
  readonly applies: boolean;
  readonly valid: boolean;
}

function evaluateRulesetRepositoryScope(
  ruleset: AuditSnapshot["rulesets"][number],
  repository: AuditSnapshot["repository"]
): RulesetScopeEvaluation {
  if (ruleset.repositoryPatterns === undefined) {
    return { applies: true, valid: true };
  }
  if (
    ruleset.repositoryPatterns.length === 0 ||
    ruleset.repositoryPatterns.some((pattern) => !validRefPattern(pattern))
  ) {
    return { applies: false, valid: false };
  }
  const candidates = [`${repository.owner}/${repository.name}`, repository.name];
  try {
    return {
      applies: ruleset.repositoryPatterns.some(
        (pattern) =>
          pattern === "~ALL" ||
          candidates.some((candidate) =>
            micromatch.isMatch(candidate, pattern, { dot: true, nonegate: true })
          )
      ),
      valid: true
    };
  } catch {
    return { applies: false, valid: false };
  }
}

function balancedGlobDelimiters(pattern: string): boolean {
  let brackets = 0;
  let braces = 0;
  let escaped = false;
  for (const character of pattern) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "[") {
      brackets += 1;
    } else if (character === "]") {
      brackets -= 1;
    } else if (character === "{") {
      braces += 1;
    } else if (character === "}") {
      braces -= 1;
    }
    if (brackets < 0 || braces < 0) {
      return false;
    }
  }
  return !escaped && brackets === 0 && braces === 0;
}

function validRefPattern(pattern: string): boolean {
  return !pattern.includes("\\") && !UNSAFE_TEXT.test(pattern) && balancedGlobDelimiters(pattern);
}

function evaluateRulesetScope(
  ruleset: AuditSnapshot["rulesets"][number],
  defaultBranch: string
): RulesetScopeEvaluation {
  if (ruleset.target === "repository") {
    return { applies: true, valid: true };
  }
  if (ruleset.target !== "branch") {
    return { applies: false, valid: true };
  }
  if (
    ruleset.refPatterns.length === 0 ||
    ruleset.refPatterns.some((pattern) => !validRefPattern(pattern))
  ) {
    return { applies: false, valid: false };
  }
  const ref = `refs/heads/${defaultBranch}`;
  try {
    return {
      applies: ruleset.refPatterns.some((pattern) => {
        if (pattern === "~ALL" || pattern === "~DEFAULT_BRANCH") {
          return true;
        }
        return micromatch.isMatch(ref, pattern, { dot: true, nonegate: true });
      }),
      valid: true
    };
  } catch {
    return { applies: false, valid: false };
  }
}

function auditSnapshot(snapshot: AuditSnapshot): AuditReport {
  const findings: AuditFinding[] = [];
  let hasIncomplete = false;
  const add = (result: AuditFinding, incomplete = false): void => {
    findings.push(result);
    hasIncomplete ||= incomplete;
  };

  if (!snapshot.completeness.complete || snapshot.completeness.missing.length > 0) {
    add(
      auditFinding(
        "AUDIT_SNAPSHOT_INCOMPLETE",
        "completeness",
        "The normalized repository snapshot is incomplete.",
        "completeness"
      ),
      true
    );
  }
  if (!snapshot.baseRevision.policyLoadedFromBase) {
    add(
      auditFinding(
        "AUDIT_POLICY_NOT_FROM_BASE",
        "integrity",
        "The effective policy was not loaded from the evaluated base revision.",
        "baseRevision.policyLoadedFromBase"
      ),
      true
    );
  }
  if (snapshot.baseRevision.policyRevisionSha !== snapshot.baseRevision.sha) {
    add(
      auditFinding(
        "AUDIT_POLICY_SHA_MISMATCH",
        "integrity",
        "Policy revision does not match the evaluated base revision.",
        "baseRevision.policyRevisionSha"
      ),
      true
    );
  }

  const branchProtection = snapshot.branchProtection;
  if (branchProtection === null || !branchProtection.exists) {
    add(
      auditFinding(
        "AUDIT_BRANCH_PROTECTION_UNKNOWN",
        "completeness",
        "Protection for the evaluated default branch is missing or unknown.",
        "branchProtection"
      ),
      true
    );
  }

  if (branchProtection !== null && branchProtection.exists) {
    if (branchProtection.branch !== snapshot.repository.defaultBranch) {
      add(
        auditFinding(
          "AUDIT_BRANCH_PROTECTION_WRONG_BRANCH",
          "integrity",
          "Protection facts do not describe the evaluated default branch.",
          "branchProtection.branch"
        ),
        true
      );
    }
    if (branchProtection.allowForcePushes) {
      add(
        auditFinding(
          "AUDIT_FORCE_PUSH_ALLOWED",
          "configuration",
          "Force pushes are allowed.",
          "branchProtection.allowForcePushes"
        )
      );
    }
    if (branchProtection.allowDeletions) {
      add(
        auditFinding(
          "AUDIT_BRANCH_DELETION_ALLOWED",
          "configuration",
          "Default branch deletion is allowed.",
          "branchProtection.allowDeletions"
        )
      );
    }
    if (!branchProtection.enforceAdmins) {
      add(
        auditFinding(
          "AUDIT_ADMIN_BYPASS_ALLOWED",
          "configuration",
          "Administrators are not subject to the evaluated protection rules.",
          "branchProtection.enforceAdmins"
        )
      );
    }
    if (branchProtection.requiredPullRequestReviews === null) {
      add(
        auditFinding(
          "AUDIT_REVIEW_RULES_UNKNOWN",
          "completeness",
          "Pull-request review rules are unknown.",
          "branchProtection.requiredPullRequestReviews"
        ),
        true
      );
    } else {
      if (branchProtection.requiredPullRequestReviews.requiredApprovingReviewCount === 0) {
        add(
          auditFinding(
            "AUDIT_REVIEWS_NOT_REQUIRED",
            "configuration",
            "Branch protection does not require an approving pull-request review.",
            "branchProtection.requiredPullRequestReviews.requiredApprovingReviewCount"
          )
        );
      }
      if (branchProtection.requiredPullRequestReviews.bypassActorsKnown !== true) {
        add(
          auditFinding(
            "AUDIT_REVIEW_BYPASS_UNKNOWN",
            "completeness",
            "Pull-request review bypass actors were not visible to the collector.",
            "branchProtection.requiredPullRequestReviews.bypassActors"
          ),
          true
        );
      }
      if (branchProtection.requiredPullRequestReviews.bypassActors.length > 0) {
        add(
          auditFinding(
            "AUDIT_BYPASS_ACTOR_ALLOWED",
            "configuration",
            "Review bypass actors are configured.",
            "branchProtection.requiredPullRequestReviews.bypassActors"
          )
        );
      }
    }
    if (
      branchProtection.requiredStatusChecks !== null &&
      !branchProtection.requiredStatusChecks.strict
    ) {
      add(
        auditFinding(
          "AUDIT_STATUS_CHECKS_NOT_STRICT",
          "configuration",
          "Required status checks do not require the branch to be up to date.",
          "branchProtection.requiredStatusChecks.strict"
        )
      );
    }
  }

  const applicableRulesets: AuditSnapshot["rulesets"] = [];
  const relevantRulesets: AuditSnapshot["rulesets"] = [];
  for (const ruleset of snapshot.rulesets) {
    const repositoryScope = evaluateRulesetRepositoryScope(ruleset, snapshot.repository);
    if (!repositoryScope.valid) {
      add(
        auditFinding(
          "AUDIT_RULESET_SCOPE_INVALID",
          "completeness",
          "A ruleset has an invalid or empty repository scope.",
          `rulesets.${String(ruleset.id)}.repositoryPatterns`
        ),
        true
      );
      continue;
    }
    if (!repositoryScope.applies) {
      continue;
    }
    const scope = evaluateRulesetScope(ruleset, snapshot.repository.defaultBranch);
    if (ruleset.target === "branch" && !scope.valid) {
      add(
        auditFinding(
          "AUDIT_RULESET_SCOPE_INVALID",
          "completeness",
          "An active or configured branch ruleset has an invalid or empty ref scope.",
          `rulesets.${String(ruleset.id)}.refPatterns`
        ),
        true
      );
      continue;
    }
    if (ruleset.target === "branch" && !scope.applies) {
      continue;
    }
    if (ruleset.target !== "branch" && ruleset.target !== "repository") {
      if (ruleset.target === "tag" && ruleset.enforcement === "active") {
        add(
          auditFinding(
            "AUDIT_RULESET_SCOPE_UNSUPPORTED",
            "completeness",
            "An active tag ruleset is not evaluated by the branch audit contract.",
            "rulesets." + String(ruleset.id) + ".target"
          ),
          true
        );
      }
      continue;
    }
    relevantRulesets.push(ruleset);
    if (ruleset.enforcement === "active" && scope.applies) {
      applicableRulesets.push(ruleset);
    }
  }
  const effectiveChecks = [
    ...(branchProtection?.requiredStatusChecks?.checks ?? []),
    ...applicableRulesets.flatMap((ruleset) => ruleset.requiredChecks)
  ];
  if (
    branchProtection?.requiredStatusChecks === null &&
    snapshot.policy.requiredChecks.length > 0
  ) {
    add(
      auditFinding(
        "AUDIT_REQUIRED_CHECKS_UNKNOWN",
        "completeness",
        "Required status checks are unknown.",
        "branchProtection.requiredStatusChecks"
      ),
      true
    );
  }
  appendCheckFindings(effectiveChecks, "requiredChecks", findings);
  for (const [index, requiredCheck] of snapshot.policy.requiredChecks.entries()) {
    const matchingChecks = effectiveChecks.filter((check) => check.name === requiredCheck.name);
    if (matchingChecks.length === 0) {
      add(
        auditFinding(
          "AUDIT_REQUIRED_CHECK_MISSING",
          "integrity",
          "A policy-required check is absent from the protected configuration.",
          `policy.requiredChecks[${String(index)}]`
        ),
        true
      );
    } else if (
      (requiredCheck.appId !== undefined || requiredCheck.appSlug !== undefined) &&
      !matchingChecks.some((check) => checkIdentity(check) === checkIdentity(requiredCheck))
    ) {
      add(
        auditFinding(
          "AUDIT_CHECK_PROVENANCE_MISMATCH",
          "provenance",
          "A policy-required check is supplied by a different provider identity.",
          `policy.requiredChecks[${String(index)}]`
        )
      );
    }
  }

  for (const ruleset of relevantRulesets) {
    const path = `rulesets.${String(ruleset.id)}`;
    if (ruleset.bypassActorsKnown !== true) {
      add(
        auditFinding(
          "AUDIT_RULESET_BYPASS_UNKNOWN",
          "completeness",
          "Ruleset bypass actors were not visible to the collector.",
          `${path}.bypassActors`
        ),
        true
      );
    }
    if (ruleset.enforcement !== "active" && ruleset.target === "branch") {
      add(
        auditFinding(
          "AUDIT_RULESET_NOT_ACTIVE",
          "completeness",
          "A branch-targeting ruleset is not active.",
          `${path}.enforcement`
        ),
        true
      );
    }
    if (ruleset.bypassActors.length > 0) {
      add(
        auditFinding(
          "AUDIT_BYPASS_ACTOR_ALLOWED",
          "configuration",
          "Ruleset bypass actors are configured.",
          `${path}.bypassActors`
        )
      );
    }
    if (ruleset.allowForcePushes) {
      add(
        auditFinding(
          "AUDIT_FORCE_PUSH_ALLOWED",
          "configuration",
          "A ruleset allows force pushes.",
          `${path}.allowForcePushes`
        )
      );
    }
    if (ruleset.allowDeletions) {
      add(
        auditFinding(
          "AUDIT_BRANCH_DELETION_ALLOWED",
          "configuration",
          "A ruleset allows branch deletion.",
          `${path}.allowDeletions`
        )
      );
    }
  }

  if (!snapshot.tagProtection.known) {
    add(
      auditFinding(
        "AUDIT_TAG_PROTECTION_UNKNOWN",
        "completeness",
        "Tag protection facts are unknown.",
        "tagProtection"
      ),
      true
    );
  } else {
    if (snapshot.tagProtection.allowsDeletion) {
      add(
        auditFinding(
          "AUDIT_TAG_DELETION_ALLOWED",
          "configuration",
          "Tag deletion is allowed.",
          "tagProtection.allowsDeletion"
        )
      );
    }
    if (snapshot.tagProtection.allowsUpdate) {
      add(
        auditFinding(
          "AUDIT_TAG_UPDATE_ALLOWED",
          "configuration",
          "Tag updates are allowed.",
          "tagProtection.allowsUpdate"
        )
      );
    }
  }

  const workflowsByPath = new Map<string, AuditSnapshot["workflows"][number]>();
  for (const workflow of snapshot.workflows) {
    if (workflowsByPath.has(workflow.path)) {
      add(
        auditFinding(
          "AUDIT_WORKFLOW_DUPLICATE",
          "provenance",
          "A workflow path appears more than once in the snapshot.",
          workflow.path
        )
      );
    }
    workflowsByPath.set(workflow.path, workflow);
  }
  for (const workflowPath of snapshot.policy.workflowPaths) {
    const workflow = workflowsByPath.get(workflowPath);
    if (workflow === undefined) {
      add(
        auditFinding(
          "AUDIT_WORKFLOW_MISSING",
          "completeness",
          "A policy workflow path is absent from the normalized snapshot.",
          workflowPath
        ),
        true
      );
      continue;
    }
  }

  for (const workflow of snapshot.workflows) {
    if (workflow.revisionSha !== snapshot.baseRevision.sha) {
      add(
        auditFinding(
          "AUDIT_WORKFLOW_NOT_FROM_BASE",
          "integrity",
          "A workflow was not read from the evaluated base revision.",
          `${workflow.path}.revisionSha`
        ),
        true
      );
    }
    if (!workflow.protectedFromPullRequest) {
      add(
        auditFinding(
          "AUDIT_WORKFLOW_NOT_PROTECTED",
          "configuration",
          "A workflow can be modified by a pull request.",
          workflow.path
        )
      );
    }
    if (!workflow.trustedRoot) {
      add(
        auditFinding(
          "AUDIT_TRUSTED_ROOT_MISSING",
          "configuration",
          "A workflow is not declared under a protected trusted root.",
          workflow.path
        )
      );
    }
    const analysis = analyzeWorkflowSource(workflow.path, workflow.source);
    for (const finding of analysis.findings) {
      addWorkflowFinding(findings, finding);
      hasIncomplete ||= finding.ruleId === "WORKFLOW_FINDINGS_TRUNCATED";
    }
  }

  findings.sort(compareAuditFindings);
  if (findings.length > MAX_AUDIT_FINDINGS) {
    findings.length = MAX_AUDIT_FINDINGS - 1;
    findings.push(
      auditFinding(
        "AUDIT_FINDINGS_TRUNCATED",
        "completeness",
        "The audit finding limit was reached; the result is incomplete.",
        "findings"
      )
    );
    hasIncomplete = true;
  }
  findings.sort(compareAuditFindings);
  const status: AuditStatus = hasIncomplete ? "incomplete" : findings.length > 0 ? "fail" : "pass";
  return {
    auditVersion: AUDIT_VERSION,
    status,
    repository: {
      owner: snapshot.repository.owner,
      name: snapshot.repository.name,
      baseSha: snapshot.baseRevision.sha
    },
    findings,
    checked: ["base-revision", "branch-protection", "rulesets", "tag-protection", "workflows"]
  };
}

function addWorkflowFinding(
  findings: AuditFinding[],
  workflowFinding: WorkflowSecurityFinding
): void {
  findings.push({
    code: workflowFinding.ruleId,
    category: "workflow",
    severity: workflowFinding.severity,
    path: workflowFinding.path,
    line: workflowFinding.line,
    message: workflowFinding.message
  });
}

export function compareAuditFindings(left: AuditFinding, right: AuditFinding): number {
  const codeOrder = compareStrings(left.code, right.code);
  const pathOrder = compareStrings(left.path ?? "", right.path ?? "");
  const lineOrder = (left.line ?? 0) - (right.line ?? 0);
  const severityOrder = compareStrings(left.severity, right.severity);
  const categoryOrder = compareStrings(left.category, right.category);
  return (
    codeOrder ||
    pathOrder ||
    lineOrder ||
    severityOrder ||
    compareStrings(left.message, right.message) ||
    categoryOrder
  );
}

export function auditRepository(value: unknown): AuditReport {
  const parsed = auditSnapshotSchema.safeParse(value);
  if (!parsed.success) {
    return {
      auditVersion: AUDIT_VERSION,
      status: "incomplete",
      repository: { owner: "unknown", name: "unknown", baseSha: "0".repeat(40) },
      findings: [
        auditFinding(
          "AUDIT_INPUT_INVALID",
          "completeness",
          "Audit input does not match the bounded normalized snapshot contract.",
          "input"
        )
      ],
      checked: []
    };
  }
  return auditSnapshot(parsed.data);
}

export function renderAuditJson(report: AuditReport, pretty = false): string {
  return JSON.stringify(report, null, pretty ? 2 : undefined);
}

export function renderAuditSarif(report: AuditReport): string {
  const ruleIds = [...new Set(report.findings.map((finding) => finding.code))].sort(compareStrings);
  const rules = ruleIds.map((id) => ({ id, shortDescription: { text: id } }));
  const results = report.findings.map((finding) => {
    const locations =
      finding.path === undefined
        ? undefined
        : [
            {
              physicalLocation: {
                artifactLocation: { uri: sarifUri(finding.path) },
                ...(finding.line === undefined ? {} : { region: { startLine: finding.line } })
              }
            }
          ];
    return {
      ruleId: finding.code,
      level: finding.severity,
      message: { text: finding.message },
      ...(locations === undefined ? {} : { locations })
    };
  });
  return JSON.stringify(
    {
      $schema: "https://json.schemastore.org/sarif-2.1.0.json",
      version: "2.1.0",
      runs: [
        {
          tool: {
            driver: { name: "ReviewReady", version: `audit-${String(AUDIT_VERSION)}`, rules }
          },
          results
        }
      ]
    },
    null,
    2
  );
}
