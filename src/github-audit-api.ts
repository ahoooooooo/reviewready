import { getOctokit } from "@actions/github";

import type {
  AuditBranchProtection,
  AuditGitHubClient,
  AuditRepositoryMetadata,
  AuditRuleset,
  AuditTagProtection,
  AuditWorkflowFile
} from "./github-audit.js";

const API_VERSION = "2026-03-10";
const REQUEST_TIMEOUT_MS = 60_000;
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const MAX_RULESETS = 100;
const MAX_API_REQUESTS = 64;
const MAX_RETRIES = 1;
const MAX_RETRY_DELAY_MS = 2_000;
const MAX_SOURCE_BYTES = 512 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_DEADLINE_MS = 120_000;
const SHA = /^[0-9a-f]{40}$/iu;

type RequestResponse = {
  readonly data: unknown;
  readonly headers?: unknown;
  readonly status?: number;
};
type RequestFunction = (
  route: string,
  parameters: Record<string, unknown>
) => Promise<RequestResponse>;

export interface GitHubAuditApiOptions {
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly now?: () => number;
  readonly deadlineMs?: number;
}

class AuditApiFailure extends Error {
  public constructor(
    public readonly code: string,
    public readonly status?: number
  ) {
    super(code);
  }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AuditApiFailure("response-object-invalid");
  }
  return value as Record<string, unknown>;
}

function stringField(value: unknown, max = 512): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > max ||
    value.includes("\0")
  ) {
    throw new AuditApiFailure("response-string-invalid");
  }
  return value;
}

function shaField(value: unknown): string {
  const candidate = stringField(value, 128);
  if (!SHA.test(candidate)) {
    throw new AuditApiFailure("response-sha-invalid");
  }
  return candidate;
}

function booleanField(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new AuditApiFailure("response-boolean-invalid");
  }
  return value;
}

function integerField(value: unknown, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new AuditApiFailure("response-integer-invalid");
  }
  return value as number;
}

function headerValue(headers: unknown, name: string): string | undefined {
  if (typeof headers !== "object" || headers === null) {
    return undefined;
  }
  let found: string | undefined;
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (key.toLowerCase() !== name.toLowerCase()) {
      continue;
    }
    if (typeof value !== "string" || found !== undefined) {
      throw new AuditApiFailure("response-header-invalid");
    }
    found = value;
  }
  return found;
}

function validateResponseSize(response: RequestResponse): void {
  const contentLength = headerValue(response.headers, "content-length");
  if (contentLength !== undefined) {
    const parsed = Number(contentLength);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      throw new AuditApiFailure("response-header-invalid");
    }
    if (parsed > MAX_RESPONSE_BYTES) {
      throw new AuditApiFailure("response-size-limit");
    }
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(response.data);
  } catch {
    throw new AuditApiFailure("response-data-invalid");
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_RESPONSE_BYTES) {
    throw new AuditApiFailure("response-size-limit");
  }
}

function errorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const status = (error as { readonly status?: unknown }).status;
  return Number.isSafeInteger(status) ? (status as number) : undefined;
}

function errorHeaders(error: unknown): unknown {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const response = (error as { readonly response?: unknown }).response;
  if (typeof response !== "object" || response === null) {
    return undefined;
  }
  return (response as { readonly headers?: unknown }).headers;
}

function retryDelay(error: unknown, now: number): number | undefined {
  const status = errorStatus(error);
  if (
    status !== 408 &&
    status !== 425 &&
    status !== 429 &&
    status !== 500 &&
    status !== 502 &&
    status !== 503 &&
    status !== 504 &&
    status !== 403
  ) {
    return undefined;
  }
  const headers = errorHeaders(error);
  const retryAfter = headerValue(headers, "retry-after");
  if (retryAfter !== undefined) {
    const seconds = Number(retryAfter);
    if (!Number.isFinite(seconds) || seconds < 0 || seconds * 1_000 > MAX_RETRY_DELAY_MS) {
      return undefined;
    }
    return Math.ceil(seconds * 1_000);
  }
  const remaining = headerValue(headers, "x-ratelimit-remaining");
  const reset = headerValue(headers, "x-ratelimit-reset");
  if (remaining === "0" && reset !== undefined) {
    const resetSeconds = Number(reset);
    if (!Number.isSafeInteger(resetSeconds)) {
      return undefined;
    }
    const delay = resetSeconds * 1_000 - now;
    return delay >= 0 && delay <= MAX_RETRY_DELAY_MS ? delay : undefined;
  }
  return status === 403 ? undefined : 100;
}

function nextPage(headers: unknown): number | undefined {
  const link = headerValue(headers, "link");
  if (link === undefined) {
    return undefined;
  }
  const matches = [...link.matchAll(/<([^<>]+)>\s*;\s*rel=(?:"next"|'next')/giu)];
  if (matches.length === 0) {
    if (/\brel\s*=\s*["']?next\b/iu.test(link)) {
      throw new AuditApiFailure("pagination-link-invalid");
    }
    return undefined;
  }
  if (matches.length !== 1) {
    throw new AuditApiFailure("pagination-link-ambiguous");
  }
  try {
    const parameters = new URL(matches[0]?.[1] ?? "").searchParams;
    const pages = parameters.getAll("page");
    if (pages.length !== 1 || !/^[1-9]\d*$/u.test(pages[0] ?? "")) {
      throw new AuditApiFailure("pagination-link-invalid");
    }
    const parsed = Number(pages[0]);
    if (!Number.isSafeInteger(parsed)) {
      throw new AuditApiFailure("pagination-link-invalid");
    }
    return parsed;
  } catch (error) {
    if (error instanceof AuditApiFailure) {
      throw error;
    }
    throw new AuditApiFailure("pagination-link-invalid");
  }
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  limit: number,
  mapper: (value: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = Array.from({ length: values.length });
  let next = 0;
  async function worker(): Promise<void> {
    while (next < values.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(values[index] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()));
  return results;
}

function actor(value: unknown): {
  readonly id: string;
  readonly type?: "user" | "team" | "app" | "integration";
} {
  const item = record(value);
  const actorType = typeof item.actor_type === "string" ? item.actor_type.toLowerCase() : undefined;
  const actorId = item.actor_id;
  const id = Number.isSafeInteger(actorId)
    ? String(actorId)
    : stringField(actorType ?? "unknown", 128);
  const type =
    actorType === "user"
      ? "user"
      : actorType === "team"
        ? "team"
        : actorType === "integration"
          ? "integration"
          : actorType === "organizationadmin" ||
              actorType === "repositoryrole" ||
              actorType === "deploykey"
            ? "app"
            : undefined;
  return { id, ...(type === undefined ? {} : { type }) };
}

function check(
  value: unknown,
  integrationField: string
): { readonly name: string; readonly appId?: number } {
  const item = record(value);
  const name = stringField(item.context ?? item.name);
  const appId = item[integrationField];
  if (appId === null || appId === undefined) {
    return { name };
  }
  return { name, appId: integerField(appId) };
}

function checksFromBranchProtection(value: unknown): AuditBranchProtection["requiredStatusChecks"] {
  if (value === null) {
    return null;
  }
  const item = record(value);
  const strict = booleanField(item.strict);
  const checks: { readonly name: string; readonly appId?: number }[] = [];
  let hasStructuredChecks = false;
  if (item.checks !== undefined) {
    if (!Array.isArray(item.checks)) {
      throw new AuditApiFailure("required-checks-invalid");
    }
    if (item.checks.length > 0) {
      hasStructuredChecks = true;
      checks.push(...item.checks.map((entry) => check(entry, "app_id")));
    }
  }
  if (!hasStructuredChecks && item.contexts !== undefined) {
    if (!Array.isArray(item.contexts) || item.contexts.some((entry) => typeof entry !== "string")) {
      throw new AuditApiFailure("required-contexts-invalid");
    }
    checks.push(...item.contexts.map((entry) => ({ name: stringField(entry) })));
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
  const result: { readonly id: string; readonly type?: "user" | "team" | "app" | "integration" }[] =
    [];
  for (const [field, type] of [
    ["users", "user"],
    ["teams", "team"],
    ["apps", "app"]
  ] as const) {
    const values = data[field];
    if (values === undefined) {
      continue;
    }
    if (!Array.isArray(values)) {
      throw new AuditApiFailure("review-bypass-invalid");
    }
    for (const entry of values) {
      const item = record(entry);
      const id = item.id ?? item.login ?? item.slug;
      result.push({ id: stringField(id), type });
    }
  }
  return { actors: result, known: true };
}

function mapBranchProtection(value: unknown, branch: string): AuditBranchProtection {
  const item = record(value);
  const admins = record(item.enforce_admins);
  const forcePushes = record(item.allow_force_pushes);
  const deletions = record(item.allow_deletions);
  const reviews = item.required_pull_request_reviews;
  const reviewRules =
    reviews === null
      ? null
      : (() => {
          const data = record(reviews);
          const bypass = reviewBypassActors(data);
          return {
            requiredApprovingReviewCount: integerField(data.required_approving_review_count),
            bypassActors: bypass.actors,
            ...(bypass.known ? {} : { bypassActorsKnown: false })
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

function rulesetChecks(value: unknown): { readonly name: string; readonly appId?: number }[] {
  const parameters = record(value);
  const values = parameters.required_status_checks;
  if (!Array.isArray(values)) {
    throw new AuditApiFailure("ruleset-checks-invalid");
  }
  return values.map((entry) => check(entry, "integration_id"));
}

function mapRuleset(value: unknown): AuditRuleset {
  const item = record(value);
  const target = item.target;
  if (target !== "branch" && target !== "tag" && target !== "push" && target !== "repository") {
    throw new AuditApiFailure("ruleset-target-invalid");
  }
  const enforcement = item.enforcement;
  if (
    enforcement !== "active" &&
    enforcement !== "evaluate" &&
    enforcement !== "disabled" &&
    enforcement !== "enabled"
  ) {
    throw new AuditApiFailure("ruleset-enforcement-invalid");
  }
  const conditions = record(item.conditions);
  const includes =
    target === "branch" || target === "tag"
      ? (() => {
          const refName = record(conditions.ref_name);
          const rawValues = refName.include;
          if (!Array.isArray(rawValues)) {
            throw new AuditApiFailure("ruleset-scope-invalid");
          }
          const values: string[] = [];
          for (const value of rawValues) {
            if (typeof value !== "string") {
              throw new AuditApiFailure("ruleset-scope-invalid");
            }
            values.push(value);
          }
          return values;
        })()
      : [];
  const repositoryName = conditions.repository_name;
  let repositoryPatterns: string[] | undefined;
  if (repositoryName !== undefined) {
    const repositoryScope = record(repositoryName);
    const repositoryIncludes = repositoryScope.include;
    if (
      !Array.isArray(repositoryIncludes) ||
      repositoryIncludes.some((entry) => typeof entry !== "string")
    ) {
      throw new AuditApiFailure("ruleset-repository-scope-invalid");
    }
    repositoryPatterns = repositoryIncludes.map((entry) => stringField(entry));
  }
  const rules = item.rules;
  if (!Array.isArray(rules)) {
    throw new AuditApiFailure("ruleset-rules-invalid");
  }
  let allowForcePushes: boolean | undefined;
  let allowDeletions: boolean | undefined;
  if (target === "branch" || target === "tag") {
    allowForcePushes = true;
    allowDeletions = true;
  }
  const requiredChecks: { readonly name: string; readonly appId?: number }[] = [];
  for (const rawRule of rules) {
    const rule = record(rawRule);
    if (rule.type === "non_fast_forward" && allowForcePushes !== undefined) {
      allowForcePushes = false;
    }
    if (rule.type === "deletion" && allowDeletions !== undefined) {
      allowDeletions = false;
    }
    if (rule.type === "required_status_checks") {
      requiredChecks.push(...rulesetChecks(rule.parameters));
    }
  }
  const rawBypass = item.bypass_actors;
  const bypassActorsKnown = Array.isArray(rawBypass);
  const bypassActors = bypassActorsKnown ? rawBypass.map(actor) : [];
  return {
    id: integerField(item.id),
    name: stringField(item.name),
    target,
    refPatterns: includes.map((entry) => stringField(entry)),
    ...(repositoryPatterns === undefined ? {} : { repositoryPatterns }),
    enforcement: enforcement === "enabled" ? "active" : enforcement,
    bypassActors,
    ...(bypassActorsKnown ? {} : { bypassActorsKnown: false }),
    allowForcePushes,
    allowDeletions,
    requiredChecks
  };
}

async function collectPages(
  requestPage: (
    page: number
  ) => Promise<{ readonly items: readonly unknown[]; readonly headers?: unknown }>,
  maxItems: number,
  kind: string
): Promise<unknown[]> {
  const result: unknown[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const pageResult = await requestPage(page);
    if (pageResult.items.length > PAGE_SIZE || result.length + pageResult.items.length > maxItems) {
      throw new AuditApiFailure(`${kind}-limit`);
    }
    result.push(...pageResult.items);
    const next = nextPage(pageResult.headers);
    if (next !== undefined) {
      if (next !== page + 1 || page === MAX_PAGES) {
        throw new AuditApiFailure(`${kind}-pagination-invalid`);
      }
      continue;
    }
    if (pageResult.items.length < PAGE_SIZE) {
      return result;
    }
    const extra = await requestPage(page + 1);
    if (extra.items.length > 0 || nextPage(extra.headers) !== undefined) {
      throw new AuditApiFailure(`${kind}-pagination-ambiguous`);
    }
    return result;
  }
  throw new AuditApiFailure(`${kind}-pagination-limit`);
}

export function createGitHubAuditClient(
  token: string,
  options: GitHubAuditApiOptions = {}
): AuditGitHubClient {
  if (typeof token !== "string" || token.length === 0 || token.length > 16_384) {
    throw new AuditApiFailure("token-invalid");
  }
  const octokit = getOctokit(token, {
    request: { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
  });
  const request = octokit.request as unknown as RequestFunction;
  const sleep =
    options.sleep ??
    ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const now = options.now ?? Date.now;
  const deadlineMs = options.deadlineMs ?? MAX_DEADLINE_MS;
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0 || deadlineMs > MAX_DEADLINE_MS) {
    throw new AuditApiFailure("deadline-invalid");
  }
  const startedAt = now();
  if (
    !Number.isSafeInteger(startedAt) ||
    startedAt < 0 ||
    startedAt + deadlineMs > Number.MAX_SAFE_INTEGER
  ) {
    throw new AuditApiFailure("clock-invalid");
  }
  const deadlineAt = startedAt + deadlineMs;
  let requestCount = 0;

  const read = async (
    route: string,
    parameters: Record<string, unknown>,
    raw = false
  ): Promise<RequestResponse> => {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      const remainingMs = deadlineAt - now();
      if (!Number.isSafeInteger(remainingMs) || remainingMs <= 0) {
        throw new AuditApiFailure("audit-deadline-exceeded");
      }
      requestCount += 1;
      if (requestCount > MAX_API_REQUESTS) {
        throw new AuditApiFailure("request-budget-exceeded");
      }
      try {
        const response = await request(route, {
          ...parameters,
          request: { signal: AbortSignal.timeout(Math.min(REQUEST_TIMEOUT_MS, remainingMs)) },
          headers: {
            accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
            "X-GitHub-Api-Version": API_VERSION
          }
        });
        if (response.status === 304) {
          throw new AuditApiFailure("conditional-response-without-body");
        }
        validateResponseSize(response);
        return response;
      } catch (error) {
        const delay = attempt < MAX_RETRIES ? retryDelay(error, now()) : undefined;
        if (delay === undefined) {
          if (error instanceof AuditApiFailure) {
            throw error;
          }
          throw new AuditApiFailure("request-failed", errorStatus(error));
        }
        if (delay > deadlineAt - now()) {
          throw new AuditApiFailure("audit-deadline-exceeded");
        }
        await sleep(delay);
      }
    }
    throw new AuditApiFailure("request-failed");
  };

  return {
    getRepository: async ({ owner, repo }): Promise<AuditRepositoryMetadata> => {
      const data = record((await read("GET /repos/{owner}/{repo}", { owner, repo })).data);
      return { owner, name: repo, defaultBranch: stringField(data.default_branch) };
    },
    getBranch: async ({ owner, repo, branch }) => {
      const data = record(
        (await read("GET /repos/{owner}/{repo}/branches/{branch}", { owner, repo, branch })).data
      );
      return { name: stringField(data.name), sha: shaField(record(data.commit).sha) };
    },
    getBranchProtection: async ({ owner, repo, branch }) => {
      try {
        const data = await read("GET /repos/{owner}/{repo}/branches/{branch}/protection", {
          owner,
          repo,
          branch
        });
        return mapBranchProtection(data.data, branch);
      } catch (error) {
        if (errorStatus(error) === 404) {
          return null;
        }
        throw error;
      }
    },
    listRulesets: async ({ owner, repo }) => {
      const summaries = await collectPages(
        async (page) => {
          const response = await read("GET /repos/{owner}/{repo}/rulesets", {
            owner,
            repo,
            includes_parents: true,
            targets: "branch,tag,push",
            per_page: PAGE_SIZE,
            page
          });
          if (!Array.isArray(response.data)) {
            throw new AuditApiFailure("rulesets-response-invalid");
          }
          return { items: response.data, headers: response.headers };
        },
        MAX_RULESETS,
        "rulesets"
      );
      const details = await mapWithConcurrency(summaries, 4, async (summary) => {
        const id = integerField(record(summary).id);
        return mapRuleset(
          (
            await read("GET /repos/{owner}/{repo}/rulesets/{ruleset_id}", {
              owner,
              repo,
              ruleset_id: id
            })
          ).data
        );
      });
      return details;
    },
    listWorkflowFiles: async ({ owner, repo, ref }) => {
      const response = await read("GET /repos/{owner}/{repo}/contents/.github/workflows", {
        owner,
        repo,
        ref
      });
      if (!Array.isArray(response.data) || response.data.length > MAX_RULESETS) {
        throw new AuditApiFailure("workflow-list-invalid");
      }
      return response.data.flatMap((entry): AuditWorkflowFile[] => {
        const item = record(entry);
        const path = stringField(item.path);
        if (!/\.(?:yml|yaml)$/iu.test(path)) {
          return [];
        }
        const type = item.type;
        if (type !== "file" && type !== "symlink" && type !== "submodule" && type !== "dir") {
          throw new AuditApiFailure("workflow-entry-type-invalid");
        }
        return [{ path, type }];
      });
    },
    getFileAtRevision: async ({ owner, repo, path, ref }) => {
      const response = await read(
        "GET /repos/{owner}/{repo}/contents/{path}",
        { owner, repo, path, ref },
        true
      );
      if (
        typeof response.data !== "string" ||
        Buffer.byteLength(response.data, "utf8") > MAX_SOURCE_BYTES
      ) {
        throw new AuditApiFailure("file-content-invalid");
      }
      return response.data;
    },
    getTagProtection: async ({ owner, repo }): Promise<AuditTagProtection> => {
      const response = await read("GET /repos/{owner}/{repo}/tags/protection", { owner, repo });
      if (!Array.isArray(response.data)) {
        throw new AuditApiFailure("tag-protection-invalid");
      }
      const patterns = response.data.map((entry) => stringField(record(entry).pattern));
      const protectsAll = patterns.some(
        (pattern) => pattern === "*" || pattern === "~ALL" || pattern === "refs/tags/*"
      );
      return { known: true, allowsDeletion: !protectsAll, allowsUpdate: !protectsAll };
    }
  };
}
