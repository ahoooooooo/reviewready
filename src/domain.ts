export const checkConclusions = [
  "action_required",
  "cancelled",
  "failure",
  "neutral",
  "skipped",
  "stale",
  "success",
  "timed_out"
] as const;

export type CheckConclusion = (typeof checkConclusions)[number];

export interface MatchSet {
  readonly any?: readonly string[] | undefined;
  readonly all?: readonly string[] | undefined;
  readonly none?: readonly string[] | undefined;
}

export interface RuleCondition {
  readonly paths?: MatchSet | undefined;
  readonly labels?: MatchSet | undefined;
}

export interface PrBodySectionRequirement {
  readonly type: "pr_body_section";
  readonly heading: string;
}

export interface LinkedIssueRequirement {
  readonly type: "linked_issue";
}

export interface CheckRequirement {
  readonly type: "check";
  readonly name: string;
  readonly conclusions: readonly CheckConclusion[];
  readonly app?: string | undefined;
}

export interface MaintainerReviewRequirement {
  readonly type: "maintainer_review";
  readonly minimum: number;
}

export interface HumanAttestationRequirement {
  readonly type: "human_attestation";
  readonly text: string;
}

export type Requirement =
  | PrBodySectionRequirement
  | LinkedIssueRequirement
  | CheckRequirement
  | MaintainerReviewRequirement
  | HumanAttestationRequirement;

export interface PolicyRule {
  readonly id: string;
  readonly description?: string | undefined;
  readonly when: RuleCondition;
  readonly require: readonly Requirement[];
}

export interface Policy {
  readonly version: 1;
  readonly rules: readonly PolicyRule[];
}

export interface PullRequestCheck {
  readonly name: string;
  readonly conclusion: CheckConclusion;
  readonly app?: string | undefined;
}

export type ReviewState = "approved" | "changes_requested" | "commented" | "dismissed";

export interface PullRequestReview {
  readonly login: string;
  readonly state: ReviewState;
  readonly maintainer: boolean;
}

export interface PullRequestInput {
  readonly version: 1;
  readonly changedFiles: readonly string[];
  readonly body: string;
  readonly labels: readonly string[];
  readonly linkedIssues: readonly number[];
  readonly checks: readonly PullRequestCheck[];
  readonly reviews: readonly PullRequestReview[];
}

export interface RequirementResult {
  readonly key: string;
  readonly type: Requirement["type"];
  readonly status: "satisfied" | "missing";
  readonly summary: string;
  readonly ruleIds: readonly string[];
  readonly evidence?: string | undefined;
}

export interface EvaluationResult {
  readonly outputVersion: 1;
  readonly status: "ready" | "not_ready";
  readonly policyVersion: 1;
  readonly triggeredRules: readonly string[];
  readonly requirements: readonly RequirementResult[];
}
