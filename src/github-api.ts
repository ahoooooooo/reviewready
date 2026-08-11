import { getOctokit } from "@actions/github";

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

const permissions = new Set<GitHubPermission>([
  "admin",
  "maintain",
  "write",
  "triage",
  "read",
  "none"
]);

const CHECK_RUN_PAGE_SIZE = 100;
const MAX_CHECK_RUNS = 1000;
const MAX_COMMIT_STATUSES = 1000;
const MAX_PULL_REQUEST_FILES = 3000;
const MAX_REVIEWS = 1000;
const MAX_CLOSING_ISSUES = 100;

function incompleteEvidence(kind: string, limit: number): PlatformError {
  return new PlatformError(
    "GITHUB_EVIDENCE_INCOMPLETE",
    `GitHub returned an incomplete or oversized ${kind} set; ReviewReady cannot evaluate it safely (limit: ${String(limit)}).`
  );
}

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
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function compareOptionalNumber(first: number | undefined, second: number | undefined): number {
  if (first === undefined && second === undefined) {
    return 0;
  }
  if (first === undefined) {
    return -1;
  }
  if (second === undefined) {
    return 1;
  }
  return first === second ? 0 : first > second ? 1 : -1;
}

function checkStateRank(record: CheckRunRecord): number {
  if (record.conclusion === "success" && record.status === "completed") {
    return 0;
  }
  if (record.conclusion === null || record.status !== "completed") {
    return 3;
  }
  return 2;
}

function checkRunKey(record: CheckRunRecord): string {
  return JSON.stringify([record.name, record.app ?? null]);
}

function checkRunTieKey(record: CheckRunRecord): string {
  return JSON.stringify([
    record.status ?? null,
    record.conclusion,
    record.id ?? null,
    record.suiteId ?? null,
    record.startedAt ?? null,
    record.completedAt ?? null
  ]);
}

function checkRunEventTime(record: CheckRunRecord): number | undefined {
  return timestamp(record.completedAt) ?? timestamp(record.startedAt);
}

function compareCheckRuns(first: CheckRunRecord, second: CheckRunRecord): number {
  for (const comparison of [
    compareOptionalNumber(checkRunEventTime(first), checkRunEventTime(second)),
    compareOptionalNumber(timestamp(first.completedAt), timestamp(second.completedAt)),
    compareOptionalNumber(timestamp(first.startedAt), timestamp(second.startedAt)),
    compareOptionalNumber(first.id, second.id),
    compareOptionalNumber(first.suiteId, second.suiteId),
    checkStateRank(first) - checkStateRank(second)
  ]) {
    if (comparison !== 0) {
      return comparison;
    }
  }
  return checkRunTieKey(first).localeCompare(checkRunTieKey(second), "en-US");
}

function latestCheckRunRecords(records: readonly CheckRunRecord[]): CheckRunRecord[] {
  const latest = new Map<string, CheckRunRecord>();
  for (const record of records) {
    const key = checkRunKey(record);
    const current = latest.get(key);
    if (current === undefined || compareCheckRuns(current, record) < 0) {
      latest.set(key, record);
    }
  }
  return [...latest.values()].sort((first, second) =>
    checkRunKey(first).localeCompare(checkRunKey(second), "en-US")
  );
}

function checkRunResult(record: CheckRunRecord): GitHubCheckRun {
  return {
    name: record.name,
    conclusion: record.conclusion,
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

function compareCommitStatuses(first: CommitStatusRecord, second: CommitStatusRecord): number {
  for (const comparison of [
    compareOptionalNumber(timestamp(first.updatedAt), timestamp(second.updatedAt)),
    compareOptionalNumber(timestamp(first.createdAt), timestamp(second.createdAt)),
    compareOptionalNumber(first.id, second.id)
  ]) {
    if (comparison !== 0) {
      return comparison;
    }
  }
  const rank = (record: CommitStatusRecord): number => (record.conclusion === "success" ? 0 : 1);
  const rankComparison = rank(first) - rank(second);
  return rankComparison === 0
    ? JSON.stringify([first.conclusion, first.id ?? null]).localeCompare(
        JSON.stringify([second.conclusion, second.id ?? null]),
        "en-US"
      )
    : rankComparison;
}

function latestCommitStatusRecords(records: readonly CommitStatusRecord[]): CommitStatusRecord[] {
  const latest = new Map<string, CommitStatusRecord>();
  for (const record of records) {
    const key = commitStatusKey(record);
    const current = latest.get(key);
    if (current === undefined || compareCommitStatuses(current, record) < 0) {
      latest.set(key, record);
    }
  }
  return [...latest.values()].sort((first, second) =>
    first.name.localeCompare(second.name, "en-US")
  );
}

function commitStatusResult(record: CommitStatusRecord): GitHubCheckRun {
  return { name: record.name, conclusion: record.conclusion };
}

type EvidenceRecord = CheckRunRecord | CommitStatusRecord;

function evidenceEventTime(record: EvidenceRecord): number | undefined {
  return record.source === "check_run"
    ? checkRunEventTime(record)
    : (timestamp(record.updatedAt) ?? timestamp(record.createdAt));
}

function evidenceStateRank(record: EvidenceRecord): number {
  if (record.conclusion === "success") {
    return 0;
  }
  return record.conclusion === null ? 3 : 2;
}

function evidenceStableKey(record: EvidenceRecord): string {
  return record.source === "check_run"
    ? `check:${checkRunTieKey(record)}`
    : `status:${JSON.stringify([
        record.conclusion,
        record.id ?? null,
        record.createdAt ?? null,
        record.updatedAt ?? null
      ])}`;
}

function compareEvidenceRecords(first: EvidenceRecord, second: EvidenceRecord): number {
  const timeComparison = compareOptionalNumber(evidenceEventTime(first), evidenceEventTime(second));
  if (timeComparison !== 0) {
    return timeComparison;
  }
  const stateComparison = evidenceStateRank(first) - evidenceStateRank(second);
  return stateComparison === 0
    ? evidenceStableKey(first).localeCompare(evidenceStableKey(second), "en-US")
    : stateComparison;
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
    .filter((record) => !(aggregateNames.has(record.name) && record.app === undefined))
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
      let latest: EvidenceRecord | undefined;
      for (const candidate of candidates) {
        if (latest === undefined || compareEvidenceRecords(latest, candidate) < 0) {
          latest = candidate;
        }
      }
      if (latest === undefined) {
        throw new Error("GitHub evidence reduction produced no candidate.");
      }
      return { name, conclusion: latest.conclusion };
    });
  return [...checkResults, ...statusResults, ...aggregateResults];
}

async function collectPages<T>(
  fetchPage: (page: number) => Promise<readonly T[]>,
  pageSize: number,
  maxItems: number,
  kind: string
): Promise<T[]> {
  const result: T[] = [];
  const maxPages = maxItems / pageSize;
  for (let page = 1; page <= maxPages; page += 1) {
    const items = await fetchPage(page);
    if (items.length > pageSize || result.length + items.length > maxItems) {
      throw incompleteEvidence(kind, maxItems);
    }
    result.push(...items);
    if (items.length < pageSize) {
      return result;
    }
    if (page === maxPages) {
      const extraItems = await fetchPage(page + 1);
      if (extraItems.length > 0) {
        throw incompleteEvidence(kind, maxItems);
      }
      return result;
    }
  }
  return result;
}

export async function collectCheckRunPages(
  fetchPage: (page: number) => Promise<readonly GitHubCheckRun[]>
): Promise<GitHubCheckRun[]> {
  return collectPages(fetchPage, CHECK_RUN_PAGE_SIZE, MAX_CHECK_RUNS, "check runs");
}

async function allCheckRuns(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref: string
): Promise<CheckRunRecord[]> {
  const records = await collectPages<CheckRunRecord>(
    async (page) => {
      const response = await octokit.rest.checks.listForRef({
        owner,
        repo,
        ref,
        filter: "latest",
        per_page: 100,
        page
      });
      if (response.data.total_count > MAX_CHECK_RUNS) {
        throw incompleteEvidence("check runs", MAX_CHECK_RUNS);
      }
      return response.data.check_runs.map((run) => ({
        source: "check_run" as const,
        name: run.name,
        conclusion: run.conclusion,
        ...(run.app?.slug === undefined ? {} : { app: run.app.slug }),
        ...(typeof run.id === "number" ? { id: run.id } : {}),
        ...(typeof run.check_suite?.id === "number" ? { suiteId: run.check_suite.id } : {}),
        ...(typeof run.status === "string" ? { status: run.status } : {}),
        ...(typeof run.started_at === "string" ? { startedAt: run.started_at } : {}),
        ...(typeof run.completed_at === "string" ? { completedAt: run.completed_at } : {})
      }));
    },
    CHECK_RUN_PAGE_SIZE,
    MAX_CHECK_RUNS,
    "check runs"
  );
  return latestCheckRunRecords(records);
}

async function allCommitStatuses(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref: string
): Promise<CommitStatusRecord[]> {
  return collectPages(
    async (page) => {
      const response = await octokit.rest.repos.listCommitStatusesForRef({
        owner,
        repo,
        ref,
        per_page: CHECK_RUN_PAGE_SIZE,
        page
      });
      return response.data.flatMap((status) => {
        const name = status.context;
        const conclusion = commitStatusConclusion(status.state);
        return typeof name !== "string" || conclusion === undefined
          ? []
          : [
              {
                source: "commit_status" as const,
                name,
                conclusion,
                ...(typeof status.id === "number" ? { id: status.id } : {}),
                ...(typeof status.created_at === "string" ? { createdAt: status.created_at } : {}),
                ...(typeof status.updated_at === "string" ? { updatedAt: status.updated_at } : {})
              }
            ];
      });
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
  const octokit = getOctokit(token);

  return {
    getPullRequestSnapshot: async ({
      owner,
      repo,
      pullNumber
    }): Promise<GitHubPullRequestSnapshot> => {
      const response = await octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: pullNumber
      });
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
      const response = await octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
        owner,
        repo,
        path,
        ref,
        headers: { accept: "application/vnd.github.raw+json" }
      });
      if (typeof response.data !== "string") {
        throw new TypeError("GitHub did not return raw file content.");
      }
      return response.data;
    },
    listPullRequestFiles: async ({ owner, repo, pullNumber }) => {
      const files = await collectPages(
        async (page) => {
          const response = await octokit.rest.pulls.listFiles({
            owner,
            repo,
            pull_number: pullNumber,
            per_page: CHECK_RUN_PAGE_SIZE,
            page
          });
          return response.data;
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
        return typeof file.previous_filename === "string"
          ? [{ filename: file.filename, previousFilename: file.previous_filename }]
          : [file.filename];
      });
    },
    listCheckRuns: ({ owner, repo, ref }) => allCheckEvidence(octokit, owner, repo, ref),
    listPullRequestReviews: async ({ owner, repo, pullNumber }) => {
      const reviews = await collectPages(
        async (page) => {
          const response = await octokit.rest.pulls.listReviews({
            owner,
            repo,
            pull_number: pullNumber,
            per_page: CHECK_RUN_PAGE_SIZE,
            page
          });
          return response.data;
        },
        CHECK_RUN_PAGE_SIZE,
        MAX_REVIEWS,
        "pull-request reviews"
      );
      if (reviews.length >= MAX_REVIEWS) {
        throw incompleteEvidence("pull-request reviews", MAX_REVIEWS);
      }
      return reviews.map((review): GitHubReview => ({
        login: review.user?.login ?? null,
        state: review.state,
        ...(typeof review.submitted_at === "string" ? { submittedAt: review.submitted_at } : {})
      }));
    },
    getRepositoryPermission: async ({ owner, repo, login }) => {
      try {
        const response = await octokit.rest.repos.getCollaboratorPermissionLevel({
          owner,
          repo,
          username: login
        });
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
      const response = await octokit.graphql<{
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
      return references.nodes.flatMap((issue) => (issue === null ? [] : [issue.number]));
    }
  };
}
