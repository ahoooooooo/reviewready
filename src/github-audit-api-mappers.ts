import type { AuditBranchProtection, AuditRuleset } from "./github-audit.js";
import {
  appIdField,
  AuditApiFailure,
  booleanField,
  integerField,
  record,
  stringField
} from "./github-audit-api-primitives.js";

const MAX_NESTED_ITEMS = 100;
const RULESET_SUPPORTED_FIELDS = new Set([
  "id",
  "name",
  "target",
  "source_type",
  "source",
  "enforcement",
  "node_id",
  "_links",
  "created_at",
  "updated_at",
  "conditions",
  "rules",
  "bypass_actors",
  "current_user_can_bypass"
]);

function actor(
  value: unknown,
  bypassMode: "always" | "exempt" | "pull_request" | undefined
): AuditRuleset["bypassActors"][number] {
  const item = record(value);
  if (
    Object.keys(item).some(
      (key) => key !== "actor_type" && key !== "actor_id" && key !== "bypass_mode"
    )
  ) {
    throw new AuditApiFailure("ruleset-bypass-field-unsupported");
  }
  const wireType = item.actor_type;
  const actorId = item.actor_id;
  if (typeof wireType !== "string") {
    throw new AuditApiFailure("actor-identity-invalid");
  }
  let actorType:
    "user" | "team" | "integration" | "organization_admin" | "repository_role" | "deploy_key";
  let type: "user" | "team" | "app" | "integration";
  let id: string;
  if (wireType === "User" || wireType === "Team" || wireType === "Integration") {
    if (!Number.isSafeInteger(actorId) || (actorId as number) < 1) {
      throw new AuditApiFailure("actor-identity-invalid");
    }
    id = String(actorId);
    actorType = wireType === "User" ? "user" : wireType === "Team" ? "team" : "integration";
    type = wireType === "User" ? "user" : wireType === "Team" ? "team" : "integration";
  } else if (wireType === "RepositoryRole") {
    if (!Number.isSafeInteger(actorId) || (actorId as number) < 1) {
      throw new AuditApiFailure("actor-identity-invalid");
    }
    id = String(actorId);
    actorType = "repository_role";
    type = "app";
  } else if (wireType === "OrganizationAdmin") {
    if (
      !Object.prototype.hasOwnProperty.call(item, "actor_id") ||
      (actorId !== null && (!Number.isSafeInteger(actorId) || (actorId as number) < 1))
    ) {
      throw new AuditApiFailure("actor-identity-invalid");
    }
    id = "organizationadmin";
    actorType = "organization_admin";
    type = "app";
  } else if (wireType === "DeployKey") {
    if (!Object.prototype.hasOwnProperty.call(item, "actor_id") || actorId !== null) {
      throw new AuditApiFailure("actor-identity-invalid");
    }
    id = "deploykey";
    actorType = "deploy_key";
    type = "app";
  } else {
    throw new AuditApiFailure("actor-identity-invalid");
  }
  return {
    id,
    type,
    actorType,
    ...(bypassMode === undefined ? {} : { bypassMode })
  };
}

function check(
  value: unknown,
  integrationField: string
): { readonly name: string; readonly appId?: number } {
  const item = record(value);
  rejectUnknownFields(
    item,
    ["context", "name", integrationField],
    "branch-protection-semantics-unsupported"
  );
  const hasContext = Object.prototype.hasOwnProperty.call(item, "context");
  const hasName = Object.prototype.hasOwnProperty.call(item, "name");
  let name: string;
  if (hasContext && hasName) {
    const contextName = stringField(item.context);
    const explicitName = stringField(item.name);
    if (contextName !== explicitName) {
      throw new AuditApiFailure("required-checks-ambiguous");
    }
    name = contextName;
  } else {
    name = stringField(hasContext ? item.context : item.name);
  }
  const appId = item[integrationField];
  if (appId === null || appId === undefined) {
    return { name };
  }
  return { name, appId: appIdField(appId) };
}

function rejectUnknownFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  code: string
): void {
  const allowedFields = new Set(allowed);
  if (Object.keys(value).some((field) => !allowedFields.has(field))) {
    throw new AuditApiFailure(code);
  }
}

function checksFromBranchProtection(value: unknown): AuditBranchProtection["requiredStatusChecks"] {
  if (value === null) {
    return null;
  }
  const item = record(value);
  rejectUnknownFields(
    item,
    ["url", "contexts_url", "strict", "checks", "contexts"],
    "branch-protection-semantics-unsupported"
  );
  const strict = booleanField(item.strict);
  const checks: { readonly name: string; readonly appId?: number }[] = [];
  let hasStructuredChecks = false;
  let hasChecksField = false;
  let structuredChecks: { readonly name: string; readonly appId?: number }[] = [];
  if (item.checks !== undefined) {
    hasChecksField = true;
    if (!Array.isArray(item.checks)) {
      throw new AuditApiFailure("required-checks-invalid");
    }
    if (item.checks.length > MAX_NESTED_ITEMS) {
      throw new AuditApiFailure("required-checks-limit");
    }
    if (item.checks.length > 0) {
      hasStructuredChecks = true;
      structuredChecks = item.checks.map((entry) => check(entry, "app_id"));
    }
  }
  let legacyContexts: string[] | undefined;
  if (item.contexts !== undefined) {
    if (!Array.isArray(item.contexts)) {
      throw new AuditApiFailure("required-contexts-invalid");
    }
    if (item.contexts.length > MAX_NESTED_ITEMS) {
      throw new AuditApiFailure("required-contexts-limit");
    }
    if (item.contexts.some((entry) => typeof entry !== "string")) {
      throw new AuditApiFailure("required-contexts-invalid");
    }
    legacyContexts = item.contexts.map((entry) => stringField(entry));
  }
  if (hasStructuredChecks && legacyContexts !== undefined) {
    const structuredNames = structuredChecks.map((entry) => entry.name).sort();
    const legacyNames = [...legacyContexts].sort();
    if (JSON.stringify(structuredNames) !== JSON.stringify(legacyNames)) {
      throw new AuditApiFailure("required-checks-ambiguous");
    }
  }
  if (hasStructuredChecks) {
    checks.push(...structuredChecks);
  } else if (legacyContexts !== undefined) {
    checks.push(...legacyContexts.map((entry) => ({ name: entry })));
  }
  if (!hasChecksField && item.contexts === undefined) {
    throw new AuditApiFailure("required-checks-invalid");
  }
  return { strict, checks };
}

function reviewBypassActors(value: unknown): {
  readonly actors: NonNullable<AuditBranchProtection["requiredPullRequestReviews"]>["bypassActors"];
  readonly known: boolean;
} {
  const item = record(value);
  const allowance = item.bypass_pull_request_allowances;
  if (allowance === undefined || allowance === null) {
    return { actors: [], known: false };
  }
  const data = record(allowance);
  if (
    Object.keys(data).some((field) => field !== "users" && field !== "teams" && field !== "apps")
  ) {
    throw new AuditApiFailure("review-bypass-field-unsupported");
  }
  const result: { readonly id: string; readonly type?: "user" | "team" | "app" | "integration" }[] =
    [];
  const identities = new Set<string>();
  let complete = true;
  for (const [field, type] of [
    ["users", "user"],
    ["teams", "team"],
    ["apps", "app"]
  ] as const) {
    const values = data[field];
    if (values === undefined) {
      complete = false;
      continue;
    }
    if (!Array.isArray(values)) {
      throw new AuditApiFailure("review-bypass-invalid");
    }
    if (values.length > MAX_NESTED_ITEMS) {
      throw new AuditApiFailure("review-bypass-limit");
    }
    for (const entry of values) {
      const item = record(entry);
      const id = item.id;
      if (!Number.isSafeInteger(id) || (id as number) < 1) {
        throw new AuditApiFailure("actor-identity-invalid");
      }
      const identity = type + "\u0000" + String(id);
      if (identities.has(identity)) {
        throw new AuditApiFailure("review-bypass-duplicate");
      }
      identities.add(identity);
      result.push({
        id: String(id),
        type
      });
      if (result.length > MAX_NESTED_ITEMS) {
        throw new AuditApiFailure("review-bypass-limit");
      }
    }
  }
  return { actors: result, known: complete };
}

export function mapBranchProtection(value: unknown, branch: string): AuditBranchProtection {
  const item = record(value);
  rejectUnknownFields(
    item,
    [
      "url",
      "required_status_checks",
      "enforce_admins",
      "required_pull_request_reviews",
      "restrictions",
      "required_linear_history",
      "allow_force_pushes",
      "allow_deletions",
      "required_conversation_resolution",
      "lock_branch",
      "allow_fork_syncing"
    ],
    "branch-protection-semantics-unsupported"
  );
  if (
    "restrictions" in item ||
    "required_linear_history" in item ||
    "required_conversation_resolution" in item ||
    "lock_branch" in item ||
    "allow_fork_syncing" in item
  ) {
    throw new AuditApiFailure("branch-protection-semantics-unsupported");
  }
  const admins = record(item.enforce_admins);
  const forcePushes = record(item.allow_force_pushes);
  const deletions = record(item.allow_deletions);
  for (const nested of [admins, forcePushes, deletions]) {
    rejectUnknownFields(nested, ["url", "enabled"], "branch-protection-semantics-unsupported");
  }
  const reviews = item.required_pull_request_reviews;
  const reviewRules =
    reviews === null
      ? null
      : (() => {
          const data = record(reviews);
          rejectUnknownFields(
            data,
            [
              "url",
              "required_approving_review_count",
              "bypass_pull_request_allowances",
              "dismissal_restrictions",
              "dismiss_stale_reviews",
              "require_code_owner_reviews",
              "require_last_push_approval"
            ],
            "branch-protection-semantics-unsupported"
          );
          if (
            "dismissal_restrictions" in data ||
            "dismiss_stale_reviews" in data ||
            "require_code_owner_reviews" in data ||
            "require_last_push_approval" in data
          ) {
            throw new AuditApiFailure("branch-protection-semantics-unsupported");
          }
          const bypass = reviewBypassActors(data);
          return {
            requiredApprovingReviewCount: integerField(data.required_approving_review_count),
            bypassActors: bypass.actors,
            bypassActorsKnown: bypass.known
          };
        })();
  return {
    branch,
    exists: true,
    enforceAdmins: booleanField(admins.enabled),
    allowForcePushes: booleanField(forcePushes.enabled),
    allowDeletions: booleanField(deletions.enabled),
    requiredStatusChecks: checksFromBranchProtection(item.required_status_checks),
    requiredPullRequestReviews: reviewRules
  };
}

function rulesetPullRequest(value: unknown): NonNullable<AuditRuleset["pullRequest"]> {
  const parameters = record(value);
  rejectUnknownFields(
    parameters,
    [
      "allowed_merge_methods",
      "dismiss_stale_reviews_on_push",
      "require_code_owner_review",
      "require_last_push_approval",
      "required_approving_review_count",
      "required_review_thread_resolution",
      "required_reviewers"
    ],
    "ruleset-review-semantics-unsupported"
  );
  const rawMethods = parameters.allowed_merge_methods;
  if (!Array.isArray(rawMethods) || rawMethods.length === 0 || rawMethods.length > 3) {
    throw new AuditApiFailure("ruleset-review-semantics-invalid");
  }
  const allowedMergeMethods: ("merge" | "squash" | "rebase")[] = [];
  const methods = new Set<string>();
  for (const rawMethod of rawMethods as readonly unknown[]) {
    if (rawMethod !== "merge" && rawMethod !== "squash" && rawMethod !== "rebase") {
      throw new AuditApiFailure("ruleset-review-semantics-invalid");
    }
    if (methods.has(rawMethod)) {
      throw new AuditApiFailure("ruleset-review-semantics-invalid");
    }
    methods.add(rawMethod);
    allowedMergeMethods.push(rawMethod);
  }
  const rawReviewers = parameters.required_reviewers;
  if (!Array.isArray(rawReviewers)) {
    throw new AuditApiFailure("ruleset-review-semantics-invalid");
  }
  if (rawReviewers.length > MAX_NESTED_ITEMS) {
    throw new AuditApiFailure("ruleset-reviewers-limit");
  }
  if (rawReviewers.length > 0) {
    throw new AuditApiFailure("ruleset-reviewers-unsupported");
  }
  return {
    allowedMergeMethods,
    dismissStaleReviewsOnPush: booleanField(parameters.dismiss_stale_reviews_on_push),
    requireCodeOwnerReview: booleanField(parameters.require_code_owner_review),
    requireLastPushApproval: booleanField(parameters.require_last_push_approval),
    requiredApprovingReviewCount: integerField(parameters.required_approving_review_count),
    requiredReviewThreadResolution: booleanField(parameters.required_review_thread_resolution),
    requiredReviewers: []
  };
}

function rulesetChecks(value: unknown): {
  readonly checks: readonly { readonly name: string; readonly appId?: number }[];
  readonly policy?: NonNullable<AuditRuleset["requiredStatusChecksPolicy"]>;
} {
  const parameters = record(value);
  rejectUnknownFields(
    parameters,
    ["required_status_checks", "do_not_enforce_on_create", "strict_required_status_checks_policy"],
    "ruleset-status-semantics-unsupported"
  );
  const values = parameters.required_status_checks;
  if (!Array.isArray(values)) {
    throw new AuditApiFailure("ruleset-checks-invalid");
  }
  if (values.length > MAX_NESTED_ITEMS) {
    throw new AuditApiFailure("ruleset-checks-limit");
  }
  const checks = values.map((entry) => check(entry, "integration_id"));
  const hasDoNotEnforceOnCreate = Object.prototype.hasOwnProperty.call(
    parameters,
    "do_not_enforce_on_create"
  );
  const hasStrictPolicy = Object.prototype.hasOwnProperty.call(
    parameters,
    "strict_required_status_checks_policy"
  );
  if (hasDoNotEnforceOnCreate !== hasStrictPolicy) {
    throw new AuditApiFailure("ruleset-status-semantics-invalid");
  }
  return {
    checks,
    ...(hasDoNotEnforceOnCreate
      ? {
          policy: {
            doNotEnforceOnCreate: booleanField(parameters.do_not_enforce_on_create),
            strictRequiredStatusChecksPolicy: booleanField(
              parameters.strict_required_status_checks_policy
            )
          }
        }
      : {})
  };
}

function validateRulesetMetadata(
  item: Record<string, unknown>,
  ownerType: "organization" | "user" | undefined,
  owner: string | undefined,
  repo: string | undefined
): void {
  const sourceType = item.source_type;
  const source = item.source;
  if ((sourceType === undefined) !== (source === undefined)) {
    throw new AuditApiFailure("ruleset-source-invalid");
  }
  if (sourceType !== undefined || source !== undefined) {
    if (sourceType !== "Repository" && sourceType !== "Organization") {
      throw new AuditApiFailure("ruleset-source-invalid");
    }
    const sourceText = stringField(source, 512);
    if (sourceType === "Repository") {
      if (
        owner === undefined ||
        repo === undefined ||
        sourceText.toLowerCase() !== `${owner}/${repo}`.toLowerCase()
      ) {
        throw new AuditApiFailure("ruleset-source-mismatch");
      }
    } else if (
      ownerType !== "organization" ||
      owner === undefined ||
      sourceText.toLowerCase() !== owner.toLowerCase()
    ) {
      throw new AuditApiFailure("ruleset-source-mismatch");
    }
  }
  if (item.node_id !== undefined) {
    stringField(item.node_id, 512);
  }
  for (const field of ["created_at", "updated_at"] as const) {
    const value = item[field];
    if (value !== undefined) {
      const timestamp = stringField(value, 128);
      if (!Number.isFinite(Date.parse(timestamp))) {
        throw new AuditApiFailure("ruleset-metadata-invalid");
      }
    }
  }
  if (item._links !== undefined) {
    const links = record(item._links);
    for (const key of Object.keys(links)) {
      if (key !== "self" && key !== "html") {
        throw new AuditApiFailure("ruleset-metadata-invalid");
      }
      const link = record(links[key]);
      if (Object.keys(link).some((field) => field !== "href")) {
        throw new AuditApiFailure("ruleset-metadata-invalid");
      }
      const href = stringField(link.href, 2048);
      try {
        const parsed = new URL(href);
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
          throw new Error("unsupported link protocol");
        }
      } catch {
        throw new AuditApiFailure("ruleset-metadata-invalid");
      }
    }
  }
}

export function mapRuleset(
  value: unknown,
  expectedId?: number,
  ownerType?: "organization" | "user",
  owner?: string,
  repo?: string
): AuditRuleset {
  const item = record(value);
  if (Object.keys(item).some((key) => !RULESET_SUPPORTED_FIELDS.has(key))) {
    throw new AuditApiFailure("ruleset-field-unsupported");
  }
  validateRulesetMetadata(item, ownerType, owner, repo);
  if (item.current_user_can_bypass !== undefined && item.current_user_can_bypass !== "never") {
    throw new AuditApiFailure("ruleset-bypass-semantics-unsupported");
  }
  const target = item.target;
  if (target !== "branch" && target !== "tag" && target !== "push" && target !== "repository") {
    throw new AuditApiFailure("ruleset-target-invalid");
  }
  const enforcement = item.enforcement;
  if (enforcement !== "active" && enforcement !== "evaluate" && enforcement !== "disabled") {
    throw new AuditApiFailure("ruleset-enforcement-invalid");
  }
  if (target === "repository" && enforcement === "evaluate") {
    throw new AuditApiFailure("ruleset-enforcement-invalid");
  }
  const conditions = record(item.conditions);
  const supportedConditionFields =
    target === "repository"
      ? ["repository_name"]
      : target === "push"
        ? ["repository_name"]
        : ["ref_name", "repository_name"];
  for (const field of Object.keys(conditions)) {
    if (!supportedConditionFields.includes(field)) {
      throw new AuditApiFailure("ruleset-scope-unsupported");
    }
  }
  const includes =
    target === "branch" || target === "tag"
      ? (() => {
          const refName = record(conditions.ref_name);
          for (const field of Object.keys(refName)) {
            if (field !== "include" && field !== "exclude") {
              throw new AuditApiFailure("ruleset-scope-unsupported");
            }
          }
          const rawValues = refName.include;
          if (!Array.isArray(rawValues)) {
            throw new AuditApiFailure("ruleset-scope-invalid");
          }
          if (rawValues.length > MAX_NESTED_ITEMS) {
            throw new AuditApiFailure("ruleset-scope-limit");
          }
          const values: string[] = [];
          for (const value of rawValues) {
            if (typeof value !== "string") {
              throw new AuditApiFailure("ruleset-scope-invalid");
            }
            values.push(value);
          }
          const excluded = refName.exclude;
          if (excluded !== undefined) {
            if (!Array.isArray(excluded) || excluded.some((entry) => typeof entry !== "string")) {
              throw new AuditApiFailure("ruleset-scope-invalid");
            }
            if (excluded.length > MAX_NESTED_ITEMS) {
              throw new AuditApiFailure("ruleset-scope-limit");
            }
            if (excluded.length > 0) {
              throw new AuditApiFailure("ruleset-scope-unsupported");
            }
          }
          return values;
        })()
      : [];
  const repositoryName = conditions.repository_name;
  let repositoryPatterns: string[] | undefined;
  if (target === "repository" && repositoryName === undefined) {
    throw new AuditApiFailure("ruleset-scope-unsupported");
  }
  if (repositoryName !== undefined) {
    const repositoryScope = record(repositoryName);
    for (const field of Object.keys(repositoryScope)) {
      if (field !== "include" && field !== "exclude") {
        throw new AuditApiFailure("ruleset-scope-unsupported");
      }
    }
    const repositoryIncludes = repositoryScope.include;
    if (
      !Array.isArray(repositoryIncludes) ||
      repositoryIncludes.some((entry) => typeof entry !== "string")
    ) {
      throw new AuditApiFailure("ruleset-repository-scope-invalid");
    }
    if (repositoryIncludes.length === 0) {
      throw new AuditApiFailure("ruleset-repository-scope-invalid");
    }
    if (repositoryIncludes.length > MAX_NESTED_ITEMS) {
      throw new AuditApiFailure("ruleset-repository-scope-limit");
    }
    const repositoryExcludes = repositoryScope.exclude;
    if (repositoryExcludes !== undefined) {
      if (
        !Array.isArray(repositoryExcludes) ||
        repositoryExcludes.some((entry) => typeof entry !== "string")
      ) {
        throw new AuditApiFailure("ruleset-repository-scope-invalid");
      }
      if (repositoryExcludes.length > MAX_NESTED_ITEMS) {
        throw new AuditApiFailure("ruleset-repository-scope-limit");
      }
      if (repositoryExcludes.length > 0) {
        throw new AuditApiFailure("ruleset-scope-unsupported");
      }
    }
    repositoryPatterns = repositoryIncludes.map((entry) => stringField(entry));
  }
  const rules = item.rules;
  if (!Array.isArray(rules)) {
    throw new AuditApiFailure("ruleset-rules-invalid");
  }
  if (rules.length > MAX_NESTED_ITEMS) {
    throw new AuditApiFailure("ruleset-rules-limit");
  }
  let allowForcePushes: boolean | undefined;
  let allowDeletions: boolean | undefined;
  let pullRequest: AuditRuleset["pullRequest"];
  let requiredStatusChecksPolicy: AuditRuleset["requiredStatusChecksPolicy"];
  let hasRequiredStatusChecksRule = false;
  if (target === "branch" || target === "tag") {
    allowForcePushes = true;
    allowDeletions = true;
  }
  const requiredChecks: { readonly name: string; readonly appId?: number }[] = [];
  for (const rawRule of rules) {
    const rule = record(rawRule);
    const ruleType = rule.type;
    if (ruleType === "pull_request") {
      if (
        Object.keys(rule).some((key) => key !== "type" && key !== "parameters") ||
        !Object.prototype.hasOwnProperty.call(rule, "parameters") ||
        pullRequest !== undefined
      ) {
        throw new AuditApiFailure(
          pullRequest === undefined ? "ruleset-rule-parameters" : "ruleset-review-duplicate"
        );
      }
      pullRequest = rulesetPullRequest(rule.parameters);
      continue;
    }
    if (
      ruleType !== "non_fast_forward" &&
      ruleType !== "deletion" &&
      ruleType !== "required_status_checks"
    ) {
      throw new AuditApiFailure("ruleset-rule-unsupported");
    }
    if (ruleType === "non_fast_forward" || ruleType === "deletion") {
      if (Object.keys(rule).some((key) => key !== "type")) {
        throw new AuditApiFailure("ruleset-rule-parameters");
      }
    }
    if (ruleType === "non_fast_forward" && allowForcePushes !== undefined) {
      allowForcePushes = false;
    }
    if (ruleType === "deletion" && allowDeletions !== undefined) {
      allowDeletions = false;
    }
    if (ruleType === "required_status_checks") {
      if (
        Object.keys(rule).some((key) => key !== "type" && key !== "parameters") ||
        !Object.prototype.hasOwnProperty.call(rule, "parameters")
      ) {
        throw new AuditApiFailure("ruleset-rule-parameters");
      }
      const status = rulesetChecks(rule.parameters);
      if (requiredChecks.length + status.checks.length > MAX_NESTED_ITEMS) {
        throw new AuditApiFailure("ruleset-checks-limit");
      }
      if (hasRequiredStatusChecksRule) {
        throw new AuditApiFailure("ruleset-status-duplicate");
      }
      hasRequiredStatusChecksRule = true;
      requiredChecks.push(...status.checks);
      requiredStatusChecksPolicy = status.policy;
    }
  }
  const rawBypass = item.bypass_actors;
  if (rawBypass !== undefined && !Array.isArray(rawBypass)) {
    throw new AuditApiFailure("ruleset-bypass-invalid");
  }
  const bypassActorsKnown = Array.isArray(rawBypass);
  if (bypassActorsKnown && rawBypass.length > MAX_NESTED_ITEMS) {
    throw new AuditApiFailure("ruleset-bypass-limit");
  }
  const bypassActors: AuditRuleset["bypassActors"] = [];
  if (bypassActorsKnown) {
    const identities = new Set<string>();
    for (const rawActor of rawBypass) {
      const actorItem = record(rawActor);
      const rawMode = actorItem.bypass_mode;
      const parsedMode =
        rawMode === "always" || rawMode === "exempt" || rawMode === "pull_request"
          ? rawMode
          : undefined;
      const mapped = actor(rawActor, parsedMode);
      if (parsedMode === undefined) {
        throw new AuditApiFailure("bypass-mode-invalid");
      }
      const mappedActorType = mapped.actorType;
      if (mappedActorType === undefined) {
        throw new AuditApiFailure("actor-identity-invalid");
      }
      if (mappedActorType === "organization_admin" && ownerType !== "organization") {
        throw new AuditApiFailure("owner-type-invalid");
      }
      if (
        parsedMode === "pull_request" &&
        (target !== "branch" || mappedActorType === "deploy_key")
      ) {
        throw new AuditApiFailure("bypass-mode-invalid");
      }
      const identity = mappedActorType + "\u0000" + mapped.id;
      if (identities.has(identity)) {
        throw new AuditApiFailure("ruleset-bypass-duplicate");
      }
      identities.add(identity);
      bypassActors.push(mapped);
    }
  }
  const id = integerField(item.id, 1);
  if (expectedId !== undefined && id !== expectedId) {
    throw new AuditApiFailure("ruleset-id-mismatch");
  }
  return {
    id,
    name: stringField(item.name),
    target,
    refPatterns: includes.map((entry) => stringField(entry)),
    ...(repositoryPatterns === undefined ? {} : { repositoryPatterns }),
    enforcement,
    bypassActors,
    bypassActorsKnown,
    allowForcePushes,
    allowDeletions,
    requiredChecks,
    ...(pullRequest === undefined ? {} : { pullRequest }),
    ...(requiredStatusChecksPolicy === undefined ? {} : { requiredStatusChecksPolicy })
  };
}
