import { getOctokit } from "@actions/github";

import { policyLimits } from "./domain.js";
import {
  githubRequestSignal,
  incompleteEvidence,
  withGitHubRetry
} from "./github-api-boundaries.js";
import {
  CHECK_RUN_PAGE_SIZE,
  collectApiPages,
  MAX_CHECK_RUNS,
  nextPageLink
} from "./github-api-pagination.js";
import type {
  GitHubChangedFile,
  GitHubCheckRun,
  GitHubGateway,
  GitHubPermission,
  GitHubPullRequestSnapshot,
  GitHubReview
} from "./github.js";
import { PlatformError } from "./errors.js";

type Octokit = ReturnType<typeof getOctokit>;

export { collectCheckRunPages } from "./github-api-pagination.js";

const permissions = new Set<GitHubPermission>([
  "admin",
  "maintain",
  "write",
  "triage",
  "read",
  "none"
]);

const MAX_COMMIT_STATUSES = 1000;
const MAX_PULL_REQUEST_FILES = 3000;
const MAX_REVIEWS = 1000;
const MAX_CLOSING_ISSUES = 100;
const isoTimestampPattern =
  /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$/u;
const immutableGitShaPattern = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;

function permission(value: string): GitHubPermission {
  return permissions.has(value as GitHubPermission) ? (value as GitHubPermission) : "none";
}

interface CheckRunRecord extends GitHubCheckRun {
  readonly source: "check_run";
  readonly id?: number | undefined;
  readonly suiteId?: number | undefined;
  readonly status?: string | undefined;
  readonly startedAt?: string | undefined;
  readonly completedAt?: string | undefined;
}

interface CommitStatusRecord {
  readonly source: "commit_status";
  readonly name: string;
  readonly conclusion: "success" | "failure" | null;
  readonly id?: number | undefined;
  readonly createdAt?: string | undefined;
  readonly updatedAt?: string | undefined;
}

function timestamp(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const match = isoTimestampPattern.exec(value);
  if (match === null) {
    return undefined;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const timezone = match[7];
  if (timezone === undefined) {
    return undefined;
  }
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (
    month < 1 ||
    month > 12 ||
    daysInMonth === undefined ||
    day < 1 ||
    day > daysInMonth ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return undefined;
  }
  if (timezone !== "Z") {
    const offsetHours = Number(timezone.slice(1, 3));
    const offsetMinutes = Number(timezone.slice(4, 6));
    if (offsetHours > 23 || offsetMinutes > 59) {
      return undefined;
    }
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function optionalTimestamp(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new TypeError(`GitHub returned a non-string ${field} timestamp.`);
  }
  return value;
}

function reviewTimestamp(value: unknown): string | undefined {
  const candidate = optionalTimestamp(value, "submitted_at");
  if (candidate === undefined) {
    return undefined;
  }
  if (timestamp(candidate) === undefined) {
    throw new TypeError("GitHub returned an invalid submitted_at timestamp.");
  }
  return candidate;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new TypeError(`GitHub returned a non-string ${field} field.`);
  }
  return value;
}

function checkRunProvider(value: unknown): { readonly app?: string | undefined } {
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value !== "object") {
    throw new TypeError("GitHub returned a Check Run provider without a stable slug.");
  }
  const slug = (value as { readonly slug?: unknown }).slug;
  if (typeof slug !== "string") {
    throw new TypeError("GitHub returned a Check Run provider without a stable slug.");
  }
  return { app: slug };
}

function reviewLogin(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "object") {
    throw new TypeError("GitHub returned a review without a valid reviewer login.");
  }
  const login = (value as { readonly login?: unknown }).login;
  if (typeof login !== "string") {
    throw new TypeError("GitHub returned a review without a valid reviewer login.");
  }
  return login;
}

function checkRunKey(record: CheckRunRecord): string {
  return JSON.stringify([record.name, record.app ?? null]);
}

function checkRunEventTime(record: CheckRunRecord): number | undefined {
  return record.completedAt === undefined
    ? timestamp(record.startedAt)
    : timestamp(record.completedAt);
}

function hasInvalidCheckRunTimestamp(record: CheckRunRecord): boolean {
  const started = timestamp(record.startedAt);
  const completed = timestamp(record.completedAt);
  return (
    (record.startedAt !== undefined && timestamp(record.startedAt) === undefined) ||
    (record.completedAt !== undefined && timestamp(record.completedAt) === undefined) ||
    (started !== undefined && completed !== undefined && completed < started)
  );
}

function ambiguousCheckRun(record: CheckRunRecord): CheckRunRecord {
  return {
    source: "check_run",
    name: record.name,
    conclusion: null,
    ...(record.app === undefined ? {} : { app: record.app })
  };
}

function latestCheckRunRecords(records: readonly CheckRunRecord[]): CheckRunRecord[] {
  const grouped = new Map<string, CheckRunRecord[]>();
  for (const record of records) {
    const key = checkRunKey(record);
    const group = grouped.get(key) ?? [];
    group.push(record);
    grouped.set(key, group);
  }

  const latest = new Map<string, CheckRunRecord>();
  for (const [key, group] of grouped) {
    if (group.length === 1) {
      const only = group[0];
      if (only !== undefined) {
        latest.set(key, only);
      }
      continue;
    }
    const times = group.map(checkRunEventTime);
    const validTimes = times.filter((time): time is number => time !== undefined);
    const latestTime = validTimes.length === times.length ? Math.max(...validTimes) : undefined;
    const candidates =
      latestTime === undefined
        ? []
        : group.filter((record) => checkRunEventTime(record) === latestTime);
    const first = group[0];
    const candidate = candidates[0];
    if (first !== undefined) {
      latest.set(
        key,
        candidates.length === 1 && candidate !== undefined ? candidate : ambiguousCheckRun(first)
      );
    }
  }
  return [...latest.values()].sort((first, second) =>
    checkRunKey(first).localeCompare(checkRunKey(second), "en-US")
  );
}

function checkRunResult(record: CheckRunRecord): GitHubCheckRun {
  const conclusion =
    hasInvalidCheckRunTimestamp(record) ||
    record.status !== "completed" ||
    record.completedAt === undefined
      ? null
      : record.conclusion;
  return {
    name: record.name,
    conclusion,
    ...(record.app === undefined ? {} : { app: record.app })
  };
}

function commitStatusConclusion(value: string): "success" | "failure" | null | undefined {
  switch (value.toLocaleLowerCase("en-US")) {
    case "success":
      return "success";
    case "failure":
    case "error":
      return "failure";
    case "pending":
      return null;
    default:
      return undefined;
  }
}

function commitStatusKey(record: CommitStatusRecord): string {
  return record.name;
}

function commitStatusEventTime(record: CommitStatusRecord): number | undefined {
  return record.updatedAt === undefined ? timestamp(record.createdAt) : timestamp(record.updatedAt);
}

function hasInvalidCommitStatusTimestamp(record: CommitStatusRecord): boolean {
  const created = timestamp(record.createdAt);
  const updated = timestamp(record.updatedAt);
  return (
    (record.createdAt !== undefined && timestamp(record.createdAt) === undefined) ||
    (record.updatedAt !== undefined && timestamp(record.updatedAt) === undefined) ||
    (created !== undefined && updated !== undefined && updated < created)
  );
}

function ambiguousCommitStatus(record: CommitStatusRecord): CommitStatusRecord {
  return {
    source: "commit_status",
    name: record.name,
    conclusion: null
  };
}

function latestCommitStatusRecords(records: readonly CommitStatusRecord[]): CommitStatusRecord[] {
  const grouped = new Map<string, CommitStatusRecord[]>();
  for (const record of records) {
    const key = commitStatusKey(record);
    const group = grouped.get(key) ?? [];
    group.push(record);
    grouped.set(key, group);
  }

  const latest = new Map<string, CommitStatusRecord>();
  for (const [key, group] of grouped) {
    if (group.length === 1) {
      const only = group[0];
      if (only !== undefined) {
        latest.set(key, only);
      }
      continue;
    }
    const times = group.map(commitStatusEventTime);
    const validTimes = times.filter((time): time is number => time !== undefined);
    const latestTime = validTimes.length === times.length ? Math.max(...validTimes) : undefined;
    const candidates =
      latestTime === undefined
        ? []
        : group.filter((record) => commitStatusEventTime(record) === latestTime);
    const first = group[0];
    const candidate = candidates[0];
    if (first !== undefined) {
      latest.set(
        key,
        candidates.length === 1 && candidate !== undefined
          ? candidate
          : ambiguousCommitStatus(first)
      );
    }
  }
  return [...latest.values()].sort((first, second) =>
    first.name.localeCompare(second.name, "en-US")
  );
}

function commitStatusResult(record: CommitStatusRecord): GitHubCheckRun {
  return {
    name: record.name,
    conclusion: hasInvalidCommitStatusTimestamp(record) ? null : record.conclusion
  };
}

type EvidenceRecord = CheckRunRecord | CommitStatusRecord;

function evidenceConclusion(record: EvidenceRecord): string | null {
  return record.source === "check_run"
    ? (checkRunResult(record).conclusion ?? null)
    : commitStatusResult(record).conclusion;
}

function evidenceEventTime(record: EvidenceRecord): number | undefined {
  return record.source === "check_run" ? checkRunEventTime(record) : commitStatusEventTime(record);
}

function hasInvalidEvidenceTimestamp(record: EvidenceRecord): boolean {
  return record.source === "check_run"
    ? hasInvalidCheckRunTimestamp(record)
    : hasInvalidCommitStatusTimestamp(record);
}

function uniquelyLatestEvidence(records: readonly EvidenceRecord[]): EvidenceRecord | undefined {
  const timed = records.map((record) => ({ record, time: evidenceEventTime(record) }));
  if (timed.some(({ record, time }) => time === undefined || hasInvalidEvidenceTimestamp(record))) {
    return undefined;
  }

  const latestTime = Math.max(...timed.map(({ time }) => time as number));
  const latest = timed.filter(({ time }) => time === latestTime);
  return latest.length === 1 ? latest[0]?.record : undefined;
}

function mergeCheckAndStatusEvidence(
  checkRecords: readonly CheckRunRecord[],
  statusRecords: readonly CommitStatusRecord[]
): GitHubCheckRun[] {
  const checks = latestCheckRunRecords(checkRecords);
  const statuses = latestCommitStatusRecords(statusRecords);
  const checkNames = new Set(checks.map((record) => record.name));
  const overlappingNames = new Set(
    statuses.map((record) => record.name).filter((name) => checkNames.has(name))
  );
  const providersByName = new Map<string, Set<string | undefined>>();
  for (const record of checks) {
    const providers = providersByName.get(record.name) ?? new Set<string | undefined>();
    providers.add(record.app);
    providersByName.set(record.name, providers);
  }
  const namesWithMultipleProviders = new Set(
    [...providersByName.entries()]
      .filter(([, providers]) => providers.size > 1)
      .map(([name]) => name)
  );
  const aggregateNames = new Set([...overlappingNames, ...namesWithMultipleProviders]);
  const checkResults = checks
    .filter((record) => !aggregateNames.has(record.name))
    .map(checkRunResult);
  const statusResults = statuses
    .filter((record) => !aggregateNames.has(record.name))
    .map(commitStatusResult);
  const aggregateResults = [...aggregateNames]
    .sort((first, second) => first.localeCompare(second, "en-US"))
    .map((name) => {
      const candidates: EvidenceRecord[] = [
        ...checks.filter((record) => record.name === name),
        ...statuses.filter((record) => record.name === name)
      ];
      const latest = uniquelyLatestEvidence(candidates);
      return { name, conclusion: latest === undefined ? null : evidenceConclusion(latest) };
    });
  const merged = [...checkResults, ...statusResults, ...aggregateResults];
  if (merged.length > MAX_CHECK_RUNS) {
    throw incompleteEvidence("combined check and commit status", MAX_CHECK_RUNS);
  }
  return merged;
}

async function allCheckRuns(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref: string
): Promise<CheckRunRecord[]> {
  let reportedTotal: number | undefined;
  const records = await collectApiPages<CheckRunRecord>(
    async (page) => {
      const response = await withGitHubRetry(() =>
        octokit.rest.checks.listForRef({
          owner,
          repo,
          ref,
          filter: "latest",
          per_page: 100,
          page
        })
      );
      const checkRuns = response.data.check_runs;
      if (
        !Array.isArray(checkRuns) ||
        !Number.isSafeInteger(response.data.total_count) ||
        response.data.total_count < checkRuns.length ||
        response.data.total_count < 0 ||
        response.data.total_count >= MAX_CHECK_RUNS
      ) {
        throw incompleteEvidence("check runs", MAX_CHECK_RUNS);
      }
      if (reportedTotal !== undefined && reportedTotal !== response.data.total_count) {
        throw incompleteEvidence("check runs", MAX_CHECK_RUNS);
      }
      reportedTotal = response.data.total_count;
      return {
        items: checkRuns.map((run) => {
          const headSha: unknown = run.head_sha;
          const status = optionalString(run.status, "status");
          const startedAt = optionalTimestamp(run.started_at, "started_at");
          const completedAt = optionalTimestamp(run.completed_at, "completed_at");
          if (
            (immutableGitShaPattern.test(ref) && typeof headSha !== "string") ||
            (headSha !== undefined && (typeof headSha !== "string" || headSha !== ref))
          ) {
            throw incompleteEvidence("check runs", MAX_CHECK_RUNS);
          }
          const provider = checkRunProvider(run.app);
          return {
            source: "check_run" as const,
            name: run.name,
            conclusion: run.conclusion,
            ...provider,
            ...(typeof run.id === "number" ? { id: run.id } : {}),
            ...(typeof run.check_suite?.id === "number" ? { suiteId: run.check_suite.id } : {}),
            ...(status === undefined ? {} : { status }),
            ...(startedAt === undefined ? {} : { startedAt }),
            ...(completedAt === undefined ? {} : { completedAt })
          };
        }),
        ...nextPageLink(response.headers)
      };
    },
    CHECK_RUN_PAGE_SIZE,
    MAX_CHECK_RUNS,
    "check runs"
  );
  if (reportedTotal === undefined || records.length !== reportedTotal) {
    throw incompleteEvidence("check runs", MAX_CHECK_RUNS);
  }
  return latestCheckRunRecords(records);
}

async function allCommitStatuses(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref: string
): Promise<CommitStatusRecord[]> {
  return collectApiPages(
    async (page) => {
      const response = await withGitHubRetry(() =>
        octokit.rest.repos.listCommitStatusesForRef({
          owner,
          repo,
          ref,
          per_page: CHECK_RUN_PAGE_SIZE,
          page
        })
      );
      if (!Array.isArray(response.data)) {
        throw incompleteEvidence("commit statuses", MAX_COMMIT_STATUSES);
      }
      return {
        items: response.data.flatMap((status) => {
          const name = status.context;
          const conclusion = commitStatusConclusion(status.state);
          const createdAt = optionalTimestamp(status.created_at, "created_at");
          const updatedAt = optionalTimestamp(status.updated_at, "updated_at");
          if (typeof name !== "string") {
            throw new TypeError("GitHub returned a commit status without a context.");
          }
          return [
            {
              source: "commit_status" as const,
              name,
              conclusion: conclusion ?? null,
              ...(typeof status.id === "number" ? { id: status.id } : {}),
              ...(createdAt === undefined ? {} : { createdAt }),
              ...(updatedAt === undefined ? {} : { updatedAt })
            }
          ];
        }),
        ...nextPageLink(response.headers)
      };
    },
    CHECK_RUN_PAGE_SIZE,
    MAX_COMMIT_STATUSES,
    "commit statuses"
  );
}

async function allCheckEvidence(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref: string
): Promise<GitHubCheckRun[]> {
  const [checkRuns, statuses] = await Promise.all([
    allCheckRuns(octokit, owner, repo, ref),
    allCommitStatuses(octokit, owner, repo, ref)
  ]);
  return mergeCheckAndStatusEvidence(checkRuns, statuses);
}

export function createGitHubGateway(token: string): GitHubGateway {
  const octokit = getOctokit(token, {
    request: { signal: githubRequestSignal() }
  });

  return {
    getPullRequestSnapshot: async ({
      owner,
      repo,
      pullNumber
    }): Promise<GitHubPullRequestSnapshot> => {
      const response = await withGitHubRetry(() =>
        octokit.rest.pulls.get({
          owner,
          repo,
          pull_number: pullNumber
        })
      );
      const data = response.data;
      const base = data.base as { sha?: unknown } | null | undefined;
      const head = data.head as { sha?: unknown } | null | undefined;
      const baseSha = base?.sha;
      const headSha = head?.sha;
      if (
        typeof data.number !== "number" ||
        typeof baseSha !== "string" ||
        typeof headSha !== "string" ||
        typeof data.updated_at !== "string" ||
        (data.body !== null && typeof data.body !== "string") ||
        !Array.isArray(data.labels) ||
        data.labels.some((label) => typeof label.name !== "string")
      ) {
        throw new TypeError("GitHub returned an invalid pull request snapshot.");
      }
      return {
        number: data.number,
        baseSha,
        headSha,
        updatedAt: data.updated_at,
        body: data.body,
        labels: data.labels.map((label) => label.name)
      };
    },
    getFileAtRevision: async ({ owner, repo, path, ref }) => {
      const response = await withGitHubRetry(() =>
        octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
          owner,
          repo,
          path,
          ref,
          headers: { accept: "application/vnd.github.raw+json" }
        })
      );
      if (typeof response.data !== "string") {
        throw new TypeError("GitHub did not return raw file content.");
      }
      if (Buffer.byteLength(response.data, "utf8") > policyLimits.maxPolicyBytes) {
        throw incompleteEvidence("policy file", policyLimits.maxPolicyBytes);
      }
      return response.data;
    },
    listPullRequestFiles: async ({ owner, repo, pullNumber }) => {
      const files = await collectApiPages(
        async (page) => {
          const response = await withGitHubRetry(() =>
            octokit.rest.pulls.listFiles({
              owner,
              repo,
              pull_number: pullNumber,
              per_page: CHECK_RUN_PAGE_SIZE,
              page
            })
          );
          if (!Array.isArray(response.data)) {
            throw incompleteEvidence("pull-request files", MAX_PULL_REQUEST_FILES);
          }
          return { items: response.data, ...nextPageLink(response.headers) };
        },
        CHECK_RUN_PAGE_SIZE,
        MAX_PULL_REQUEST_FILES,
        "pull-request files"
      );
      if (files.length >= MAX_PULL_REQUEST_FILES) {
        throw incompleteEvidence("pull-request files", MAX_PULL_REQUEST_FILES);
      }
      return files.flatMap((file): (string | GitHubChangedFile)[] => {
        if (typeof file.filename !== "string") {
          throw new TypeError("GitHub returned a pull-request file without a filename.");
        }
        const previousFilename = file.previous_filename;
        if (previousFilename !== undefined && typeof previousFilename !== "string") {
          throw new TypeError(
            "GitHub returned a pull-request file with an invalid previous filename."
          );
        }
        return previousFilename !== undefined
          ? [{ filename: file.filename, previousFilename }]
          : [file.filename];
      });
    },
    listCheckRuns: ({ owner, repo, ref }) => allCheckEvidence(octokit, owner, repo, ref),
    listPullRequestReviews: async ({ owner, repo, pullNumber }) => {
      const reviews = await collectApiPages(
        async (page) => {
          const response = await withGitHubRetry(() =>
            octokit.rest.pulls.listReviews({
              owner,
              repo,
              pull_number: pullNumber,
              per_page: CHECK_RUN_PAGE_SIZE,
              page
            })
          );
          if (!Array.isArray(response.data)) {
            throw incompleteEvidence("pull-request reviews", MAX_REVIEWS);
          }
          return { items: response.data, ...nextPageLink(response.headers) };
        },
        CHECK_RUN_PAGE_SIZE,
        MAX_REVIEWS,
        "pull-request reviews"
      );
      if (reviews.length >= MAX_REVIEWS) {
        throw incompleteEvidence("pull-request reviews", MAX_REVIEWS);
      }
      return reviews.map((review): GitHubReview => {
        const submittedAt = reviewTimestamp(review.submitted_at);
        return {
          login: reviewLogin(review.user),
          state: review.state,
          ...(submittedAt === undefined ? {} : { submittedAt })
        };
      });
    },
    getRepositoryPermission: async ({ owner, repo, login }) => {
      try {
        const response = await withGitHubRetry(() =>
          octokit.rest.repos.getCollaboratorPermissionLevel({
            owner,
            repo,
            username: login
          })
        );
        return permission(response.data.permission);
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          (error as { readonly status?: unknown }).status === 404
        ) {
          return "none";
        }
        throw error;
      }
    },
    listClosingIssueNumbers: async ({ owner, repo, pullNumber }) => {
      const response = await withGitHubRetry(() =>
        octokit.graphql<{
          repository: {
            pullRequest: {
              closingIssuesReferences: {
                nodes: readonly ({ readonly number: number } | null)[];
                pageInfo?: { readonly hasNextPage: boolean };
              };
            } | null;
          } | null;
        }>(
          `query ReviewReadyClosingIssues($owner: String!, $repo: String!, $pullNumber: Int!) {
            repository(owner: $owner, name: $repo) {
              pullRequest(number: $pullNumber) {
                closingIssuesReferences(first: 100) {
                  nodes { number }
                  pageInfo { hasNextPage }
                }
              }
            }
          }`,
          { owner, repo, pullNumber }
        )
      );
      const references = response.repository?.pullRequest?.closingIssuesReferences;
      if (references === undefined) {
        throw new PlatformError(
          "GITHUB_EVIDENCE_UNAVAILABLE",
          "GitHub did not return the pull request's closing issue references."
        );
      }
      if (references.pageInfo?.hasNextPage !== false) {
        throw incompleteEvidence("closing issue references", MAX_CLOSING_ISSUES);
      }
      if (references.nodes.length > MAX_CLOSING_ISSUES) {
        throw incompleteEvidence("closing issue references", MAX_CLOSING_ISSUES);
      }
      return references.nodes.flatMap((issue) => (issue === null ? [] : [issue.number]));
    }
  };
}
